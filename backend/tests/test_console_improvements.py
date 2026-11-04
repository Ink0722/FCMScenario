from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import csv
import io

import httpx
from sqlalchemy import select

from backend.app.db import Assignment, AuditLog, Job, Task, now
from backend.app.model_runtime import KIND, MODEL_ID, RESERVE_NANO
from backend.app.operations import heartbeat
from backend.tests.test_experiment import runtime, post, issue, enter, start, decide, send
from backend.tests.test_model_runtime import configure, install_transport


def test_successful_logins_do_not_consume_failed_login_allowance(runtime):
    _, client, _ = runtime
    for _ in range(15):
        assert client.post('/api/v1/admin/login', json={'password': '123456'}).status_code == 200
    for _ in range(10):
        assert client.post('/api/v1/admin/login', json={'password': 'wrong'}).status_code == 401
    assert client.post('/api/v1/admin/login', json={'password': 'wrong'}).status_code == 429


def test_copied_participant_display_label_matches_uuid_and_code_search(runtime):
    _, client, admin = runtime
    issued, _ = issue(runtime, count=2)
    pid = issued['participants'][0]
    for query in (f'FCM · {pid[:8].upper()}', f'fcm·{pid[:8]}', f' FCM ・ {pid[:8]} ', pid[:8], issued['codes'][0]['code']):
        result = client.get('/api/v1/admin/participants', headers=admin, params={'q': query}).json()
        assert result['total'] == 1 and result['items'][0]['participantId'] == pid
    assert client.get('/api/v1/admin/participants', headers=admin, params={'q': 'FCM · %'}).json()['total'] == 0


def test_worker_health_distinguishes_database_liveness_presence_and_stalled_queue(runtime):
    app, client, admin = runtime
    health = client.get('/api/v1/health').json()
    assert health['status'] == 'ok' and not health['experimentReady']
    assert health['worker']['status'] == 'offline'
    heartbeat(app.state.database, 'worker-a', processed_at=now())
    assert client.get('/api/v1/health').json()['experimentReady']
    grant, headers, tasks, _ = enter(runtime)
    attempt = start(runtime, headers, tasks[0]['id'])['session']['id']
    decide(runtime, headers, attempt, 'pre')
    send(runtime, headers, attempt)
    worker = client.get('/api/v1/admin/worker', headers=admin).json()
    assert worker['queued'] == 1 and worker['status'] == 'online' and not worker['queueStalled']
    with app.state.database.transaction() as session:
        beat = session.scalar(select(Job).where(Job.kind == 'worker_heartbeat'))
        beat.lease_expires_at = now() - timedelta(seconds=1)
    health = client.get('/api/v1/health').json()
    assert not health['experimentReady'] and health['worker']['queueStalled']
    assert client.get('/api/v1/admin/overview', headers=admin).json()['worker']['status'] == 'offline'
    assert client.get('/api/v1/admin/settings', headers=admin).json()['runtime']['worker']['status'] == 'offline'
    heartbeat(app.state.database, 'worker-a', stopped=True)
    assert client.get('/api/v1/admin/worker', headers=admin).json()['activeWorkers'] == 0
    heartbeat(app.state.database, 'worker-b')
    assert client.get('/api/v1/admin/worker', headers=admin).json()['activeWorkers'] == 1
    assert client.get('/api/v1/admin/worker').status_code == 401


def test_batches_separate_frozen_arrangements_and_exports_preserve_exact_scope(runtime):
    app, client, admin = runtime
    def batch(request_id, maximum, name, groups):
        preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m', 'task-4p8r'], 'maxTurns': maximum}, admin)
        issued = post(client, '/admin/codes', {'requestId': request_id, 'configRef': preview['configRef'], 'batchId': name, 'groups': groups}, admin)
        return issued, preview
    a, config_a = batch('batch-a', 3, '同名试测', [{'condition': 'neutral', 'count': 2}, {'condition': 'goal', 'count': 1}])
    batch('batch-b', 8, '同名试测', [{'condition': 'goal', 'count': 2}])
    c, _ = batch('unnamed', 3, None, [{'condition': 'neutral', 'count': 1}])
    with app.state.database.transaction() as session:
        session.get(Assignment, a['participants'][0]).status = 'completed'
        for task in session.scalars(select(Task).where(Task.participant_id == a['participants'][0])):
            task.status = 'completed'
        session.get(Assignment, a['participants'][1]).expires_at = now() - timedelta(seconds=1)
    assert client.get('/api/v1/admin/batches').status_code == 401
    data = client.get('/api/v1/admin/batches', headers=admin).json()
    assert data['total'] == 3
    row = next(row for row in data['items'] if row['batchId'] == '同名试测' and row['configRef'] == config_a['configRef'])
    assert row['participantCount'] == 3 and row['statuses']['completed'] == 1 and row['statuses']['expired'] == 1
    assert row['taskTotal'] == 6 and row['tasksCompleted'] == 2
    assert row['taskNumbers'] == ['01', '09']
    assert row['copyPlan']['maxTurns'] == 3 and row['copyPlan']['groups'] == [{'condition': 'neutral', 'count': 2}, {'condition': 'goal', 'count': 1}]
    assert row['copyPlan']['modelId'] is None
    assert 'expiresAt' not in row['copyPlan'] and 'apiKey' not in str(data)
    assert client.get('/api/v1/admin/batches?pageSize=2&page=2', headers=admin).json()['total'] == 3
    assert client.get('/api/v1/admin/batches', headers=admin, params={'q': '同名'}).json()['total'] == 2
    assert client.get('/api/v1/admin/batches', headers=admin, params={'q': '%'}).json()['total'] == 0
    params = {'batch': '同名试测', 'configRef': config_a['configRef']}
    assert client.get('/api/v1/admin/participants', params=params, headers=admin).json()['total'] == 3
    response = client.get('/api/v1/admin/codes/export', params=params, headers=admin)
    rows = list(csv.DictReader(io.StringIO(response.content.decode('utf-8-sig'))))
    assert {r['participant_id'] for r in rows} == set(a['participants'])
    response = client.get('/api/v1/admin/codes/export', params={'unnamed': True, 'configRef': config_a['configRef']}, headers=admin)
    rows = list(csv.DictReader(io.StringIO(response.content.decode('utf-8-sig'))))
    assert [r['participant_id'] for r in rows] == c['participants']


def uncertain_probe(runtime):
    configure(runtime)
    install_transport(runtime, lambda _: httpx.Response(401, headers={'x-request-id': 'req_rejected'}, json={'error': 'private-key-must-not-escape'}))
    result = post(runtime[1], '/admin/models/probe', {'requestId': 'bad-credentials', 'modelId': MODEL_ID}, runtime[2])
    return result


def reconciliation(request_id='verified-usage', **changes):
    return {'requestId': request_id, 'inputTokens': 0, 'outputTokens': 0,
            'providerReference': 'provider-ticket-123', 'evidence': '供应商工单确认该请求认证失败，已经结束，输入与输出用量均为零。',
            'verifiedCompleted': True, **changes}


def test_verification_history_and_reconciliation_are_durable_audited_and_idempotent(runtime):
    app, client, admin = runtime
    result = uncertain_probe(runtime)
    job_id = result['jobId']
    history = client.get('/api/v1/admin/models/probes', headers=admin).json()
    assert history['total'] == 1 and history['items'][0]['httpStatus'] == 401
    assert history['items'][0]['failureKind'] == 'authentication'
    assert 'private-key-must-not-escape' not in str(history) and 'test-secret-never-return' not in str(history)
    route = f'/admin/models/probes/{job_id}/reconcile'
    post(client, route, reconciliation(), status=401)
    post(client, route, reconciliation(), admin, 409)
    for changes in ({'verifiedCompleted': False}, {'inputTokens': True}, {'outputTokens': -1}, {'inputTokens': 400001},
                    {'evidence': ' ' * 30}, {'providerReference': ' ' * 10}):
        post(client, route, reconciliation(**changes), admin, 422)
    with app.state.database.transaction() as session:
        session.get(Job, job_id).created_at = now() - timedelta(minutes=6)
    record = client.get('/api/v1/admin/models/probes', headers=admin).json()['items'][0]
    assert record['canReconcile']
    settled = post(client, route, reconciliation(), admin)
    assert settled['status'] == 'reconciled' and settled['costStatus'] == 'settled'
    assert settled['budget']['reservedUsd'] == 0 and settled['budget']['limitUsd'] == 1
    assert settled['budget']['requestCount'] == 1 and not settled['canReconcile']
    assert post(client, route, reconciliation(), admin) == settled
    post(client, route, reconciliation(outputTokens=1), admin, 409)
    post(client, route, reconciliation(request_id='second-reconciliation'), admin, 409)
    # Replaying the original probe never sends a new request or restores its old hold.
    install_transport(runtime, lambda _: (_ for _ in ()).throw(AssertionError('Must not call provider')))
    replay = post(client, '/admin/models/probe', {'requestId': 'bad-credentials', 'modelId': MODEL_ID}, admin)
    assert replay['reconciliation'] == settled['reconciliation'] and replay['budget']['requestCount'] == 1
    with app.state.database.transaction() as session:
        audits = list(session.scalars(select(AuditLog).where(AuditLog.action == 'reconcile_model_probe')))
        assert len(audits) == 1 and audits[0].change_summary['chargeNano'] == 0
        assert audits[0].change_summary['providerReference'] == 'provider-ticket-123'


def test_concurrent_reconciliation_cannot_release_the_same_hold_twice(runtime):
    app, client, admin = runtime
    record = uncertain_probe(runtime)
    with app.state.database.transaction() as session:
        session.get(Job, record['jobId']).created_at = now() - timedelta(minutes=6)
    route = f'/admin/models/probes/{record["jobId"]}/reconcile'
    def submit(index):
        return client.post('/api/v1' + route, headers=admin, json=reconciliation(request_id=f'concurrent-{index}')).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == [200, 409]
    history = client.get('/api/v1/admin/models/probes', headers=admin).json()
    assert history['budget']['requestCount'] == 1 and history['budget']['reservedUsd'] == 0
