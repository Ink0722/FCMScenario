from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import csv
import io
import json
import random

import pytest
from sqlalchemy import func, select

from backend.app.allocation import allocate
from backend.app.db import Assignment, Job, Participant, Task, now
from backend.tests.test_experiment import runtime, post, enter, start, decide, send, drain
from backend.tests.test_model_runtime import configure


def request(request_id='quota-preview-1', **changes):
    return {'requestId': request_id, 'quotas': [
        {'caseId': '01', 'neutral': 2, 'goal': 2}, {'caseId': '02', 'neutral': 1, 'goal': 1}, {'caseId': '09', 'neutral': 1, 'goal': 1}],
        'tasksPerPerson': 2, 'maxTurns': 3, 'seed': 'reproducible-quota-seed', **changes}


def preview(runtime, **changes):
    return post(runtime[1], '/admin/allocation-plans', request(**changes), runtime[2])


def issue(runtime, plan, request_id='quota-issue-1', status=200):
    return post(runtime[1], f'/admin/allocation-plans/{plan["planRef"]}/issue', {'requestId': request_id}, runtime[2], status)


def verify_matrix(quotas, k, members):
    totals = Counter((m['condition'], t['caseId']) for m in members for t in m['tasks'])
    positions = Counter((m['condition'], t['caseId'], t['position']) for m in members for t in m['tasks'])
    for member in members:
        assert len(member['tasks']) == k and len({t['caseId'] for t in member['tasks']}) == k
        assert [t['position'] for t in member['tasks']] == list(range(1, k + 1))
        assert all(t['targetOptionId'] in ('A', 'B') and sorted(t['optionOrder']) == ['A', 'B'] for t in member['tasks'])
    for quota in quotas:
        for condition in ('neutral', 'goal'):
            assert totals[condition, quota['caseId']] == quota[condition]
            counts = [positions[condition, quota['caseId'], p] for p in range(1, k + 1)]
            assert max(counts) - min(counts) <= 1
            tasks = [task for member in members if member['condition'] == condition for task in member['tasks'] if task['caseId'] == quota['caseId']]
            target = Counter(task['targetOptionId'] for task in tasks)
            order = Counter(''.join(task['optionOrder']) for task in tasks)
            joint = Counter((task['targetOptionId'], ''.join(task['optionOrder'])) for task in tasks)
            assert abs(target['A'] - target['B']) <= 1
            assert abs(order['AB'] - order['BA']) <= 1
            cells = [joint[t, o] for t in ('A', 'B') for o in ('AB', 'BA')]
            assert max(cells) - min(cells) <= 1


def test_allocator_preserves_quotas_uniqueness_and_balanced_positions_across_uneven_cases():
    for seed in range(50):
        rng = random.Random(seed)
        cases, k = rng.randint(1, 20), rng.randint(1, 20)
        k = min(k, cases)
        wanted = Counter()
        for condition in ('neutral', 'goal'):
            for _ in range(rng.randint(1, 30)):
                for case in rng.sample(range(cases), k):
                    wanted[condition, case] += 1
        quotas = [{'caseId': f'{case + 1:02}', **{c: wanted[c, case] for c in ('neutral', 'goal')}} for case in range(cases)]
        members, _ = allocate(quotas, k, str(seed))
        verify_matrix(quotas, k, members)
        assert members == allocate(quotas, k, str(seed))[0]


def test_allocator_handles_maximum_1000_people_20000_tasks():
    quotas = [{'caseId': f'{case:02}', 'neutral': 1000, 'goal': 0} for case in range(1, 21)]
    members, counts = allocate(quotas, 20, 'large-boundary')
    assert len(members) == 1000 and counts == {'neutral': 1000, 'goal': 0}
    verify_matrix(quotas, 20, members)


def test_preview_is_persisted_idempotent_and_does_not_issue_participants(runtime):
    app, client, admin = runtime
    post(client, '/admin/allocation-plans', request(), status=401)
    plan = preview(runtime)
    assert plan['participantCount'] == 4 and plan['taskCount'] == 8 and plan['canIssue'] and not plan['issued']
    assert plan['counts'] == {'neutral': 2, 'goal': 2}
    verify_matrix(request()['quotas'], 2, plan['members'])
    assert all(m['participantId'] is None and m['code'] is None for m in plan['members'])
    assert preview(runtime)['planRef'] == plan['planRef']
    changed = request(tasksPerPerson=1)
    post(client, '/admin/allocation-plans', changed, admin, 409)
    same_seed = preview(runtime, request_id='same-seed-new-preview')
    assert same_seed['planRef'] != plan['planRef'] and same_seed['members'] == plan['members']
    assert client.get('/api/v1/admin/allocation-plans', headers=admin).json()['total'] == 2
    assert client.get('/api/v1/admin/participants', headers=admin).json()['total'] == 0
    with app.state.database.transaction() as session:
        assert session.scalar(select(func.count()).select_from(Task)) == 0
    assert client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).json()['members'] == plan['members']
    assert client.get('/api/v1/admin/allocation-plans/not-a-reference', headers=admin).status_code == 404


@pytest.mark.parametrize('changes,code', [
    ({'tasksPerPerson': True}, 'invalid_input'),
    ({'tasksPerPerson': 0}, 'invalid_input'),
    ({'quotas': [{'caseId': '01', 'neutral': 1, 'goal': 0}]}, 'quota_not_divisible'),
    ({'quotas': [{'caseId': '01', 'neutral': 4, 'goal': 0}]}, 'quota_case_overflow'),
    ({'quotas': [{'caseId': '01', 'neutral': 0, 'goal': 0}]}, 'invalid_quota'),
    ({'quotas': [{'caseId': '99', 'neutral': 2, 'goal': 2}, {'caseId': '02', 'neutral': 2, 'goal': 2}]}, 'unknown_case'),
    ({'quotas': [{'caseId': '01', 'neutral': 2, 'goal': 0}] * 2}, 'invalid_input'),
    ({'quotas': [{'caseId': '01', 'neutral': 1000, 'goal': 1000}], 'tasksPerPerson': 1}, 'quota_participant_limit'),
    ({'expiresAt': '2001-01-01T00:00:00+08:00'}, 'invalid_input'),
])
def test_invalid_quotas_never_create_silent_adjustments_or_codes(runtime, changes, code):
    _, client, admin = runtime
    error = post(client, '/admin/allocation-plans', request(**changes), admin, 422)
    assert error['code'] == code
    assert client.get('/api/v1/admin/allocation-plans', headers=admin).json()['total'] == 0
    assert client.get('/api/v1/admin/participants', headers=admin).json()['total'] == 0


def test_issuance_once_per_plan_is_atomic_even_with_different_request_ids(runtime):
    app, client, admin = runtime
    plan = preview(runtime)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda i: issue(runtime, plan, f'parallel-{i}'), range(4)))
    assert sum(not result['replayed'] for result in results) == 1
    assert all(result['participants'] == results[0]['participants'] for result in results)
    post(client, '/admin/codes', {'requestId': 'must-not-use-old-issuer', 'configRef': plan['configRef'], 'groups': [{'condition': 'neutral', 'count': 1}]}, admin, 409)
    with app.state.database.transaction() as session:
        assert session.scalar(select(func.count()).select_from(Participant)) == 4
        assert session.scalar(select(func.count()).select_from(Task)) == 8
        assert session.scalar(select(func.count()).select_from(Job).where(Job.kind == 'quota_issue')) == 1
    another = preview(runtime, request_id='another-plan')
    issue(runtime, another, 'parallel-0', 409)
    batch = client.get('/api/v1/admin/batches', headers=admin).json()['items'][0]
    assert batch['allocationPlanRef'] == plan['planRef']
    assert batch['participantCount'] == 4 and batch['taskTotal'] == 8


def test_sequential_tasks_cannot_be_skipped_and_order_survives_abandon_complete_rotate(runtime):
    app, client, admin = runtime
    plan = preview(runtime)
    result = issue(runtime, plan)
    issued_plan = client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).json()
    member = issued_plan['members'][0]
    grant, headers, tasks, _ = enter(runtime, code=member['code'])
    assert [task['sequence'] for task in tasks] == [1, 2]
    assert [task['number'] for task in tasks] == [task['caseId'] for task in member['tasks']]
    assert [task['status'] for task in tasks] == ['available', 'unavailable']
    blocked = post(client, f'/tasks/{tasks[1]["id"]}/start', {'requestId': 'skip-first'}, headers, 409)
    assert blocked['code'] == 'task_order_locked'
    first = start(runtime, headers, tasks[0]['id'])['session']['id']
    decide(runtime, headers, first, 'pre')
    send(runtime, headers, first)
    post(client, f'/attempts/{first}/abandon', {'requestId': 'leave-first'}, headers, 204)
    assert client.get('/api/v1/tasks', headers=headers).json()[1]['status'] == 'unavailable'
    first = start(runtime, headers, tasks[0]['id'])['session']['id']
    decide(runtime, headers, first, 'pre')
    for _ in range(3):
        send(runtime, headers, first); drain(runtime)
    decide(runtime, headers, first, 'post')
    post(client, f'/attempts/{first}/complete', {'requestId': 'finish-first'}, headers)
    current = client.get('/api/v1/tasks', headers=headers).json()
    assert [task['sequence'] for task in current] == [1, 2]
    assert [task['status'] for task in current] == ['completed', 'available']
    detail = client.get(f'/api/v1/admin/participants/{grant["participantId"]}', headers=admin).json()
    assert [task['sequence'] for task in detail['tasks']] == [1, 2]
    checked = client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).json()
    assert sum(check[member['condition']]['completed'] for check in checked['checks']) == 1
    rotated = post(client, f'/admin/participants/{grant["participantId"]}/rotate', {'requestId': 'quota-rotate'}, admin)
    exported = client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}/export', headers=admin)
    rows = list(csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig'))))
    assert len(rows) == 8
    assert {r['test_code'] for r in rows if r['participant_id'] == grant['participantId']} == {rotated['code']}
    after = client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).json()
    assert [m['tasks'] for m in after['members']] == [m['tasks'] for m in plan['members']]


def test_optional_model_is_frozen_for_entire_plan_without_paid_calls(runtime):
    _, client, admin = runtime
    configure(runtime)
    plan = preview(runtime, modelId='openai-gpt54-mini')
    assert not plan['canIssue'] and plan['runtimeMode'] == 'agent'
    assert 'test-secret-never-return' not in json.dumps(plan)
    issue(runtime, plan, status=409)
    assert client.get('/api/v1/admin/participants', headers=admin).json()['total'] == 0
    assert client.get('/api/v1/admin/settings', headers=admin).json()['modelBudget']['requestCount'] == 0


def test_expired_plan_blocks_new_issue_but_keeps_completed_issue_replay(runtime, monkeypatch):
    plan = preview(runtime, expiresAt=(now() + timedelta(hours=1)).isoformat())
    issued_plan = preview(runtime, request_id='issued-before-expiry', expiresAt=(now() + timedelta(hours=1)).isoformat())
    original = issue(runtime, issued_plan, request_id='before-expiry')
    future = now() + timedelta(hours=2)
    monkeypatch.setattr('backend.app.allocation.now', lambda: future)
    error = issue(runtime, plan, status=409)
    assert error['code'] == 'plan_expired'
    read = runtime[1].get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=runtime[2]).json()
    assert not read['canIssue']
    assert issue(runtime, issued_plan, request_id='after-expiry')['codes'] == original['codes']


def manage(runtime, plan, action, request_id=None, status=200):
    return post(runtime[1], f'/admin/allocation-plans/{plan["planRef"]}/{action}', {'requestId': request_id or f'{action}-plan'}, runtime[2], status)


def test_distributions_are_computed_from_frozen_members_including_zero_pairs_and_legacy_plans(runtime):
    app, client, admin = runtime
    plan = preview(runtime)
    assert plan['quotas'] == request()['quotas'] and plan['maxTurns'] == 3
    assert not plan['archived']
    for pair in plan['cooccurrence']:
        for condition in ('neutral', 'goal'):
            expected = sum(member['condition'] == condition and set(pair['cases']) <= {task['caseId'] for task in member['tasks']} for member in plan['members'])
            assert pair[condition] == expected
    assert len(plan['cooccurrence']) == 3
    # Simulate a registered v1 artifact; reading must report its actual imbalance.
    with app.state.database.transaction() as session:
        job = session.scalar(select(Job).where(Job.result_ref == plan['planRef']))
        original = app.state.service.store.get(plan['planRef'])
        original['algorithm'] = 'balanced-load-edge-colour-v1'
        for member in original['members']:
            for task in member['tasks']:
                task.update(targetOptionId='A', optionOrder=['B', 'A'])
        ref = app.state.service.store.freeze(original)
        job.result_ref = ref
    legacy = client.get(f'/api/v1/admin/allocation-plans/{ref}', headers=admin).json()
    assert legacy['algorithm'] == 'balanced-load-edge-colour-v1'
    assert all(check[c]['targets']['B'] == 0 and check[c]['optionOrders']['AB'] == 0 for check in legacy['checks'] for c in ('neutral', 'goal'))
    assert all(check[c]['targets']['A'] == check[c]['requested'] for check in legacy['checks'] for c in ('neutral', 'goal'))


def test_archive_restore_are_idempotent_preserve_access_and_never_reissue(runtime):
    _, client, admin = runtime
    plan = preview(runtime)
    manage(runtime, plan, 'archive', status=409)
    original = issue(runtime, plan)
    archived = manage(runtime, plan, 'archive')
    assert archived['archived'] and manage(runtime, plan, 'archive') == archived
    assert client.get('/api/v1/admin/allocation-plans', headers=admin).json()['total'] == 0
    assert client.get('/api/v1/admin/allocation-plans?archived=true', headers=admin).json()['total'] == 1
    read = client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).json()
    assert read['archived'] and read['issued'] and not read['canIssue']
    assert issue(runtime, plan, 'archived-issue-replay')['codes'] == original['codes']
    enter(runtime, code=original['codes'][0]['code'])
    manage(runtime, plan, 'delete', status=409)
    assert not manage(runtime, plan, 'restore')['archived']
    # Retrying a previously completed archive command must not undo a later restore.
    manage(runtime, plan, 'archive')
    assert not client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).json()['archived']
    assert client.get('/api/v1/admin/allocation-plans', headers=admin).json()['total'] == 1
    assert client.get('/api/v1/admin/allocation-plans?archived=true', headers=admin).json()['total'] == 0
    manage(runtime, plan, 'restore', request_id='restore-unarchived', status=409)
    manage(runtime, plan, 'delete', request_id='archive-plan', status=409)
    another = preview(runtime, request_id='another-archival-plan')
    manage(runtime, another, 'delete', request_id='archive-plan', status=409)


def test_delete_unissued_plan_is_audited_idempotent_and_blocks_stale_issuance(runtime):
    app, client, admin = runtime
    plan = preview(runtime)
    result = manage(runtime, plan, 'delete')
    assert result['deleted'] and manage(runtime, plan, 'delete') == result
    assert client.get('/api/v1/admin/allocation-plans', headers=admin).json()['total'] == 0
    assert client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}', headers=admin).status_code == 404
    assert client.get(f'/api/v1/admin/allocation-plans/{plan["planRef"]}/export', headers=admin).status_code == 404
    issue(runtime, plan, status=404)
    manage(runtime, plan, 'restore', status=404)
    with app.state.database.transaction() as session:
        assert session.scalar(select(func.count()).select_from(Participant)) == 0
        from backend.app.db import AuditLog
        assert session.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == 'delete_quota_plan')) == 1


def test_concurrent_delete_and_issue_never_create_an_invisible_issued_plan(runtime):
    app, client, admin = runtime
    plan = preview(runtime)
    def operation(action):
        return client.post(f'/api/v1/admin/allocation-plans/{plan["planRef"]}/{action}', json={'requestId': f'race-{action}'}, headers=admin)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(operation, ['delete', 'issue']))
    assert sum(response.status_code == 200 for response in results) == 1
    listed = client.get('/api/v1/admin/allocation-plans', headers=admin).json()['total']
    participants = client.get('/api/v1/admin/participants', headers=admin).json()['total']
    assert (listed, participants) in [(0, 0), (1, 4)]
