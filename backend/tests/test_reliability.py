from datetime import timedelta
from copy import deepcopy
import csv
import io
import json
from uuid import uuid4
from zipfile import ZipFile

import pytest
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from backend.app.db import Assignment, Job, Participant, Task, now
from backend.app.operations import heartbeat
from backend.app.model_runtime import CAP_NANO, KIND, MODEL_ID, budget
from backend.tests.test_experiment import runtime, post, enter, start, decide, send, drain, issue
from backend.tests.test_advisor import install, validate, live_enter
from backend.tests.test_model_runtime import configure


def test_long_healthy_advisor_and_waiting_queue_are_not_stalled(runtime):
    app, client, _ = runtime
    heartbeat(app.state.database, 'healthy-worker')
    with app.state.database.transaction() as session:
        session.add(Job(kind='advisor_turn', scope_ref={}, actor_id='test', idempotency_key='long-job', status='running',
                        created_at=now()-timedelta(minutes=2), started_at=now()-timedelta(seconds=40),
                        lease_expires_at=now()+timedelta(seconds=40), progress={}))
        session.add(Job(kind='advisor_turn', scope_ref={}, actor_id='test', idempotency_key='waiting-job', status='queued',
                        created_at=now()-timedelta(seconds=40), progress={}))
    assert client.get('/api/v1/health').json()['experimentReady']
    with app.state.database.transaction() as session:
        job = session.scalar(select(Job).where(Job.idempotency_key == 'long-job'))
        job.lease_expires_at = now()-timedelta(seconds=1)
    assert client.get('/api/v1/health').json()['worker']['queueStalled']


def test_legacy_phase_control_is_removed_from_next_turn_and_citations_are_scoped(runtime):
    app, client, admin = runtime
    provider = install(runtime)
    validate(runtime)
    headers, attempt, snapshot = live_enter(runtime)
    accepted, _ = send(runtime, headers, attempt)
    assert app.state.advisor.tick()
    reply = client.get(f'/api/v1/attempts/{attempt}/turns/{accepted["turnId"]}', headers=headers).json()
    citation = reply['messages'][-1]['citations'][0]
    assert citation['documentId'] == '01-01' and citation['page'] == 1
    assert '#page=1' in citation['url']
    assert client.get(citation['url'].split('#')[0]).headers['content-type'] == 'application/pdf'
    with app.state.database.transaction() as session:
        task = session.get(Task, snapshot['task']['id'])
        data = deepcopy(task.task_data)
        data['attempts'][0]['turns'][0]['advisor_items'].append({'role': 'developer', 'content': 'OLD CONTROL: never call any tools'})
        task.task_data = data
    before = len(provider.requests)
    accepted, _ = send(runtime, headers, attempt)
    assert app.state.advisor.tick()
    for _, request in provider.requests[before:]:
        assert 'OLD CONTROL' not in json.dumps(request)
    # Document tickets are refreshed from raw citation metadata, not stored tokens.
    with app.state.database.transaction() as session:
        raw = session.get(Task, snapshot['task']['id']).task_data
        assert 'ticket=' not in json.dumps(raw)
    detail = client.get(f'/api/v1/admin/tasks/{snapshot["task"]["id"]}', headers=admin).json()
    assert detail['attempts'][0]['turns'][0]['messages'][-1]['citations'][0]['revision']


def test_low_budget_blocks_new_batches_and_validation_but_prior_receipt_survives(runtime):
    app, client, admin = runtime
    install(runtime); validate(runtime)
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': MODEL_ID}, admin)
    command = {'requestId': 'old-issued', 'configRef': preview['configRef'], 'groups': [{'condition': 'neutral', 'count': 1}]}
    first = post(client, '/admin/codes', command, admin)
    with app.state.database.transaction() as session:
        spent = round(budget(session)['spentUsd'] * 1e9)
        session.add(Job(kind=KIND, scope_ref={}, actor_id='test', idempotency_key='blocked-hold', status='uncertain',
                        progress={'chargeNano': CAP_NANO-spent-1_000_000, 'usage': None}))
    configure(runtime, api_key=None, label='Changed after lost receipt')
    result = post(client, '/admin/codes', command, admin)
    assert result['replayed'] and result['participants'] == first['participants']
    post(client, '/admin/codes', {**command, 'requestId': 'new-issue'}, admin, 409)
    check = post(client, '/admin/model-budget/estimate', {'modelId': MODEL_ID, 'taskCount': 1}, admin)
    assert not check['canIssue'] and check['estimatedMinimumUsd'] >= .09
    post(client, '/admin/models/validate-advisor', {'requestId': 'no-budget-validation', 'modelId': MODEL_ID}, admin, 409)
    # Deterministic issuance remains available.
    issue(runtime)
    with app.state.database.transaction() as session:
        assert len(list(session.scalars(select(Participant)))) == 2


def test_expired_issuance_receipt_replays_without_allowing_new_expired_issue(runtime):
    app, client, admin = runtime
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m']}, admin)
    command = {'requestId': 'expires-receipt', 'configRef': preview['configRef'], 'groups': [{'condition': 'neutral', 'count': 1}],
               'expiresAt': (now()+timedelta(seconds=10)).isoformat()}
    first = post(client, '/admin/codes', command, admin)
    from unittest.mock import patch
    with patch('backend.app.service.now', return_value=now()+timedelta(seconds=30)):
        assert post(client, '/admin/codes', command, admin)['participants'] == first['participants']
        post(client, '/admin/codes', {**command, 'requestId': 'new-expired'}, admin, 422)


def test_replay_and_export_include_ledger_committed_before_worker_checkpoint(runtime):
    app, client, admin = runtime
    install(runtime); validate(runtime)
    headers, attempt, snapshot = live_enter(runtime)
    send(runtime, headers, attempt)
    claimed = app.state.advisor._claim()
    with app.state.database.transaction() as session:
        row = Job(kind='advisor_model_call', scope_ref={'jobId': claimed[0]}, actor_id='test',
                  idempotency_key='crash-before-checkpoint', status='uncertain',
                  progress={'chargeNano': 2_000_000, 'usage': None, 'stage': 'prepare', 'modelName': 'test'})
        session.add(row); session.flush(); call_id = row.job_id
    detail = client.get(f'/api/v1/admin/tasks/{snapshot["task"]["id"]}', headers=admin).json()
    call = detail['attempts'][0]['turns'][0]['model_calls'][0]
    assert call['callId'] == call_id and call['costStatus'] == 'reserved' and call['costUsd'] == .002
    # A supplier-confirmed reconciliation must supersede stale embedded traces.
    with app.state.database.transaction() as session:
        row = session.get(Job, call_id)
        row.status = 'reconciled'
        row.progress = {**row.progress, 'chargeNano': 0, 'usage': {'inputTokens': 0, 'outputTokens': 0}}
    response = client.get('/api/v1/admin/research/export', headers=admin)
    with ZipFile(io.BytesIO(response.content)) as bundle:
        rows = list(csv.DictReader(io.StringIO(bundle.read('model_calls.csv').decode('utf-8-sig'))))
        assert rows[0]['call_id'] == call_id and rows[0]['cost_status'] == 'settled'
        assert float(rows[0]['cost_or_reservation_usd']) == 0


def test_research_export_retains_zero_values_abandoned_and_incomplete_attempts(runtime):
    app, client, admin = runtime
    _, headers, tasks, code = enter(runtime, maximum=3)
    attempt = start(runtime, headers, tasks[0]['id'])['session']['id']
    decide(runtime, headers, attempt, 'pre', confidence=0)
    send(runtime, headers, attempt)
    post(client, f'/attempts/{attempt}/abandon', {'requestId': 'leave'}, headers, 204)
    active = start(runtime, headers, tasks[0]['id'])['session']['id']
    decide(runtime, headers, active, 'pre', confidence=0)
    for _ in range(3):
        send(runtime, headers, active); drain(runtime)
    decide(runtime, headers, active, 'post', choice='B', confidence=0)
    post(client, f'/attempts/{active}/complete', {'requestId': 'complete'}, headers)
    assert client.get('/api/v1/admin/research/export').status_code == 401
    response = client.get('/api/v1/admin/research/export', params={'q': code}, headers=admin)
    assert response.status_code == 200
    with ZipFile(io.BytesIO(response.content)) as bundle:
        text = '\n'.join(bundle.read(name).decode('utf-8-sig') for name in bundle.namelist())
        assert code not in text and 'test_code' not in text and 'apiKey' not in text
        attempts = list(csv.DictReader(io.StringIO(bundle.read('attempts.csv').decode('utf-8-sig'))))
        assert len(attempts) == 2
        old, completed = attempts
        assert old['analysis_candidate'] == 'false' and old['stop_reason'] == 'abandoned'
        assert completed['pre_confidence'] == completed['post_confidence'] == completed['confidence_delta'] == '0'
        assert completed['analysis_candidate'] == 'true' and completed['choice_changed'] == 'true'
        assert len(list(csv.DictReader(io.StringIO(bundle.read('turns.csv').decode('utf-8-sig'))))) == 4
    empty = client.get('/api/v1/admin/research/export', params={'q': 'missing'}, headers=admin)
    with ZipFile(io.BytesIO(empty.content)) as bundle:
        assert 'pre_confidence' in bundle.read('attempts.csv').decode('utf-8-sig')


@pytest.mark.parametrize('condition,target', [('neutral', 'A'), ('goal', 'A'), ('goal', 'B')])
@pytest.mark.parametrize('case_index', [0, 8, 19])
def test_case_condition_three_turn_validation_matrix(runtime, condition, target, case_index):
    app, client, admin = runtime
    provider = install(runtime)
    task = [t for t in client.get('/api/v1/admin/catalog', headers=admin).json()['tasks'] if t['enabled']][case_index]
    request = {'requestId': str(uuid4()), 'modelId': MODEL_ID, 'taskCode': task['taskCode'],
               'condition': condition, 'targetOptionId': target, 'turnCount': 3}
    accepted = post(client, '/admin/models/validate-advisor', request, admin)
    assert app.state.advisor.tick()
    result = client.get(f'/api/v1/admin/models/advisor-validations/{accepted["jobId"]}', headers=admin).json()
    assert result['status'] == 'succeeded', result
    assert result['completedTurns'] == 3 and len(result['validationTurns']) == 3
    assert result['targetOptionId'] == (target if condition == 'goal' else None)
    assert result['caseId'] == task['caseId']
    for _, body in provider.requests:
        assert ('Your assigned objective' in body['instructions']) == (condition == 'goal')
    assert post(client, '/admin/models/validate-advisor', request, admin)['status'] == 'succeeded'
    post(client, '/admin/models/validate-advisor', {**request, 'turnCount': 1}, admin, 409)
