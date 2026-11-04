from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from backend.app.api import create_app
from backend.app.cli import migrate
from backend.app.db import Assignment, Base, Job, Participant, Task, now
from backend.app.settings import Settings
from backend.app.worker import tick


@pytest.fixture
def runtime(tmp_path):
    settings = Settings(f'sqlite:///{tmp_path / "test.sqlite3"}', tmp_path / 'artifacts', 's' * 48, '123456')
    migrate(settings.database_url)
    app = create_app(settings)
    with TestClient(app) as client:
        yield app, client, {'Authorization': f'Bearer {settings.admin_token}'}
    app.state.database.engine.dispose()


def post(client, path, data, headers=None, status=200):
    response = client.post(f'/api/v1{path}', json=data, headers=headers)
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def issue(runtime, tasks=None, maximum=20, count=1, groups=None):
    app, client, admin = runtime
    preview = post(client, '/admin/code-preview', {'taskCodes': tasks or ['task-7k3m'], 'maxTurns': maximum}, admin)
    request = {'requestId': str(uuid4()), 'configRef': preview['configRef'], 'groups': groups or [{'condition': 'neutral', 'count': count}]}
    result = post(client, '/admin/codes', request, admin)
    return result, request


def enter(runtime, code=None, tasks=None, maximum=20):
    app, client, admin = runtime
    if code is None:
        code = issue(runtime, tasks=tasks, maximum=maximum)[0]['codes'][0]['code']
    grant = post(client, '/access/exchange', {'requestId': str(uuid4()), 'code': code})
    headers = {'Authorization': f'Bearer {grant["accessToken"]}'}
    profile = client.get('/api/v1/profile', headers=headers).json()
    answers = {q['id']: q['options'][0]['value'] for q in profile['questions']}
    post(client, '/profile', {'requestId': 'profile', 'answers': answers}, headers, 204)
    tasks = client.get('/api/v1/tasks', headers=headers).json()
    return grant, headers, tasks, code


def start(runtime, headers, task_id, request_id=None):
    return post(runtime[1], f'/tasks/{task_id}/start', {'requestId': request_id or str(uuid4())}, headers)


def decide(runtime, headers, attempt_id, stage, choice='A', confidence=0, request_id=None):
    return post(runtime[1], f'/attempts/{attempt_id}/measurements/{stage}', {
        'requestId': request_id or str(uuid4()), 'stage': stage, 'decision': {'choice': choice, 'confidence': confidence}, 'timestamp': now().isoformat()}, headers)


def send(runtime, headers, attempt_id, message_id=None):
    message = {'id': message_id or str(uuid4()), 'role': 'user', 'text': 'Please explain the materials.', 'timestamp': now().isoformat()}
    accepted = post(runtime[1], f'/attempts/{attempt_id}/turns', message, headers, 202)
    return accepted, message


def drain(runtime):
    for _ in range(100):
        if not tick(runtime[0].state.database, runtime[0].state.service):
            return
    raise AssertionError('Worker did not settle')


def test_migration_and_complete_multitask_test(runtime):
    app, client, admin = runtime
    tables = set(inspect(app.state.database.engine).get_table_names())
    assert tables == {'participants','participant_tasks','tasks','admin_audit_logs','system_jobs','alembic_version'}
    with app.state.database.engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    grant, headers, tasks, code = enter(runtime, tasks=['task-7k3m','task-4p8r'], maximum=3)
    receipts = []
    for index, task in enumerate(tasks):
        started = start(runtime, headers, task['id'])
        attempt = started['session']['id']
        assert started['session']['runtimeMode'] == 'deterministic'
        decide(runtime, headers, attempt, 'pre', confidence=0)
        post(client, f'/attempts/{attempt}/end-dialogue', {'requestId': 'early'}, headers, 409)
        for turn_no in range(3):
            accepted, message = send(runtime, headers, attempt)
            assert accepted['status'] == 'queued'
            drain(runtime)
            snapshot = client.get(f'/api/v1/attempts/{attempt}/turns/{message["id"]}', headers=headers).json()
            assert snapshot['policy']['completedTurns'] == turn_no + 1
        assert snapshot['stage'] == 'post'
        assert snapshot['policy']['canSend'] is False
        decide(runtime, headers, attempt, 'post', choice='B', confidence=100)
        complete = post(client, f'/attempts/{attempt}/complete', {'requestId': 'done'}, headers)
        assert post(client, f'/attempts/{attempt}/complete', {'requestId': 'replayed'}, headers) == complete
        receipts.append(complete['receipt'])
        with app.state.database.transaction() as session:
            assignment = session.get(Assignment, grant['participantId'])
            assert assignment.status == ('completed' if index == len(tasks)-1 else 'in_progress')
    assert len(set(receipts)) == 2
    assert post(client, '/access/exchange', {'requestId': 'reenter', 'code': code})['participantId'] == grant['participantId']


def test_profile_gate_and_immutable_answers(runtime):
    app, client, admin = runtime
    result, request = issue(runtime)
    code = result['codes'][0]['code']
    grant = post(client, '/access/exchange', {'requestId': 'enter', 'code': code})
    headers = {'Authorization': f'Bearer {grant["accessToken"]}'}
    task = client.get('/api/v1/tasks', headers=headers).json()[0]
    post(client, f'/tasks/{task["id"]}/start', {'requestId': 'start'}, headers, 409)
    profile = client.get('/api/v1/profile', headers=headers).json()
    answers = {q['id']: q['options'][0]['value'] for q in profile['questions']}
    post(client, '/profile', {'requestId': 'profile', 'answers': answers}, headers, 204)
    post(client, '/profile', {'requestId': 'new-key', 'answers': answers}, headers, 204)
    altered = {**answers, profile['questions'][0]['id']: profile['questions'][0]['options'][1]['value']}
    post(client, '/profile', {'requestId': 'another', 'answers': altered}, headers, 409)
    post(client, '/profile', {'requestId': 'profile', 'answers': altered}, headers, 409)
    started = start(runtime, headers, task['id'])
    attempt = started['session']['id']
    decide(runtime, headers, attempt, 'pre')
    body = {'requestId': 'alter', 'stage': 'pre', 'decision': {'choice': 'B', 'confidence': 1}, 'timestamp': now().isoformat()}
    post(client, f'/attempts/{attempt}/measurements/pre', body, headers, 409)
    body['decision']['confidence'] = True
    post(client, f'/attempts/{attempt}/measurements/pre', body, headers, 422)
    post(client, f'/attempts/{attempt}/complete', {'requestId': 'skip'}, headers, 409)


def test_turn_idempotency_and_public_snapshots(runtime):
    app, client, admin = runtime
    _, headers, tasks, _ = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    attempt = started['session']['id']
    decide(runtime, headers, attempt, 'pre')
    accepted, message = send(runtime, headers, attempt)
    assert post(client, f'/attempts/{attempt}/turns', message, headers, 202)['turnId'] == message['id']
    post(client, f'/attempts/{attempt}/turns', {**message, 'text': 'Changed'}, headers, 409)
    post(client, f'/attempts/{attempt}/turns', {**message, 'role': 'assistant'}, headers, 422)
    post(client, f'/attempts/{attempt}/turns', {**message, 'id': 'new'}, headers, 409)
    for _ in range(3):
        tick(app.state.database, app.state.service)
    final = post(client, f'/attempts/{attempt}/turns', message, headers, 202)
    assert final['status'] == 'completed' and final['policy']['completedTurns'] == 1
    snapshot = client.get(f'/api/v1/attempts/{attempt}', headers=headers).json()
    text = json.dumps(snapshot)
    for private in ['target_option_id','selected_strategy','runtime_state','test_code_hash','received_at']:
        assert private not in text
    assert len(snapshot['progress']['messages']) == 3
    with app.state.database.transaction() as session:
        assert session.scalar(select(func.count()).select_from(Job).where(Job.kind == 'deterministic_turn')) == 1
    stream = client.get(f'/api/v1/attempts/{attempt}/turns/{message["id"]}/events', headers=headers)
    assert stream.status_code == 200 and 'turn.snapshot' in stream.text


def test_abandon_retains_history_and_rejects_late_writes(runtime):
    app, client, admin = runtime
    grant, headers, tasks, _ = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    attempt = started['session']['id']
    decide(runtime, headers, attempt, 'pre')
    send(runtime, headers, attempt)
    tick(app.state.database, app.state.service)
    post(client, f'/attempts/{attempt}/abandon', {'requestId': 'leave'}, headers, 204)
    fresh = start(runtime, headers, tasks[0]['id'])
    assert fresh['session']['id'] != attempt
    drain(runtime)
    with app.state.database.transaction() as session:
        task = session.get(Task, tasks[0]['id'])
        assert len(task.task_data['attempts']) == 2
        assert task.task_data['attempts'][0]['status'] == 'abandoned'
        assert task.task_data['attempts'][0]['turns'][0]['status'] == 'cancelled'
        assert task.task_data['attempts'][1]['turns'] == []
        assert task.runtime_state['current_attempt_id'] == fresh['session']['id']
    post(client, f'/attempts/{attempt}/turns', {'id': 'late','role':'user','text':'late','timestamp':'client'}, headers, 409)


def test_rotation_revokes_credentials_and_documents_without_resetting_data(runtime):
    app, client, admin = runtime
    grant, headers, tasks, old_code = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    document = started['scenario']['references'][0]['url']
    assert client.get(document).status_code == 200
    ticket = document.split('ticket=')[1]
    assert client.get('/api/v1/tasks', headers={'Authorization': f'Bearer {ticket}'}).status_code == 401
    rotated = post(client, f'/admin/participants/{grant["participantId"]}/rotate', {'requestId':'rotate'}, admin)
    assert client.get('/api/v1/tasks', headers=headers).status_code == 401
    assert client.get(document).status_code == 401
    post(client, '/access/exchange', {'requestId':'old','code':old_code}, status=401)
    new_grant, new_headers, new_tasks, _ = enter(runtime, code=rotated['code'])
    assert new_grant['participantId'] == grant['participantId']
    restored = client.get(f'/api/v1/attempts/{started["session"]["id"]}', headers=new_headers).json()
    assert restored['session']['id'] == started['session']['id']
    assert new_tasks[0]['id'] == tasks[0]['id']


def test_cross_participant_ownership_and_expiry(runtime):
    app, client, admin = runtime
    grant, headers, tasks, _ = enter(runtime)
    other, other_headers, _, _ = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    assert client.get(f'/api/v1/attempts/{started["session"]["id"]}', headers=other_headers).status_code == 404
    post(client, f'/tasks/{tasks[0]["id"]}/start', {'requestId':'foreign'}, other_headers, 404)
    with app.state.database.transaction() as session:
        session.get(Assignment, grant['participantId']).expires_at = now() - timedelta(seconds=1)
    assert client.get('/api/v1/tasks', headers=headers).status_code == 401


def test_concurrent_start_locks_one_task(runtime):
    app, client, admin = runtime
    grant, headers, tasks, _ = enter(runtime, tasks=['task-7k3m','task-4p8r'])
    def attempt_start(task):
        return client.post(f'/api/v1/tasks/{task["id"]}/start', json={'requestId':str(uuid4())}, headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt_start, tasks))
    assert sorted(results) == [200,409]
    with app.state.database.transaction() as session:
        assert session.scalar(select(func.count()).select_from(Task).where(Task.status == 'in_progress')) == 1


def test_code_generation_uses_selected_groups_and_is_idempotent(runtime):
    app, client, admin = runtime
    issued, request = issue(runtime, groups=[{'condition':'neutral','count':3}, {'condition':'goal','count':2}])
    replayed = post(client, '/admin/codes', request, admin)
    assert replayed['codes'] == issued['codes'] and replayed['participants'] == issued['participants']
    post(client, '/admin/codes', {**request,'groups':[{'condition':'neutral','count':6}]}, admin, 409)
    with app.state.database.transaction() as session:
        distribution = dict(session.execute(select(Assignment.condition,func.count()).group_by(Assignment.condition)).all())
        assert distribution == {'neutral': 3, 'goal': 2}
        assert session.scalar(select(func.count()).select_from(Participant)) == 5
        serialized = json.dumps([j.progress for j in session.scalars(select(Job))])
        assert all(item['code'] not in serialized for item in issued['codes'])


def test_frozen_content_and_restart_resume(runtime):
    app, client, admin = runtime
    _, headers, tasks, _ = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    attempt = started['session']['id']
    decide(runtime, headers, attempt, 'pre')
    accepted, message = send(runtime, headers, attempt)
    tick(app.state.database, app.state.service)
    tick(app.state.database, app.state.service)
    partial = client.get(f'/api/v1/attempts/{attempt}', headers=headers).json()
    assert partial['progress']['activeTurn']['status'] == 'running'
    assert partial['progress']['messages'][-1]['status'] == 'partial'
    config = deepcopy(app.state.service.config(next_assignment(app, tasks[0]['id'])))
    config['bundle']['scenarios'][0]['title'] = 'New release title'
    app.state.service.store.freeze(config)
    restarted = create_app(app.state.service.settings)
    tick(restarted.state.database, restarted.state.service)
    restored = client.get(f'/api/v1/attempts/{attempt}', headers=headers).json()
    assert restored['progress']['activeTurn'] is None
    assert restored['progress']['messages'][-1]['status'] == 'complete'
    assert restored['scenario']['title'] == started['scenario']['title']
    restarted.state.database.engine.dispose()


def test_default_twenty_turn_boundary_and_early_end_permission(runtime):
    _, client, _ = runtime
    _, headers, tasks, _ = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    attempt = started['session']['id']
    decide(runtime, headers, attempt, 'pre')
    for count in range(1,21):
        _, message = send(runtime, headers, attempt)
        drain(runtime)
        result = client.get(f'/api/v1/attempts/{attempt}/turns/{message["id"]}', headers=headers).json()
        assert result['policy']['completedTurns'] == count
        assert result['policy']['canEnd'] == (3 <= count < 20)
        assert result['stage'] == ('post' if count == 20 else 'dialogue')
    post(client, f'/attempts/{attempt}/turns', {'id':'too-many','role':'user','text':'new','timestamp':'client'}, headers,409)


def test_cancel_stops_active_job_and_keeps_raw_history(runtime):
    app, client, admin = runtime
    grant, headers, tasks, code = enter(runtime)
    started = start(runtime, headers, tasks[0]['id'])
    attempt = started['session']['id']
    decide(runtime, headers, attempt, 'pre')
    send(runtime, headers, attempt)
    post(client, f'/admin/participants/{grant["participantId"]}/cancel', {'requestId':'cancel'}, admin)
    assert client.get('/api/v1/tasks',headers=headers).status_code == 401
    drain(runtime)
    with app.state.database.transaction() as session:
        task=session.get(Task,tasks[0]['id'])
        assert task.status == 'cancelled'
        assert task.task_data['attempts'][0]['status'] == 'abandoned'
        assert task.task_data['attempts'][0]['turns'][0]['status'] == 'cancelled'


def next_assignment(app, task_id):
    with app.state.database.transaction() as session:
        return session.get(Assignment, session.get(Task, task_id).participant_id)
