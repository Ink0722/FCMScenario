"""Quota-constrained allocation, frozen previews and one-time plan issuance.

This workspace feature is independent of the existing identical-task code issuer.
Randomization is reproducible, not a claim of uniform sampling over all matrices.
"""
from collections import Counter, deque
from datetime import datetime
import csv
import io
from itertools import combinations
import random
import secrets

from sqlalchemy import func, select, text

from .content import load_study
from .db import Assignment, Job, Participant, Task, now, uid
from .service import Service, fail, fingerprint, stamp
from .settings import PROJECT

ALGORITHM = 'balanced-load-edge-colour-ab-v2'
CONDITIONS = ('neutral', 'goal')


def validate_quotas(quotas, per_person):
    fail(type(per_person) is int and 1 <= per_person <= 20, 'invalid_quota', '每人任务数须为 1–20 的整数。', 422)
    fail(quotas and len({q['caseId'] for q in quotas}) == len(quotas), 'invalid_quota', '至少填写一个 case，且 case 不能重复。', 422)
    counts = {}
    for condition in CONDITIONS:
        fail(all(type(q[condition]) is int and 0 <= q[condition] <= 1000 for q in quotas), 'invalid_quota', '配额须为 0–1000 的整数。', 422)
        total = sum(q[condition] for q in quotas)
        title = 'Neutral' if condition == 'neutral' else 'Goal'
        fail(total % per_person == 0, 'quota_not_divisible',
             f'{title} 共 {total} 份任务，不能按每人 {per_person} 项整分。请调整该组配额，使总数为 {per_person} 的倍数。', 422)
        count = total // per_person
        for quota in quotas:
            fail(quota[condition] <= count, 'quota_case_overflow',
                 f'Case {quota["caseId"]} 的 {title} 配额为 {quota[condition]}，但该组仅有 {count} 人。每人不能重复同一 case，请降低该配额或增加其他 case 配额。', 422)
        counts[condition] = count
    fail(0 < sum(counts.values()) <= 1000, 'quota_participant_limit', '方案总人数须为 1–1000 人。', 422)
    return counts


def balanced_order(rows, cases, rng, per_person):
    """Edge-colour a regularized bipartite multigraph into task positions.

    Split each case's neighbours into clones of at most k. Complete the graph to
    k-regular with dummy people, then remove k perfect matchings. Each real person
    gets each position once; a case occurs floor(q/k) or ceil(q/k) times per position.
    """
    neighbours = {case: [] for case in cases}
    for person, assigned in enumerate(rows):
        for case in sorted(assigned):
            neighbours[case].append(person)
    clones = []
    graph = [{} for _ in rows]
    deficits = []
    for case in cases:
        people = neighbours[case]
        rng.shuffle(people)
        for offset in range(0, len(people), per_person):
            group = people[offset:offset + per_person]
            right = len(clones)
            clones.append(case)
            for person in group:
                graph[person][right] = 1
            deficits.extend([right] * (per_person - len(group)))
    rng.shuffle(deficits)
    for offset in range(0, len(deficits), per_person):
        graph.append(dict(Counter(deficits[offset:offset + per_person])))
    assert len(graph) == len(clones)
    result = [[] for _ in rows]
    for _ in range(per_person):
        left_match, right_match = [-1] * len(graph), [-1] * len(graph)
        order = list(range(len(graph)))
        rng.shuffle(order)
        adjacency = [list(edges) for edges in graph]
        for edges in adjacency:
            rng.shuffle(edges)
        for root in order:
            queue, seen, parent, free = deque([root]), {root}, {}, None
            while queue and free is None:
                person = queue.popleft()
                for right in adjacency[person]:
                    if right in parent:
                        continue
                    parent[right] = person
                    previous = right_match[right]
                    if previous == -1:
                        free = right
                        break
                    if previous not in seen:
                        seen.add(previous)
                        queue.append(previous)
            assert free is not None, 'Regular bipartite graph must have a perfect matching'
            while free != -1:
                person = parent[free]
                old = left_match[person]
                left_match[person], right_match[free] = free, person
                free = old
        for person, right in enumerate(left_match):
            if person < len(rows):
                result[person].append(clones[right])
            graph[person][right] -= 1
            if graph[person][right] == 0:
                del graph[person][right]
    return result


def allocate(quotas, per_person, seed):
    counts = validate_quotas(quotas, per_person)
    rng = random.Random(seed)
    members = []
    cases = sorted(q['caseId'] for q in quotas)
    for condition in CONDITIONS:
        count = counts[condition]
        if not count:
            continue
        rows = [set() for _ in range(count)]
        demands = sorted(quotas, key=lambda q: (-q[condition], rng.random()))
        for quota in demands:
            candidates = sorted(range(count), key=lambda index: (len(rows[index]), rng.random()))
            for index in candidates[:quota[condition]]:
                rows[index].add(quota['caseId'])
        assert all(len(row) == per_person for row in rows)
        # Degree-preserving switches spread combinations after the feasible start.
        if count > 1 and len({tuple(sorted(row)) for row in rows}) > 1:
            for _ in range(min(50000, max(100, count * per_person * 4))):
                a, b = rng.sample(range(count), 2)
                only_a, only_b = sorted(rows[a] - rows[b]), sorted(rows[b] - rows[a])
                if only_a and only_b:
                    x, y = rng.choice(only_a), rng.choice(only_b)
                    rows[a].remove(x); rows[a].add(y)
                    rows[b].remove(y); rows[b].add(x)
        ordered = balanced_order(rows, cases, rng, per_person)
        for index, assigned in enumerate(ordered):
            tasks = []
            for position, case in enumerate(assigned, 1):
                tasks.append({'caseId': case, 'position': position})
            members.append({'slot': f'{"N" if condition == "neutral" else "G"}{index + 1:04}', 'condition': condition, 'tasks': tasks})
    # Balance both marginals and the joint 2x2 distribution per case/condition.
    # For two remainder cells choose a diagonal, keeping both marginals equal.
    for condition in CONDITIONS:
        for case in cases:
            tasks = [task for member in members if member['condition'] == condition for task in member['tasks'] if task['caseId'] == case]
            cells = [('A', 'AB'), ('A', 'BA'), ('B', 'AB'), ('B', 'BA')]
            full, remainder = divmod(len(tasks), 4)
            values = cells * full
            values += rng.choice([[cells[0], cells[3]], [cells[1], cells[2]]]) if remainder == 2 else rng.sample(cells, remainder)
            rng.shuffle(values)
            for task, (target, order) in zip(tasks, values):
                task.update(targetOptionId=target, optionOrder=list(order))
    rng.shuffle(members)
    return members, counts


def lock(session):
    if session.bind.dialect.name == 'postgresql':
        session.execute(text('SELECT pg_advisory_xact_lock(713024)'))


class AllocationService:
    def __init__(self, service, environment):
        self.service, self.environment, self.store = service, environment, service.store

    def create(self, session, request_id, payload):
        lock(session)
        digest = fingerprint(payload)
        key = f'quota-preview:{request_id}'
        prior = session.scalar(select(Job).where(Job.idempotency_key == key))
        if prior:
            fail(prior.progress['hash'] == digest, 'idempotency_conflict', '该预览请求编号已用于其他配额。')
            return self.read(session, prior.result_ref)
        quotas = sorted([q for q in payload['quotas'] if q['neutral'] or q['goal']], key=lambda q: q['caseId'])
        counts = validate_quotas(quotas, payload['tasksPerPerson'])
        study = load_study(PROJECT, self.service.settings.study_file)
        catalogue = {task['case_id']: task for task in study['tasks'] if not task['probe_enabled']}
        fail(all(q['caseId'] in catalogue for q in quotas), 'unknown_case', '配额中包含未启用的 case。', 422)
        model = self.environment.freeze_model(session, payload['modelId'], self.store)
        seed = payload['seed'] or secrets.token_hex(16)
        members, _ = allocate(quotas, payload['tasksPerPerson'], seed)
        for member in members:
            for task in member['tasks']:
                task['taskCode'] = catalogue[task['caseId']]['id']
        plan_id = uid()
        config = self.store.preview([catalogue[q['caseId']]['id'] for q in quotas], payload['maxTurns'], model)
        config['target_rule'] = 'development-only-balanced-case-condition-v2'
        config['allocation'] = {'id': plan_id, 'algorithm': ALGORITHM, 'quotas': quotas,
                                'tasksPerPerson': payload['tasksPerPerson'], 'seed': seed, 'order': 'fixed'}
        config_ref = self.store.freeze(config)
        plan = {'kind': 'quota_allocation_plan', 'schema_version': 1, 'id': plan_id, 'configRef': config_ref,
                'batchId': payload['batchId'] or f'QUOTA-{plan_id[:8].upper()}', 'expiresAt': payload['expiresAt'],
                'createdAt': stamp(), 'quotas': quotas, 'tasksPerPerson': payload['tasksPerPerson'],
                'seed': seed, 'algorithm': ALGORITHM, 'counts': counts, 'members': members}
        ref = self.store.freeze(plan)
        session.add(Job(job_id=plan_id, kind='quota_plan', actor_id='researcher', scope_ref={'configRef': config_ref},
                        idempotency_key=key, status='ready', progress={'hash': digest}, result_ref=ref))
        Service.audit(session, 'preview_quota_plan', request_id, {'planRef': ref}, {'participants': len(members), 'quotas': quotas})
        session.flush()
        return self.read(session, ref)

    def load(self, session, ref, include_deleted=False):
        try:
            plan = self.store.get(ref)
        except (ValueError, FileNotFoundError):
            fail(False, 'not_found', '配额方案不存在。', 404)
        fail(isinstance(plan, dict) and plan.get('kind') == 'quota_allocation_plan', 'not_found', '配额方案不存在。', 404)
        job = session.get(Job, plan['id'])
        fail(job is not None and job.kind == 'quota_plan' and job.result_ref == ref, 'not_found', '配额方案未登记。', 404)
        fail(include_deleted or job.status != 'deleted', 'not_found', '配额方案已删除。', 404)
        return plan, job

    @staticmethod
    def issued(session, ref):
        return session.scalar(select(Job).where(Job.idempotency_key == f'quota-issued:{ref}'))

    def read(self, session, ref):
        plan, job = self.load(session, ref)
        config = self.store.get(plan['configRef'])
        issued = self.issued(session, ref)
        participant_ids = issued.progress['participants'] if issued else []
        assignments = {a.participant_id: a for a in session.scalars(select(Assignment).where(Assignment.participant_id.in_(participant_ids)))} if issued else {}
        members = []
        for index, member in enumerate(plan['members']):
            assignment = assignments.get(participant_ids[index]) if issued else None
            members.append({**member, 'participantId': assignment.participant_id if assignment else None,
                            'code': self.service.stored_code(assignment) if assignment else None})
        completed = Counter()
        if issued:
            for condition, scenario_id, count in session.execute(select(Assignment.condition, Task.scenario_id, func.count()).join(
                    Task, Task.participant_id == Assignment.participant_id).where(
                    Assignment.config_ref == plan['configRef'], Task.status == 'completed').group_by(Assignment.condition, Task.scenario_id)):
                case = next(s['case_id'] for s in config['bundle']['scenarios'] if s['scenario_id'] == scenario_id)
                completed[case, condition] = count
        checks = []
        position_counts = Counter((task['caseId'], member['condition'], task['position']) for member in plan['members'] for task in member['tasks'])
        targets = Counter((task['caseId'], member['condition'], task['targetOptionId']) for member in plan['members'] for task in member['tasks'])
        orders = Counter((task['caseId'], member['condition'], ''.join(task['optionOrder'])) for member in plan['members'] for task in member['tasks'])
        joint = Counter((task['caseId'], member['condition'], task['targetOptionId'] + '_' + ''.join(task['optionOrder'])) for member in plan['members'] for task in member['tasks'])
        pairs = Counter((member['condition'], a, b) for member in plan['members'] for a, b in combinations(sorted(task['caseId'] for task in member['tasks']), 2))
        for quota in plan['quotas']:
            values = {'caseId': quota['caseId']}
            for condition in CONDITIONS:
                positions = [position_counts[quota['caseId'], condition, position] for position in range(1, plan['tasksPerPerson'] + 1)]
                values[condition] = {'requested': quota[condition], 'planned': sum(positions),
                                     'issued': quota[condition] if issued else 0, 'completed': completed[quota['caseId'], condition],
                                     'positions': positions,
                                     'targets': {target: targets[quota['caseId'], condition, target] for target in ('A', 'B')},
                                     'optionOrders': {order: orders[quota['caseId'], condition, order] for order in ('AB', 'BA')},
                                     'combinations': {cell: joint[quota['caseId'], condition, cell] for cell in ('A_AB', 'A_BA', 'B_AB', 'B_BA')}}
            checks.append(values)
        expired = bool(plan['expiresAt'] and datetime.fromisoformat(plan['expiresAt']) <= now())
        from .advisor_config import can_issue as runtime_ready
        from .model_runtime import estimate
        budget_check = estimate(session, config, len(members) * plan['tasksPerPerson'])
        can_issue = not issued and not expired and runtime_ready(config) and budget_check['canIssue']
        return {**{k: plan[k] for k in ('batchId', 'createdAt', 'expiresAt', 'tasksPerPerson', 'seed', 'algorithm', 'counts', 'configRef')},
                'planRef': ref, 'issued': bool(issued), 'archived': job.status == 'archived', 'members': members, 'checks': checks,
                'quotas': plan['quotas'], 'maxTurns': config['policy']['maximum'],
                'cooccurrence': [{'cases': [a, b], **{condition: pairs[condition, a, b] for condition in CONDITIONS}}
                                 for a, b in combinations([q['caseId'] for q in plan['quotas']], 2)],
                'participantCount': len(members), 'taskCount': len(members) * plan['tasksPerPerson'],
                'model': config.get('model_selection'), 'runtimeMode': config['runtime_mode'], 'canIssue': can_issue, 'budgetCheck': budget_check,
                'readinessMessage': '方案已发放。' if issued else '方案访问时间已到期，请创建新方案。' if expired else
                    '请先完成 Advisor 验证，再创建新方案；原方案保持冻结状态。' if not runtime_ready(config) else budget_check['message']}

    def issue(self, session, ref, request_id):
        lock(session)
        if session.bind.dialect.name == 'postgresql':
            session.execute(text('SELECT pg_advisory_xact_lock(713021)'))
        command_key = f'quota-issue-command:{request_id}'
        prior = session.scalar(select(Job).where(Job.idempotency_key == command_key))
        fail(prior is None or prior.scope_ref['planRef'] == ref, 'idempotency_conflict', '该发放请求编号已用于其他方案。')
        plan, plan_job = self.load(session, ref)
        issued = self.issued(session, ref)
        if issued:
            if prior is None:
                session.add(Job(kind='quota_issue_command', scope_ref={'planRef': ref}, actor_id='researcher', idempotency_key=command_key,
                                status='succeeded', progress={}, finished_at=now()))
            ids = issued.progress['participants']
            assignments = {a.participant_id: a for a in session.scalars(select(Assignment).where(Assignment.participant_id.in_(ids)))}
            return {'planRef': ref, 'participants': ids, 'codes': [self.service.code_row(assignments[pid]) for pid in ids], 'replayed': True}
        config = self.store.get(plan['configRef'])
        from .advisor_config import can_issue
        fail(can_issue(config), 'runtime_not_ready', '请先完成 Advisor 验证，再创建新方案。')
        expiry = datetime.fromisoformat(plan['expiresAt']) if plan['expiresAt'] else None
        fail(expiry is None or expiry > now(), 'plan_expired', '方案访问时间已到期，请创建新方案。')
        from .model_runtime import check_issuance_budget
        check_issuance_budget(session, config, len(plan['members']) * plan['tasksPerPerson'])
        ids, codes = [], []
        for member in plan['members']:
            pid = uid()
            code, code_hash = self.service.unique_code(session)
            session.add(Participant(participant_id=pid, profile={'schema_version': 1, 'instrument_ref': self.store.instrument(config['profile']),
                        'submission_status': 'pending', 'answers': None, 'submitted_at': None}))
            session.flush()
            assignment = Assignment(participant_id=pid, test_code_hash=code_hash, test_code_ciphertext=self.service.seal_code(pid, code),
                study_id=config['study_id'], batch_id=plan['batchId'], config_ref=plan['configRef'], condition=member['condition'], expires_at=expiry)
            session.add(assignment)
            session.flush()
            for task in member['tasks']:
                scenario = next(s for s in config['bundle']['scenarios'] if s['case_id'] == task['caseId'])
                session.add(Task(task_id=uid(), participant_id=pid, task_code=task['taskCode'], scenario_id=scenario['scenario_id'],
                    model_ref=config['model_ref'], target_option_id=task['targetOptionId'], option_order=task['optionOrder'],
                    task_data={'schema_version': 1, 'attempts': [], 'allocation': {'position': task['position'], 'planRef': ref, 'slot': member['slot']}},
                    runtime_state={}))
            ids.append(pid); codes.append(self.service.code_row(assignment))
        session.add(Job(kind='quota_issue', scope_ref={'planRef': ref}, actor_id='researcher', idempotency_key=f'quota-issued:{ref}',
                        status='succeeded', progress={'participants': ids}, finished_at=now()))
        session.add(Job(kind='quota_issue_command', scope_ref={'planRef': ref}, actor_id='researcher', idempotency_key=command_key,
                        status='succeeded', progress={}, finished_at=now()))
        plan_job.status, plan_job.finished_at = 'issued', now()
        Service.audit(session, 'issue_quota_plan', request_id, {'planRef': ref}, {'participants': len(ids), 'tasks': len(ids) * plan['tasksPerPerson']})
        session.flush()
        return {'planRef': ref, 'participants': ids, 'codes': codes, 'replayed': False}

    def manage(self, session, ref, request_id, action):
        lock(session)
        plan, job = self.load(session, ref, include_deleted=True)
        key = f'quota-plan-command:{request_id}'
        prior = session.scalar(select(Job).where(Job.idempotency_key == key))
        if prior:
            fail(prior.scope_ref == {'planRef': ref, 'action': action}, 'idempotency_conflict', '该操作编号已用于其他方案或操作。')
            return prior.progress
        fail(job.status != 'deleted', 'not_found', '配额方案已删除。', 404)
        issued = bool(self.issued(session, ref))
        fail(action != 'delete' or not issued, 'issued_plan_cannot_delete', '已发放方案不能删除，请归档以保留参与记录。')
        fail(action != 'archive' or issued, 'unissued_plan_cannot_archive', '未发放方案可删除；归档用于已发放方案。')
        fail(action != 'restore' or job.status == 'archived', 'plan_not_archived', '方案尚未归档。')
        job.status = {'delete': 'deleted', 'archive': 'archived', 'restore': 'issued'}[action]
        result = {'planRef': ref, 'action': action, 'archived': job.status == 'archived', 'deleted': job.status == 'deleted'}
        session.add(Job(kind='quota_plan_command', scope_ref={'planRef': ref, 'action': action}, actor_id='researcher',
                        idempotency_key=key, status='succeeded', progress=result, finished_at=now()))
        Service.audit(session, f'{action}_quota_plan', request_id, {'planRef': ref}, result)
        session.flush()
        return result

    def list(self, session, page=1, size=20, archived=False):
        filters = [Job.kind == 'quota_plan', Job.status == 'archived' if archived else Job.status.in_(['ready', 'issued'])]
        rows = list(session.scalars(select(Job).where(*filters).order_by(Job.created_at.desc(), Job.job_id)
                                   .offset((page - 1) * size).limit(size)))
        items = []
        for row in rows:
            plan = self.store.get(row.result_ref)
            items.append({**{k: plan[k] for k in ('batchId', 'createdAt', 'tasksPerPerson', 'counts')}, 'planRef': row.result_ref,
                          'status': row.status, 'participantCount': len(plan['members']), 'caseCount': len(plan['quotas'])})
        return {'items': items, 'total': session.scalar(select(func.count()).select_from(Job).where(*filters)),
                'page': page, 'pageSize': size}

    def export(self, session, ref):
        plan = self.read(session, ref)
        output = io.StringIO(newline=''); writer = csv.writer(output)
        writer.writerow(['slot', 'participant_id', 'test_code', 'condition', 'position', 'case', 'target_option_id', 'option_order', 'plan_ref'])
        for member in plan['members']:
            for task in member['tasks']:
                writer.writerow([member['slot'], member['participantId'] or '', member['code'] or '', member['condition'], task['position'],
                                 task['caseId'], task['targetOptionId'], '>'.join(task['optionOrder']), ref])
        return '\ufeff' + output.getvalue()
