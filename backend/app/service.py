"""Transaction-scoped experiment operations. Callers hold the assignment lock."""
from copy import deepcopy
from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
import json
import secrets

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import func, select, text
from sqlalchemy.orm.attributes import flag_modified

from .db import Assignment, AuditLog, Job, Participant, Task, now, uid


class Problem(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def fail(condition, code, message, status=409):
    if not condition:
        raise Problem(status, code, message)


def stamp(value=None):
    # SQLite returns naive datetimes. They represent UTC, not the browser's local timezone.
    return aware(value or now()).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def fingerprint(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def command(record, key, body):
    commands = record.setdefault('commands', {})
    prior = commands.get(key)
    value = fingerprint(body)
    fail(prior is None or prior['hash'] == value, 'idempotency_conflict', 'This request ID was already used for different input.')
    return prior, commands, value


class Service:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.signer = URLSafeTimedSerializer(settings.secret_key, salt='fcm-participant-access-v1')
        self.document_signer = URLSafeTimedSerializer(settings.secret_key, salt='fcm-document-access-v1')
        key = hmac.new(settings.secret_key.encode(), b'fcm-test-code-encryption-v1', 'sha256').digest()
        self.code_cipher = Fernet(urlsafe_b64encode(key))

    def seal_code(self, participant_id, code):
        return self.code_cipher.encrypt(json.dumps({'participant_id': participant_id, 'code': code}).encode()).decode()

    def stored_code(self, assignment):
        if not assignment.test_code_ciphertext:
            return None
        try:
            value = json.loads(self.code_cipher.decrypt(assignment.test_code_ciphertext.encode()))
            fail(value['participant_id'] == assignment.participant_id and
                 self.code_hash(value['code']) == assignment.test_code_hash,
                 'code_storage_invalid', '测试码存储校验失败。', 503)
            return value['code']
        except (InvalidToken, ValueError, KeyError):
            raise Problem(503, 'code_storage_invalid', '无法读取已保存的测试码。')

    def code_hash(self, code):
        normalized = ''.join(c for c in code.upper() if c not in ' -\t\r\n')
        fail(16 == len(normalized) and normalized.isascii() and normalized.isalnum(), 'invalid_code', 'The participant code is invalid.', 401)
        return hmac.new(self.settings.secret_key.encode(), normalized.encode(), 'sha256').hexdigest()

    @staticmethod
    def code():
        alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
        raw = ''.join(secrets.choice(alphabet) for _ in range(16))
        return '-'.join(raw[i:i+4] for i in range(0, 16, 4))

    def unique_code(self, session):
        for _ in range(32):
            code = self.code()
            value = self.code_hash(code)
            if not session.scalar(select(Assignment.participant_id).where(Assignment.test_code_hash == value)):
                return code, value
        raise Problem(503, 'code_generation_failed', 'Unable to allocate a unique participant code. Try again.')

    @staticmethod
    def valid_assignment(assignment):
        fail(assignment is not None and assignment.status != 'cancelled', 'access_inactive', 'This test is no longer active.', 401)
        fail(assignment.expires_at is None or aware(assignment.expires_at) > now(), 'access_expired', 'This test has expired.', 401)

    def authorize(self, session, token):
        try:
            payload = self.signer.loads(token, max_age=self.settings.token_seconds)
        except (BadSignature, SignatureExpired):
            raise Problem(401, 'credential_expired', 'Enter your participant code again to restore your progress.')
        assignment = session.scalar(select(Assignment).where(Assignment.participant_id == payload.get('participant_id')).with_for_update())
        self.valid_assignment(assignment)
        fail(payload.get('access_version') == assignment.access_version, 'credential_revoked', 'This access credential was replaced.', 401)
        return assignment

    def grant(self, assignment):
        token = self.signer.dumps({'participant_id': assignment.participant_id, 'access_version': assignment.access_version})
        expiry = now() + timedelta(seconds=self.settings.token_seconds)
        if assignment.expires_at:
            expiry = min(expiry, aware(assignment.expires_at))
        return {'accessToken': token, 'expiresAt': stamp(expiry), 'participantId': assignment.participant_id,
                'codeDisplay': f'FCM · {assignment.participant_id[:8].upper()}'}

    def exchange(self, session, code):
        assignment = session.scalar(select(Assignment).where(Assignment.test_code_hash == self.code_hash(code)).with_for_update())
        self.valid_assignment(assignment)
        if not assignment.test_code_ciphertext:
            normalized = ''.join(c for c in code.upper() if c not in ' -\t\r\n')
            assignment.test_code_ciphertext = self.seal_code(assignment.participant_id, '-'.join(normalized[i:i+4] for i in range(0, 16, 4)))
        if assignment.started_at is None:
            assignment.started_at = now()
            if assignment.status == 'pending':
                assignment.status = 'in_progress'
        return self.grant(assignment)

    def config(self, assignment):
        return self.store.get(assignment.config_ref)

    def issue(self, session, request_id, config_ref, count=None, batch_id=None, expires_at=None, condition='neutral', groups=None):
        config = self.store.get(config_ref)
        fail(not config.get('allocation'), 'quota_plan_requires_own_issuer', '此配置属于配额方案，请在配额随机分配页面发放。')
        from .advisor_config import can_issue
        fail(can_issue(config), 'runtime_not_ready', '请先完成设置中的 Advisor 验证，再创建新预览。也可不选模型使用确定性回复。')
        groups = groups if groups is not None else [{'condition': condition, 'count': count}]
        fail(1 <= len(groups) <= 2 and len({g['condition'] for g in groups}) == len(groups)
             and all(g['condition'] in ('neutral', 'goal') and type(g['count']) is int and g['count'] >= 1 for g in groups)
             and sum(g['count'] for g in groups) <= 1000, 'invalid_groups', '请选择实验条件并填写数量，单批最多 1000 个。', 422)
        if session.bind.dialect.name == 'postgresql':
            session.execute(text('SELECT pg_advisory_xact_lock(713021)'))
        body = {'config': config_ref, 'groups': groups, 'batch': batch_id, 'expires': stamp(expires_at) if expires_at else None}
        key = f'issue:{request_id}'
        prior = session.scalar(select(Job).where(Job.idempotency_key == key))
        if prior:
            fail(prior.progress['hash'] == fingerprint(body), 'idempotency_conflict', 'Generation request changed.')
            participants = prior.progress['participants']
            assignments = {a.participant_id: a for a in session.scalars(select(Assignment).where(Assignment.participant_id.in_(participants)))}
            return {'participants': participants, 'codes': [self.code_row(assignments[pid]) for pid in participants], 'replayed': True}
        fail(expires_at is None or aware(expires_at) > now(), 'invalid_expiry', '新发放的到期时间必须晚于当前时间。', 422)
        from .model_runtime import check_issuance_budget
        check_issuance_budget(session, config, len(config['tasks']) * sum(g['count'] for g in groups))
        codes, participants = [], []
        for condition in [g['condition'] for g in groups for _ in range(g['count'])]:
            participant_id = uid()
            code, code_hash = self.unique_code(session)
            profile = {'schema_version': 1, 'instrument_ref': self.store.instrument(config['profile']),
                       'submission_status': 'pending', 'answers': None, 'submitted_at': None}
            session.add(Participant(participant_id=participant_id, profile=profile))
            session.flush()
            assignment = Assignment(participant_id=participant_id, test_code_hash=code_hash, access_version=0,
                                    test_code_ciphertext=self.seal_code(participant_id, code),
                                    study_id=config['study_id'], batch_id=batch_id, config_ref=config_ref,
                                    condition=condition, status='pending', expires_at=expires_at)
            session.add(assignment)
            session.flush()
            for template in config['tasks']:
                scenario = next(s for s in config['bundle']['scenarios'] if s['case_id'] == template['case_id'])
                order = ['A', 'B']
                secrets.SystemRandom().shuffle(order)
                session.add(Task(task_id=uid(), participant_id=participant_id, task_code=template['id'],
                    scenario_id=scenario['scenario_id'], model_ref=config['model_ref'], target_option_id=secrets.choice(['A','B']),
                    option_order=order, status='pending', task_data={'schema_version': 1, 'attempts': []}, runtime_state={}, revision=0))
            participants.append(participant_id)
            codes.append(self.code_row(assignment))
        session.add(Job(kind='issue_codes', scope_ref={'config_ref': config_ref}, actor_id='researcher', idempotency_key=key,
                        status='succeeded', progress={'hash': fingerprint(body), 'participants': participants}, finished_at=now()))
        self.audit(session, 'issue_codes', request_id, {'participants': participants}, {'count': len(participants), 'groups': groups, 'config_ref': config_ref})
        return {'participants': participants, 'codes': codes, 'replayed': False}

    def code_row(self, assignment):
        return {'participantId': assignment.participant_id, 'code': self.stored_code(assignment),
                'condition': assignment.condition, 'batchId': assignment.batch_id}

    @staticmethod
    def audit(session, action, request_id, target, changes, reason=None):
        session.add(AuditLog(action=action, request_id=request_id, target_ref=target, change_summary=changes, reason=reason))

    def rotate(self, session, participant_id, request_id, cancel=False):
        assignment = session.scalar(select(Assignment).where(Assignment.participant_id == participant_id).with_for_update())
        fail(assignment is not None, 'not_found', 'Test not found.', 404)
        key = f'{"cancel" if cancel else "rotate"}:{participant_id}:{request_id}'
        prior = session.scalar(select(Job).where(Job.idempotency_key == key))
        if prior:
            # A delayed retry must not rotate again, or return a code from a later rotation as its own result.
            return {'participantId': participant_id, 'replayed': True,
                    'code': self.stored_code(assignment) if not cancel and prior.progress.get('access_version') == assignment.access_version else None}
        fail(cancel or assignment.status != 'cancelled', 'access_inactive', 'Cancelled access cannot be restored by rotating its code.')
        code, code_hash = (None, None) if cancel else self.unique_code(session)
        if code:
            assignment.test_code_hash = code_hash
            assignment.test_code_ciphertext = self.seal_code(participant_id, code)
        if cancel:
            assignment.status = 'cancelled'
            for task in session.scalars(select(Task).where(Task.participant_id == participant_id)):
                for attempt in task.task_data['attempts']:
                    if attempt['status'] == 'in_progress':
                        self.close_attempt(session, task, attempt, 'cancelled')
                if task.status != 'completed':
                    task.status = 'cancelled'
        assignment.access_version += 1
        session.add(Job(kind='cancel_code' if cancel else 'rotate_code', scope_ref={'participant_id': participant_id},
                        actor_id='researcher', idempotency_key=key, status='succeeded', progress={'access_version': assignment.access_version}, finished_at=now()))
        self.audit(session, 'cancel_code' if cancel else 'rotate_code', request_id, {'participant_id': participant_id}, {'access_version': assignment.access_version})
        return {'participantId': participant_id, 'code': code, 'replayed': False}

    def profile(self, session, assignment):
        config = self.config(assignment)
        return {'questions': config['profile']['questions'], 'answers': session.get(Participant, assignment.participant_id).profile['answers']}

    def submit_profile(self, session, assignment, request_id, answers):
        participant = session.get(Participant, assignment.participant_id)
        record = deepcopy(participant.profile)
        prior, commands, value = command(record, request_id, answers)
        if prior:
            return
        questions = self.config(assignment)['profile']['questions']
        known = {q['id']: q for q in questions}
        fail(set(answers) <= known.keys(), 'invalid_profile', 'Unknown profile question.', 422)
        for question in questions:
            answer = answers.get(question['id'])
            fail((answer is None and not question['required']) or answer in [o['value'] for o in question['options']],
                 'invalid_profile', 'Complete the required profile questions.', 422)
        fail(record['answers'] is None or record['answers'] == answers, 'already_submitted', 'Submitted profile answers cannot be replaced.')
        if record['answers'] is None:
            record.update(answers=answers, submission_status='submitted', submitted_at=stamp())
        commands[request_id] = {'hash': value}
        participant.profile = record

    def tasks(self, session, assignment):
        config = self.config(assignment)
        tasks = self.ordered_tasks(session.scalars(select(Task).where(Task.participant_id == assignment.participant_id)), config)
        next_task = next((task for task in tasks if task.status != 'completed'), None)
        result = []
        for task in tasks:
            value = self.task_dto(task, config)
            if config.get('allocation') and task.status == 'pending' and task is not next_task:
                value['status'] = 'unavailable'
            result.append(value)
        return result

    @staticmethod
    def ordered_tasks(tasks, config):
        return sorted(tasks, key=(lambda task: task.task_data['allocation']['position']) if config.get('allocation') else lambda task: task.task_code)

    @staticmethod
    def task_dto(task, config):
        template = next(t for t in config['tasks'] if t['id'] == task.task_code)
        scenario = next(s for s in config['bundle']['scenarios'] if s['scenario_id'] == task.scenario_id)
        return {'id': task.task_id, 'number': scenario['case_id'].zfill(2) if config.get('allocation') else template['number'], 'title': scenario['title'],
                **({'sequence': task.task_data['allocation']['position']} if config.get('allocation') else {}),
                'status': {'pending': 'available', 'in_progress': 'in_progress', 'completed': 'completed', 'cancelled': 'unavailable'}[task.status]}

    @staticmethod
    def task(session, assignment, task_id):
        task = session.get(Task, task_id)
        fail(task is not None and task.participant_id == assignment.participant_id, 'not_found', 'Task not found.', 404)
        return task

    def attempt(self, session, assignment, attempt_id, allow_closed=False):
        # Identity is scoped before inspection; a session identifier is not authorization.
        for task in session.scalars(select(Task).where(Task.participant_id == assignment.participant_id)):
            data = deepcopy(task.task_data)
            found = next((a for a in data['attempts'] if a['attempt_id'] == attempt_id), None)
            if found:
                if not allow_closed:
                    fail(found['status'] in ('in_progress', 'completed'), 'attempt_closed', 'This attempt was closed. Return to the task list.')
                task.task_data = data
                return task, found
        raise Problem(404, 'not_found', 'Attempt not found.')

    def start(self, session, assignment, task_id, request_id):
        fail(assignment.status != 'completed', 'test_completed', 'This test is already complete.')
        fail(session.get(Participant, assignment.participant_id).profile['answers'] is not None, 'profile_required', 'Complete the background questionnaire first.')
        tasks = list(session.scalars(select(Task).where(Task.participant_id == assignment.participant_id)))
        task = self.task(session, assignment, task_id)
        key = f'start:{request_id}'
        for item in tasks:
            prior = item.task_data.get('commands', {}).get(key)
            if prior:
                fail(item.task_id == task_id, 'idempotency_conflict', 'This start request belongs to a different task.')
                return self.snapshot(session, assignment, prior['attempt_id'])
        active = next((item for item in tasks if item.status == 'in_progress'), None)
        fail(active is None or active.task_id == task_id, 'task_locked', 'Finish or leave the current task before starting another.')
        if active:
            return self.snapshot(session, assignment, task.runtime_state['current_attempt_id'])
        fail(task.status == 'pending', 'task_unavailable', 'This task cannot be started.')
        data = deepcopy(task.task_data)
        config = self.config(assignment)
        if config.get('allocation'):
            remaining = [item for item in self.ordered_tasks(tasks, config) if item.status != 'completed']
            fail(remaining and remaining[0].task_id == task_id, 'task_order_locked', 'Please complete the tasks in their assigned order.')
        attempt_id = uid()
        opening = {'id': uid(), 'role': 'assistant', 'text': 'Development integration session: replies are deterministic test responses. Ask a question about the materials to test the workflow.', 'timestamp': stamp()}
        if config['runtime_mode'] == 'agent':
            opening['text'] = self.store.get(config['advisor']['runtimeRef'])['prompt']['opening']
        attempt = {'attempt_id': attempt_id, 'attempt_no': len(data['attempts']) + 1, 'status': 'in_progress', 'phase': 'pre',
                   'started_at': stamp(), 'ended_at': None, 'stop_reason': None, 'opening': opening,
                   'measurements': {name: {'schema_version': 1, 'instrument_ref': f'decision-{name}@v1', 'submission_status': 'pending', 'answers': None, 'submitted_at': None} for name in ('pre','post')},
                   'turns': [], 'events': [], 'commands': {}, 'receipt': ''}
        data['attempts'].append(attempt)
        data.setdefault('commands', {})[key] = {'attempt_id': attempt_id}
        task.task_data, task.status = data, 'in_progress'
        task.started_at = task.started_at or now()
        task.runtime_state = {'current_attempt_id': attempt_id, 'active_turn_id': None}
        task.revision += 1
        return self.snapshot(session, assignment, attempt_id)

    def policy(self, task, attempt, config):
        completed = sum(t['status'] == 'completed' for t in attempt['turns'])
        active = bool(task.runtime_state.get('active_turn_id'))
        dialogue = attempt['status'] == 'in_progress' and attempt['phase'] == 'dialogue'
        return {'canEnd': dialogue and not active and completed >= config['policy']['minimum'], 'probeRequired': False,
                'completedTurns': completed, 'minTurnsBeforeEnd': config['policy']['minimum'], 'maxTurns': config['policy']['maximum'],
                'canSend': dialogue and not active and completed < config['policy']['maximum'], 'stage': attempt['phase']}

    def snapshot(self, session, assignment, attempt_id):
        task, attempt = self.attempt(session, assignment, attempt_id)
        config = self.config(assignment)
        scenario = self.store.scenario(config, task)
        scenario['options'].sort(key=lambda item: task.option_order.index(item['id']))
        for ref in scenario['references']:
            # Resource endpoint requires a separate short-lived token, checked against current access_version.
            ticket = self.document_signer.dumps({'participant_id': assignment.participant_id, 'access_version': assignment.access_version,
                                        'attempt_id': attempt_id, 'document_id': ref['document_id'], 'kind': 'document'})
            ref['url'] = f'/api/v1/attempts/{attempt_id}/documents/{ref["document_id"]}?ticket={ticket}'
        policy = self.policy(task, attempt, config)
        messages = ([attempt['opening']] if attempt['measurements']['pre']['answers'] is not None else []) + [self.present_message(assignment, attempt_id, message) for turn in attempt['turns'] for message in turn['messages']]
        active_id = task.runtime_state.get('active_turn_id')
        active = next((t for t in attempt['turns'] if t['turn_id'] == active_id), None)
        return {'task': self.task_dto(task, config), 'scenario': scenario, 'shared': config['bundle']['shared'], 'bundleRevision': assignment.config_ref,
                'session': {'id': attempt_id, 'taskId': task.task_id, 'taskNumber': self.task_dto(task, config)['number'],
                            'scenarioRevision': scenario['revision'], 'sharedRevision': config['bundle']['shared']['revision'],
                            'uiVersion': config['ui_version'], 'uiLocale': config['ui_locale'], 'initialMessage': attempt['opening'], 'policy': policy, 'runtimeMode': config['runtime_mode']},
                'progress': {'stage': attempt['phase'], 'dialogueStatus': active['status'] if active else 'ready', 'messages': messages,
                             'decisions': {key: item['answers'] for key, item in attempt['measurements'].items() if item['answers'] is not None},
                             'receipt': attempt['receipt'], 'activeTurn': {'turnId': active_id, 'status': active['status']} if active else None, 'revision': task.revision}}

    def decision(self, session, assignment, attempt_id, submission):
        task, attempt = self.attempt(session, assignment, attempt_id)
        stage, decision = submission['stage'], submission['decision']
        fail(stage in ('pre', 'post'), 'probe_disabled', 'Intermediate measurements are disabled.', 422)
        prior, commands, value = command(attempt, f'decision:{submission["requestId"]}', {'stage': stage, 'decision': decision})
        if not prior:
            record = attempt['measurements'][stage]
            if record['answers'] is not None:
                fail(record['answers'] == decision, 'already_submitted', 'A saved decision cannot be replaced.')
            else:
                fail(attempt['status'] == 'in_progress' and attempt['phase'] == stage, 'wrong_stage', 'This decision is not available at the current stage.')
                record.update(answers=decision, submission_status='submitted', submitted_at=stamp(), client_timestamp=submission['timestamp'])
                attempt['phase'] = 'dialogue' if stage == 'pre' else 'finishing'
            commands[f'decision:{submission["requestId"]}'] = {'hash': value}
            self.touch(task)
        return self.policy(task, attempt, self.config(assignment))

    @staticmethod
    def touch(task):
        task.task_data = deepcopy(task.task_data)
        flag_modified(task, 'task_data')
        task.revision += 1

    def submit_turn(self, session, assignment, attempt_id, message):
        task, attempt = self.attempt(session, assignment, attempt_id)
        prior = next((turn for turn in attempt['turns'] if turn['turn_id'] == message['id']), None)
        if prior:
            fail(prior['request_hash'] == fingerprint(message), 'idempotency_conflict', 'This message ID was already used for different input.')
            return self.turn_snapshot(task, attempt, prior, self.config(assignment), assignment)
        fail(self.policy(task, attempt, self.config(assignment))['canSend'], 'turn_blocked', 'Wait for the current reply or finish this task.')
        mode = self.config(assignment)['runtime_mode']
        turn = {'turn_id': message['id'], 'turn_no': len(attempt['turns']) + 1, 'status': 'queued',
                'request_hash': fingerprint(message), 'started_at': stamp(), 'finished_at': None,
                'messages': [{**message, 'received_at': stamp()}], 'selected_strategy': None, 'tool_calls': [], 'model_calls': [],
                'execution': {'runtime_mode': mode, 'model_calls': 0}}
        # received_at belongs to raw data, not the public Message DTO.
        attempt['turns'].append(turn)
        job = Job(job_id=uid(), kind='advisor_turn' if mode == 'agent' else 'deterministic_turn', actor_id=assignment.participant_id,
                  scope_ref={'participant_id': assignment.participant_id, 'task_id': task.task_id, 'attempt_id': attempt_id, 'turn_id': message['id']},
                  idempotency_key=f'turn:{attempt_id}:{message["id"]}', status='queued', progress={'step': 0})
        session.add(job)
        turn['execution']['job_id'] = job.job_id
        task.runtime_state = {**task.runtime_state, 'active_turn_id': message['id']}
        self.touch(task)
        return self.turn_snapshot(task, attempt, turn, self.config(assignment), assignment)

    @staticmethod
    def public_message(message):
        return {key: value for key, value in message.items() if key in ('id','role','text','timestamp','status','citations')}

    def present_message(self, assignment, attempt_id, message):
        result = deepcopy(self.public_message(message))
        for citation in result.get('citations', []):
            document = citation.get('documentId')
            if not document:
                continue
            ticket = self.document_signer.dumps({'participant_id': assignment.participant_id, 'access_version': assignment.access_version,
                                               'attempt_id': attempt_id, 'document_id': document, 'kind': 'document'})
            citation['url'] = f'/api/v1/attempts/{attempt_id}/documents/{document}?ticket={ticket}#page={citation.get("page", 1)}'
        return result

    def turn_snapshot(self, task, attempt, turn, config, assignment):
        result = {'turnId': turn['turn_id'], 'status': turn['status'], 'messages': [self.present_message(assignment, attempt['attempt_id'], m) for m in turn['messages']],
                  'policy': self.policy(task, attempt, config), 'stage': attempt['phase'], 'revision': task.revision}
        if turn.get('error'):
            result['error'] = turn['error']
        return result

    def get_turn(self, session, assignment, attempt_id, turn_id):
        task, attempt = self.attempt(session, assignment, attempt_id, allow_closed=True)
        turn = next((t for t in attempt['turns'] if t['turn_id'] == turn_id), None)
        fail(turn is not None, 'not_found', 'Turn not found.', 404)
        return self.turn_snapshot(task, attempt, turn, self.config(assignment), assignment)

    def end(self, session, assignment, attempt_id, request_id):
        task, attempt = self.attempt(session, assignment, attempt_id)
        prior, commands, value = command(attempt, f'end:{request_id}', {})
        if not prior and attempt['phase'] == 'dialogue':
            fail(self.policy(task, attempt, self.config(assignment))['canEnd'], 'cannot_end', 'Complete at least three exchanges and wait for the reply.')
            attempt.update(phase='post', dialogue_ended_at=stamp(), dialogue_end_reason='user')
        fail(attempt['phase'] in ('post','finishing','complete'), 'wrong_stage', 'Dialogue cannot be ended at this stage.')
        commands[f'end:{request_id}'] = {'hash': value}
        self.touch(task)

    def complete(self, session, assignment, attempt_id, request_id):
        task, attempt = self.attempt(session, assignment, attempt_id)
        fail(all(item['submission_status'] == 'submitted' for item in attempt['measurements'].values()), 'measurements_required', 'Submit both decisions before completing this task.')
        if attempt['status'] != 'completed':
            fail(attempt['phase'] == 'finishing', 'wrong_stage', 'This task cannot be completed yet.')
            attempt.update(status='completed', phase='complete', ended_at=stamp(), stop_reason='completed', receipt=f'FCM-{uid()}')
            task.status, task.completed_at, task.runtime_state = 'completed', now(), {}
            self.touch(task)
            session.flush()
            remaining = session.scalar(select(func.count()).select_from(Task).where(Task.participant_id == assignment.participant_id, Task.status != 'completed'))
            if remaining == 0:
                assignment.status, assignment.completed_at = 'completed', now()
        return {'receipt': attempt['receipt']}

    def close_attempt(self, session, task, attempt, reason='abandoned'):
        attempt.update(status='abandoned', ended_at=stamp(), stop_reason=reason)
        for turn in attempt['turns']:
            if turn['status'] in ('queued','running'):
                turn.update(status='cancelled', finished_at=stamp(), error='This attempt was closed.')
                for message in turn['messages']:
                    if message['role'] == 'assistant':
                        message['status'] = 'interrupted'
                job = session.get(Job, turn['execution']['job_id'])
                job.status, job.finished_at = 'cancelled', now()
        task.runtime_state, task.status = {}, 'pending'
        self.touch(task)

    def abandon(self, session, assignment, attempt_id, request_id):
        task, attempt = self.attempt(session, assignment, attempt_id, allow_closed=True)
        if attempt['status'] == 'in_progress':
            self.close_attempt(session, task, attempt)

    def record_event(self, session, assignment, attempt_id, event):
        task, attempt = self.attempt(session, assignment, attempt_id)
        existing = next((item for item in attempt['events'] if item['id'] == event['id']), None)
        if existing:
            fail(existing['hash'] == fingerprint(event), 'idempotency_conflict', 'This event ID was already used.')
            return
        fail(len(attempt['events']) < 5000, 'event_limit', 'The event limit was reached.', 422)
        attempt['events'].append({**event, 'hash': fingerprint(event), 'server_received_at': stamp()})
        self.touch(task)
