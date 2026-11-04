"""Researcher sessions and read-only inspection of original experiment records."""
from copy import deepcopy
from datetime import timedelta
from zoneinfo import ZoneInfo
import csv
import io
from hashlib import sha256
import secrets
import re
from urllib.parse import urlsplit
from uuid import uuid4

from itsdangerous import URLSafeTimedSerializer, BadSignature
from sqlalchemy import case, func, or_, select

from .content import load_study
from .db import Assignment, Job, Participant, Task, now
from .service import Problem, Service, aware, fail, stamp
from .settings import PROJECT
from .operations import worker_status

COOKIE = 'fcm_researcher'
COOKIE_PATH = '/api/v1/admin'
SESSION_SECONDS = 8 * 3600


class AdminAuth:
    def __init__(self, settings, database):
        self.settings, self.database = settings, database
        self.signer = URLSafeTimedSerializer(settings.secret_key, salt='fcm-researcher-session-v1')
        self.credential = sha256(settings.admin_token.encode()).hexdigest()

    @staticmethod
    def origin(request):
        # Preserve the original Host in reverse proxies, including the Vite dev proxy.
        origin = request.headers.get('origin')
        if request.headers.get('sec-fetch-site') == 'cross-site' or (
            origin and urlsplit(origin).netloc.lower() != request.headers.get('host', '').lower()
        ):
            raise Problem(403, 'admin_origin', '请从控制台所在站点操作。')

    def payload(self, request):
        try:
            payload = self.signer.loads(request.cookies.get(COOKIE, ''), max_age=SESSION_SECONDS)
            fail(payload.get('credential') == self.credential, 'admin_session_expired', '研究者会话已失效，请重新登录。', 401)
            with self.database.transaction() as session:
                job = session.get(Job, payload.get('session'))
                fail(job is not None and job.kind == 'admin_session' and job.status == 'running'
                     and aware(job.lease_expires_at) > now(), 'admin_session_expired', '研究者会话已失效，请重新登录。', 401)
                payload['expiresAt'] = stamp(job.lease_expires_at)
            return payload
        except BadSignature:
            raise Problem(401, 'admin_session_required', '请先登录研究控制台。')

    def authorize(self, request):
        authorization = request.headers.get('authorization')
        if authorization is not None:
            value = authorization[7:] if authorization.startswith('Bearer ') else ''
            fail(secrets.compare_digest(sha256(value.encode()).hexdigest(), self.credential),
                 'admin_required', '研究者授权无效。', 403)
            return
        payload = self.payload(request)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            self.origin(request)
            fail(secrets.compare_digest(request.headers.get('x-csrf-token', '').encode(), payload['csrf'].encode()),
                 'admin_csrf', '页面验证已失效，请刷新后重试。', 403)

    def login(self, request, response, password):
        self.origin(request)
        fail(secrets.compare_digest(sha256(password.encode()).hexdigest(), self.credential),
             'admin_login_failed', '研究者口令不正确。', 401)
        session_id, csrf = str(uuid4()), secrets.token_urlsafe(32)
        expiry = now() + timedelta(seconds=SESSION_SECONDS)
        with self.database.transaction() as session:
            # Replacing this browser's session also revokes its previous cookie.
            try:
                previous = self.signer.loads(request.cookies.get(COOKIE, ''), max_age=SESSION_SECONDS)
                old = session.get(Job, previous.get('session'))
                if old and old.kind == 'admin_session':
                    old.status, old.finished_at = 'cancelled', now()
            except BadSignature:
                pass
            session.add(Job(job_id=session_id, kind='admin_session', scope_ref={}, actor_id='researcher',
                            idempotency_key=f'admin-session:{session_id}', status='running', progress={},
                            started_at=now(), lease_expires_at=expiry))
            Service.audit(session, 'admin_login', request.state.request_id, {}, {})
        signed = self.signer.dumps({'session': session_id, 'csrf': csrf, 'credential': self.credential})
        response.set_cookie(COOKIE, signed, max_age=SESSION_SECONDS, path=COOKIE_PATH,
                            httponly=True, secure=request.url.scheme == 'https', samesite='strict')
        return {'actor': 'researcher', 'expiresAt': stamp(expiry), 'csrfToken': csrf}

    def logout(self, request, response):
        payload = self.payload(request)
        with self.database.transaction() as session:
            job = session.get(Job, payload['session'])
            job.status, job.finished_at = 'cancelled', now()
            Service.audit(session, 'admin_logout', request.state.request_id, {}, {})
        response.delete_cookie(COOKIE, path=COOKIE_PATH, httponly=True, samesite='strict', secure=request.url.scheme == 'https')


def assignment_status(assignment):
    if assignment.status not in ('completed', 'cancelled') and assignment.expires_at and aware(assignment.expires_at) <= now():
        return 'expired'
    return assignment.status


class AdminReader:
    def __init__(self, service):
        self.service = service

    def catalog(self):
        study = load_study(PROJECT, self.service.settings.study_file)
        return {'studyId': study['study_id'], 'runtimeMode': 'deterministic', 'minimumTurns': 3, 'defaultMaxTurns': 20,
                'modelRef': 'deterministic-integration-v1',
                'tasks': [{'taskCode': task['id'], 'number': task['case_id'].zfill(2), 'caseId': task['case_id'],
                           'enabled': not task['probe_enabled']} for task in study['tasks']]}

    @staticmethod
    def status_expression():
        return case((Assignment.status.in_(['completed', 'cancelled']), Assignment.status),
                    (Assignment.expires_at <= now(), 'expired'), else_=Assignment.status)

    def overview(self, session):
        status = self.status_expression()
        statuses = dict(session.execute(select(status, func.count()).group_by(status)).all())
        tasks = dict(session.execute(select(Task.status, func.count()).group_by(Task.status)).all())
        jobs = dict(session.execute(select(Job.status, func.count()).where(Job.kind.in_(['deterministic_turn', 'advisor_turn', 'advisor_validation']),
                    Job.status.in_(['queued', 'running'])).group_by(Job.status)).all())
        return {'runtimeMode': 'optional-agent', 'worker': worker_status(session), 'participants': {key: statuses.get(key, 0) for key in
                ['pending', 'in_progress', 'completed', 'cancelled', 'expired']}, 'tasks': tasks,
                'jobs': jobs, 'batches': list(session.scalars(select(Assignment.batch_id).where(
                    Assignment.batch_id.is_not(None)).distinct().order_by(Assignment.batch_id)))}

    def assignment_row(self, assignment, profile, total, completed):
        return {'participantId': assignment.participant_id, 'codeDisplay': f'FCM · {assignment.participant_id[:8].upper()}',
                'testCode': self.service.stored_code(assignment),
                'studyId': assignment.study_id, 'batchId': assignment.batch_id, 'condition': assignment.condition,
                'status': assignment_status(assignment), 'profileStatus': profile.get('submission_status', 'pending'),
                'taskCount': total, 'completedTasks': completed, 'assignedAt': stamp(assignment.assigned_at),
                'startedAt': stamp(assignment.started_at) if assignment.started_at else None,
                'completedAt': stamp(assignment.completed_at) if assignment.completed_at else None,
                'expiresAt': stamp(assignment.expires_at) if assignment.expires_at else None}

    def participant_filters(self, status=None, condition=None, batch=None, query=None, config_ref=None, unnamed=False):
        filters = []
        if status:
            filters.append(self.status_expression() == status)
        if condition:
            filters.append(Assignment.condition == condition)
        if batch:
            filters.append(Assignment.batch_id == batch)
        if unnamed:
            filters.append(Assignment.batch_id.is_(None))
        if config_ref:
            filters.append(Assignment.config_ref == config_ref)
        if query:
            # Literal substring, with wildcard characters escaped by SQLAlchemy.
            lookup = query.strip()
            display = re.fullmatch(r'FCM\s*[·・.]\s*([0-9a-f]{8})', lookup, re.IGNORECASE)
            if display:
                lookup = display.group(1)
            match = Assignment.participant_id.contains(lookup.lower(), autoescape=True)
            normalized = ''.join(c for c in query.upper() if c not in ' -\t\r\n')
            if len(normalized) == 16 and normalized.isascii() and normalized.isalnum():
                match = or_(match, Assignment.test_code_hash == self.service.code_hash(query))
            filters.append(match)
        return filters

    def participants(self, session, page, size, status=None, condition=None, batch=None, query=None, config_ref=None, unnamed=False):
        filters = self.participant_filters(status, condition, batch, query, config_ref, unnamed)
        total = session.scalar(select(func.count()).select_from(Assignment).where(*filters))
        assignments = list(session.scalars(select(Assignment).where(*filters).order_by(
            Assignment.assigned_at.desc(), Assignment.participant_id).offset((page - 1) * size).limit(size)))
        ids = [a.participant_id for a in assignments]
        profiles = {p.participant_id: p.profile for p in session.scalars(select(Participant).where(Participant.participant_id.in_(ids)))}
        counts = {pid: (count, complete) for pid, count, complete in session.execute(select(Task.participant_id,
            func.count(), func.sum(case((Task.status == 'completed', 1), else_=0))).where(
                Task.participant_id.in_(ids)).group_by(Task.participant_id))}
        return {'items': [self.assignment_row(a, profiles[a.participant_id], *counts.get(a.participant_id, (0, 0)))
                          for a in assignments], 'total': total, 'page': page, 'pageSize': size}

    def export_codes(self, session, status=None, condition=None, batch=None, query=None, config_ref=None, unnamed=False):
        output = io.StringIO(newline='')
        writer = csv.writer(output)
        writer.writerow(['participant_id', 'test_code', 'condition', 'batch_id', 'status', 'assigned_at_beijing', 'expires_at_beijing'])
        def cell(value):
            value = str(value or '')
            return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n')) else value
        def beijing(value):
            return aware(value).astimezone(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds') if value else ''
        for a in session.scalars(select(Assignment).where(*self.participant_filters(status, condition, batch, query, config_ref, unnamed))
                                .order_by(Assignment.assigned_at.desc(), Assignment.participant_id)):
            writer.writerow([a.participant_id, self.service.stored_code(a) or '', a.condition,
                             cell(a.batch_id), assignment_status(a), beijing(a.assigned_at), beijing(a.expires_at)])
        return '\ufeff' + output.getvalue()

    def task_summary(self, task, config):
        scenario = next(s for s in config['bundle']['scenarios'] if s['scenario_id'] == task.scenario_id)
        return {**self.service.task_dto(task, config), 'status': task.status, 'taskCode': task.task_code,
                'number': scenario['case_id'].zfill(2),
                'scenarioId': task.scenario_id, 'modelRef': task.model_ref, 'targetOptionId': task.target_option_id,
                'optionOrder': task.option_order, 'attemptCount': len(task.task_data['attempts']),
                'startedAt': stamp(task.started_at) if task.started_at else None,
                'completedAt': stamp(task.completed_at) if task.completed_at else None, 'revision': task.revision}

    def participant(self, session, participant_id):
        assignment = session.get(Assignment, participant_id)
        fail(assignment is not None, 'not_found', '参与记录不存在。', 404)
        participant = session.get(Participant, participant_id)
        config = self.service.config(assignment)
        tasks = self.service.ordered_tasks(session.scalars(select(Task).where(Task.participant_id == participant_id)), config)
        # Commands contain internal idempotency bookkeeping; only answers and their provenance belong here.
        profile = {k: v for k, v in participant.profile.items() if k != 'commands'}
        return {**self.assignment_row(assignment, profile, len(tasks), sum(t.status == 'completed' for t in tasks)),
                'configRef': assignment.config_ref, 'runtimeMode': config['runtime_mode'],
                'policy': config['policy'], 'profile': profile, 'questions': config['profile']['questions'],
                'tasks': [self.task_summary(task, config) for task in tasks]}

    def task(self, session, task_id):
        task = session.get(Task, task_id)
        fail(task is not None, 'not_found', '任务不存在。', 404)
        assignment = session.get(Assignment, task.participant_id)
        config = self.service.config(assignment)
        attempts = deepcopy(task.task_data['attempts'])
        from .model_runtime import hydrate_turn_calls
        hydrate_turn_calls(session, [t for a in attempts for t in a['turns']])
        for attempt in attempts:
            attempt.pop('commands', None)
        scenario = self.service.store.scenario(config, task)
        # Document URLs in frozen artifacts are not browser credentials. Replay shows the original text only.
        scenario['references'] = [{k: v for k, v in r.items() if k != 'url'} for r in scenario['references']]
        return {**self.task_summary(task, config), 'participantId': task.participant_id,
                'codeDisplay': f'FCM · {task.participant_id[:8].upper()}', 'condition': assignment.condition,
                'configRef': assignment.config_ref, 'runtimeMode': config['runtime_mode'],
                'targetRule': config['target_rule'], 'policy': config['policy'], 'scenario': scenario,
                'strategyCatalog': [{'id': s['id'], 'name': s['name']} for s in self.service.store.get(config['advisor']['runtimeRef'])['toolbox']['strategies']] if config.get('advisor') else [],
                'attempts': attempts}
