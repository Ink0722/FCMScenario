from copy import deepcopy
from datetime import timedelta
import csv
import io
import json

from sqlalchemy import select

from backend.app.admin import COOKIE
from backend.app.db import Assignment, Job, Task, now
from backend.app.api import create_app
from backend.app.settings import Settings
from backend.tests.test_experiment import runtime, post, issue, enter, start, decide, send, drain


def login(runtime):
    _, client, _ = runtime
    response = client.post('/api/v1/admin/login', json={'password': '123456'}, headers={'Origin': 'http://testserver'})
    assert response.status_code == 200, response.text
    return response, {'X-CSRF-Token': response.json()['csrfToken'], 'Origin': 'http://testserver'}


def test_cookie_auth_csrf_and_server_side_logout(runtime):
    app, client, bearer = runtime
    assert client.get('/api/v1/admin/participants').status_code == 401
    assert client.get('/api/v1/admin/catalog', headers={'Authorization': 'Bearer participant'}).status_code == 403
    assert client.post('/api/v1/admin/login', json={'password': 'wrong'}).status_code == 401
    assert client.post('/api/v1/admin/login', json={'password': '123456'}, headers={'Origin': 'https://other.example'}).status_code == 403
    response, headers = login(runtime)
    cookie = client.cookies.get(COOKIE)
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=strict' in response.headers['set-cookie']
    assert '123456' not in cookie
    assert client.get('/api/v1/admin/session').json()['csrfToken'] == headers['X-CSRF-Token']
    preview = {'taskCodes': ['task-7k3m']}
    post(client, '/admin/code-preview', preview, status=403)
    post(client, '/admin/code-preview', preview, {**headers, 'Origin': 'http://other.example'}, 403)
    post(client, '/admin/code-preview', preview, headers)
    post(client, '/admin/logout', {}, headers, 204)
    assert client.get('/api/v1/admin/session').status_code == 401
    client.cookies.set(COOKIE, cookie, path='/api/v1/admin')
    assert client.get('/api/v1/admin/participants').status_code == 401
    # CLI bearer remains supported independently of browser sessions.
    assert client.get('/api/v1/admin/catalog', headers=bearer).status_code == 200


def test_session_replacement_expiry_and_login_throttle(runtime):
    app, client, bearer = runtime
    login(runtime)
    old_cookie = client.cookies.get(COOKIE)
    login(runtime)
    current_cookie = client.cookies.get(COOKIE)
    assert old_cookie != current_cookie
    with app.state.database.transaction() as session:
        jobs = list(session.scalars(select(Job).where(Job.kind == 'admin_session').order_by(Job.created_at)))
        assert [j.status for j in jobs] == ['cancelled', 'running']
        jobs[-1].lease_expires_at = now() - timedelta(seconds=1)
    assert client.get('/api/v1/admin/session').status_code == 401
    for _ in range(10):
        assert client.post('/api/v1/admin/login', json={'password': 'wrong'}).status_code == 401
    assert client.post('/api/v1/admin/login', json={'password': 'wrong'}).status_code == 429


def test_real_pagination_filters_and_no_credentials_in_reads(runtime):
    app, client, admin = runtime
    result, request = issue(runtime, count=23)
    expired, cancelled = result['participants'][:2]
    with app.state.database.transaction() as session:
        session.get(Assignment, expired).expires_at = now() - timedelta(seconds=1)
        session.get(Assignment, cancelled).status = 'cancelled'
        session.get(Assignment, cancelled).expires_at = now() - timedelta(seconds=1)
        session.get(Assignment, result['participants'][2]).batch_id = 'pilot-1'
    login(runtime)
    first = client.get('/api/v1/admin/participants').json()
    assert all(row['assignedAt'].endswith('Z') for row in first['items'])
    second = client.get('/api/v1/admin/participants?page=2').json()
    assert first['total'] == 23 and len(first['items']) == 20 and len(second['items']) == 3
    assert set(r['participantId'] for r in first['items']).isdisjoint(r['participantId'] for r in second['items'])
    assert client.get('/api/v1/admin/participants?status=expired').json()['items'][0]['participantId'] == expired
    assert client.get('/api/v1/admin/participants?batch=pilot-1').json()['total'] == 1
    assert client.get(f'/api/v1/admin/participants?q={expired[:8].upper()}').json()['total'] == 1
    assert client.get('/api/v1/admin/participants?q=%25').json()['total'] == 0
    assert client.get('/api/v1/admin/participants?pageSize=101').status_code == 422
    overview = client.get('/api/v1/admin/overview').json()
    assert overview['participants'] == {'pending': 21, 'in_progress': 0, 'completed': 0, 'cancelled': 1, 'expired': 1}
    assert overview['jobs'] == {}  # Researcher sessions are not generation jobs.
    text = json.dumps([first, second, overview])
    assert all(row['code'] in text for row in result['codes'])
    assert 'test_code_hash' not in text and 'csrfToken' not in text
    catalog = client.get('/api/v1/admin/catalog').json()
    assert len([t for t in catalog['tasks'] if t['enabled']]) == 20
    assert not next(t for t in catalog['tasks'] if t['taskCode'] == 'task-2x9q')['enabled']


def test_replay_preserves_all_attempts_and_zero_confidence(runtime):
    app, client, admin = runtime
    grant, headers, tasks, code = enter(runtime)
    task_id = tasks[0]['id']
    attempt_id = start(runtime, headers, task_id)['session']['id']
    decide(runtime, headers, attempt_id, 'pre', confidence=0)
    send(runtime, headers, attempt_id)
    drain(runtime)
    post(client, f'/attempts/{attempt_id}/abandon', {'requestId': 'abandon'}, headers, 204)
    second_id = start(runtime, headers, task_id)['session']['id']
    with app.state.database.transaction() as session:
        original = deepcopy(session.get(Task, task_id).task_data)
    login(runtime)
    detail = client.get(f'/api/v1/admin/participants/{grant["participantId"]}').json()
    assert detail['profile']['submission_status'] == 'submitted'
    assert detail['tasks'][0]['attemptCount'] == 2
    assert detail['tasks'][0]['targetOptionId'] in ('A', 'B')
    assert 'commands' not in detail['profile']
    replay = client.get(f'/api/v1/admin/tasks/{task_id}').json()
    assert [a['attempt_id'] for a in replay['attempts']] == [attempt_id, second_id]
    first = replay['attempts'][0]
    assert first['status'] == 'abandoned'
    assert first['measurements']['pre']['answers']['confidence'] == 0
    assert first['turns'][0]['status'] == 'completed'
    assert first['turns'][0]['model_calls'] == []
    assert 'commands' not in first
    assert code not in json.dumps(replay) and 'test_code_hash' not in json.dumps(detail)
    assert client.get('/api/v1/admin/tasks/missing').status_code == 404
    with app.state.database.transaction() as session:
        assert session.get(Task, task_id).task_data == original


def test_cookie_issue_rotate_cancel_are_idempotent_and_revoke_access(runtime):
    app, client, admin = runtime
    _, csrf = login(runtime)
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m']}, csrf)
    body = {'requestId': 'browser-issue', 'configRef': preview['configRef'], 'groups': [{'condition': 'goal', 'count': 1}]}
    issued = post(client, '/admin/codes', body, csrf)
    assert len(issued['codes']) == 1
    assert post(client, '/admin/codes', body, csrf)['codes'] == issued['codes']
    grant, headers, tasks, code = enter(runtime, code=issued['codes'][0]['code'])
    attempt_id = start(runtime, headers, tasks[0]['id'])['session']['id']
    rotate_path = f'/admin/participants/{grant["participantId"]}/rotate'
    rotated = post(client, rotate_path, {'requestId': 'browser-rotate'}, csrf)
    assert rotated['code'] != code
    assert post(client, rotate_path, {'requestId': 'browser-rotate'}, csrf)['replayed']
    assert client.get('/api/v1/tasks', headers=headers).status_code == 401
    replacement = post(client, '/access/exchange', {'requestId': 'new-code', 'code': rotated['code']})
    assert replacement['participantId'] == grant['participantId']
    post(client, f'/admin/participants/{grant["participantId"]}/cancel', {'requestId': 'cancel'}, csrf)
    replay = client.get(f'/api/v1/admin/tasks/{tasks[0]["id"]}').json()
    assert replay['status'] == 'cancelled'
    assert replay['attempts'][0]['attempt_id'] == attempt_id
    assert replay['attempts'][0]['status'] == 'abandoned'
    assert replay['attempts'][0]['stop_reason'] == 'cancelled'
    post(client, rotate_path, {'requestId': 'rotate-cancelled'}, csrf, 409)


def test_codes_persist_encrypted_and_are_recoverable_after_restart(runtime):
    app, client, admin = runtime
    result, request = issue(runtime, count=2)
    with app.state.database.transaction() as session:
        for item in result['codes']:
            assignment = session.get(Assignment, item['participantId'])
            assert item['code'] not in assignment.test_code_ciphertext
            assert app.state.service.stored_code(assignment) == item['code']
    from fastapi.testclient import TestClient
    restarted = create_app(app.state.service.settings)
    with TestClient(restarted) as other:
        replayed = post(other, '/admin/codes', request, admin)
        assert replayed['codes'] == result['codes']
        for item in result['codes']:
            detail = other.get(f'/api/v1/admin/participants/{item["participantId"]}', headers=admin).json()
            assert detail['testCode'] == item['code']
            assert 'test_code_ciphertext' not in detail and 'test_code_hash' not in detail
    restarted.state.database.engine.dispose()


def test_groups_are_explicit_and_validated_before_writing(runtime):
    app, client, admin = runtime
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m']}, admin)
    base = {'requestId': 'validate-groups', 'configRef': preview['configRef']}
    for groups in (None, [], [{'condition': 'random', 'count': 1}], [{'condition': 'goal', 'count': 0}],
                   [{'condition': 'goal', 'count': True}], [{'condition': 'goal', 'count': 1001}],
                   [{'condition': 'neutral', 'count': 600}, {'condition': 'goal', 'count': 600}],
                   [{'condition': 'goal', 'count': 1}, {'condition': 'goal', 'count': 2}]):
        post(client, '/admin/codes', {**base, **({'groups': groups} if groups is not None else {})}, admin, 422)
    assert client.get('/api/v1/admin/participants', headers=admin).json()['total'] == 0
    issued = post(client, '/admin/codes', {**base, 'groups': [{'condition': 'goal', 'count': 7}]}, admin)
    assert {row['condition'] for row in issued['codes']} == {'goal'}
    assert {row['condition'] for row in client.get('/api/v1/admin/participants', headers=admin).json()['items']} == {'goal'}


def test_export_matches_filters_across_pages_and_uses_beijing_time(runtime):
    app, client, admin = runtime
    result, body = issue(runtime, count=23)
    with app.state.database.transaction() as session:
        for pid in result['participants']:
            a = session.get(Assignment, pid)
            a.batch_id = '=unsafe-batch'
            a.assigned_at = now().replace(hour=18, minute=30, second=0, microsecond=0)
        session.get(Assignment, result['participants'][0]).condition = 'goal'
    assert client.get('/api/v1/admin/codes/export').status_code == 401
    login(runtime)
    response = client.get('/api/v1/admin/codes/export?condition=neutral&batch=%3Dunsafe-batch')
    assert response.status_code == 200 and 'attachment' in response.headers['content-disposition']
    rows = list(csv.DictReader(io.StringIO(response.content.decode('utf-8-sig'))))
    assert len(rows) == 22
    assert {row['condition'] for row in rows} == {'neutral'}
    assert all(row['batch_id'] == "'=unsafe-batch" for row in rows)
    assert all(row['assigned_at_beijing'].endswith('T02:30:00+08:00') for row in rows)
    assert {row['test_code'] for row in rows} == {r['code'] for r in result['codes'][1:]}
    assert client.get(f'/api/v1/admin/participants?q={result["codes"][0]["code"]}').json()['total'] == 1


def test_six_digit_management_password_is_supported(monkeypatch, tmp_path):
    monkeypatch.setenv('FCM_ADMIN_TOKEN', '123456')
    monkeypatch.setenv('FCM_SECRET_KEY', 's' * 48)
    monkeypatch.setenv('FCM_DATABASE_URL', f'sqlite:///{tmp_path / "db.sqlite3"}')
    assert Settings.from_env().admin_token == '123456'


def test_full_1000_code_batch_retains_exact_group_counts(runtime):
    app, client, admin = runtime
    result, request = issue(runtime, groups=[{'condition': 'neutral', 'count': 400}, {'condition': 'goal', 'count': 600}])
    assert len(result['codes']) == len({row['code'] for row in result['codes']}) == 1000
    rows = client.get('/api/v1/admin/participants?condition=neutral', headers=admin).json()
    assert rows['total'] == 400
    assert client.get('/api/v1/admin/participants?condition=goal', headers=admin).json()['total'] == 600
    assert post(client, '/admin/codes', request, admin)['codes'] == result['codes']
