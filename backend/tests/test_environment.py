from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.api import create_app
from backend.app.db import Assignment, AuditLog, Job
from backend.app.environment import CURRENT, EnvironmentSettings
from backend.tests.test_experiment import runtime, post, issue
from backend.tests.test_admin import login


def update(revision=0, request_id='settings-1', **model):
    return {'requestId': request_id, 'revision': revision, 'environmentName': 'Pilot 测试环境', 'notes': '测试环境备注',
            'models': [{'id': 'model-a', 'label': '测试模型', 'baseUrl': 'https://model.example.test/v1/', 'modelName': 'test-model', **model}]}


def test_environment_settings_persist_without_exposing_credentials(runtime):
    app, client, admin = runtime
    assert client.get('/api/v1/admin/settings').status_code == 401
    initial = client.get('/api/v1/admin/settings', headers=admin).json()
    assert initial['revision'] == 0 and initial['models'] == []
    assert initial['runtime']['databaseStatus'] == 'ready'
    assert not initial['runtime']['modelConnectionActive']
    _, csrf = login(runtime)
    body = update(apiKey='TEST-API-KEY-private-value')
    post(client, '/admin/settings', body, status=403)
    saved = post(client, '/admin/settings', body, csrf)
    assert saved['revision'] == 1 and saved['environmentName'] == body['environmentName']
    assert saved['models'][0] == {'id': 'model-a', 'label': '测试模型', 'baseUrl': 'https://model.example.test/v1', 'modelName': 'test-model', 'hasApiKey': True, 'configured': True, 'runtimeReady': False, 'probeSupported': False}
    assert body['models'][0]['apiKey'] not in json.dumps(saved)
    assert 'apiKeyCiphertext' not in json.dumps(saved)
    with app.state.database.transaction() as session:
        row = session.scalar(select(Job).where(Job.idempotency_key == CURRENT))
        assert EnvironmentSettings(app.state.service.settings).cipher.decrypt(row.progress['models'][0]['apiKeyCiphertext'].encode()).decode() == body['models'][0]['apiKey']
        assert body['models'][0]['apiKey'] not in json.dumps([job.progress for job in session.scalars(select(Job))])
        assert body['models'][0]['apiKey'] not in json.dumps([audit.change_summary for audit in session.scalars(select(AuditLog))])
    restarted = create_app(app.state.service.settings)
    with TestClient(restarted) as other:
        assert other.get('/api/v1/admin/settings', headers=admin).json() == saved
    restarted.state.database.engine.dispose()


def test_environment_keys_preserve_replace_and_clear_with_safe_retries(runtime):
    app, client, admin = runtime
    body = update(apiKey='initial-test-key')
    saved = post(client, '/admin/settings', body, admin)
    assert post(client, '/admin/settings', body, admin) == saved
    post(client, '/admin/settings', {**body, 'notes': 'different'}, admin, 409)
    # Omitted or empty key keeps the stored credential.
    saved = post(client, '/admin/settings', update(1, 'settings-2', apiKey='   '), admin)
    assert saved['models'][0]['hasApiKey']
    saved = post(client, '/admin/settings', update(2, 'settings-3', apiKey='replacement-test-key'), admin)
    assert saved['models'][0]['hasApiKey']
    with app.state.database.transaction() as session:
        row = session.scalar(select(Job).where(Job.idempotency_key == CURRENT))
        assert EnvironmentSettings(app.state.service.settings).cipher.decrypt(row.progress['models'][0]['apiKeyCiphertext'].encode()).decode() == 'replacement-test-key'
    saved = post(client, '/admin/settings', update(3, 'settings-4', clearApiKey=True), admin)
    assert saved['revision'] == 4 and not saved['models'][0]['hasApiKey']
    post(client, '/admin/settings', update(0, 'stale'), admin, 409)
    def concurrent(index):
        return client.post('/api/v1/admin/settings', json=update(4, f'concurrent-{index}'), headers=admin).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(concurrent, [1, 2])) == [200, 409]


def test_environment_validation_and_database_credentials_are_private(runtime):
    app, client, admin = runtime
    for url in ['file:///tmp/model', 'https://user:password@model.example/v1', 'https://model.example/v1?api_key=secret',
                'https://model.example/v1#token', 'https://model.example:bad/v1', 'not-a-url']:
        post(client, '/admin/settings', update(baseUrl=url), admin, 422)
    post(client, '/admin/settings', update(apiKey='bad\nheader'), admin, 422)
    post(client, '/admin/settings', update(apiKey='new-key', clearApiKey=True), admin, 422)
    post(client, '/admin/settings', {**update(), 'environmentName': '  '}, admin, 422)
    post(client, '/admin/settings', {**update(), 'runtime': {'database_url': 'another-database'}}, admin, 422)
    assert client.get('/api/v1/admin/settings', headers=admin).json()['revision'] == 0
    settings = replace(app.state.service.settings, database_url='postgresql+psycopg://dbuser:DB_SECRET@db.example:5432/experiment?sslpassword=OTHER_SECRET')
    with app.state.database.transaction() as session:
        info = EnvironmentSettings(settings).read(session)
    assert info['runtime']['databaseLocation'] == 'db.example:5432/experiment'
    assert all(value not in json.dumps(info) for value in ['dbuser', 'DB_SECRET', 'OTHER_SECRET'])


def test_admin_tasks_use_two_digit_case_numbers(runtime):
    app, client, admin = runtime
    catalog = client.get('/api/v1/admin/catalog', headers=admin).json()
    assert [t['number'] for t in catalog['tasks'] if t['enabled']] == [f'{n:02}' for n in range(1, 21)]
    issued, request = issue(runtime, tasks=['task-7k3m', 'task-4p8r'])
    detail = client.get(f'/api/v1/admin/participants/{issued["participants"][0]}', headers=admin).json()
    assert {task['number'] for task in detail['tasks']} == {'01', '09'}


def test_optional_batch_model_selection_freezes_credentials_and_never_falls_back(runtime):
    app, client, admin = runtime
    # No registered model is required for the working deterministic flow.
    deterministic = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m']}, admin)
    assert deterministic['canIssue'] and deterministic['model'] is None
    baseline, _ = issue(runtime)
    body = update(apiKey='first-private-key')
    body['models'].append({'id': 'model-b', 'label': '模型 B', 'baseUrl': 'http://127.0.0.1:12345/v1', 'modelName': 'other-model'})
    post(client, '/admin/settings', body, admin)
    catalog = client.get('/api/v1/admin/catalog', headers=admin).json()
    assert [model['id'] for model in catalog['models']] == ['model-a', 'model-b']
    assert all(model['configured'] and not model['runtimeReady'] for model in catalog['models'])
    selected = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m', 'task-4p8r'], 'modelId': 'model-a'}, admin)
    assert selected['runtimeMode'] == 'agent' and not selected['canIssue']
    assert selected['model']['id'] == 'model-a' and 'first-private-key' not in json.dumps(selected)
    frozen = app.state.service.store.get(selected['model']['configRef'])
    original = json.dumps(frozen, sort_keys=True)
    assert EnvironmentSettings(app.state.service.settings).cipher.decrypt(frozen['connection']['apiKeyCiphertext'].encode()).decode() == 'first-private-key'
    experiment = app.state.service.store.get(selected['configRef'])
    assert experiment['model_selection']['configRef'] == selected['model']['configRef']
    assert experiment['model_ref'] == f'configured:{selected["model"]["configRef"]}'
    post(client, '/admin/codes', {'requestId': 'cannot-issue-live-yet', 'configRef': selected['configRef'],
                               'groups': [{'condition': 'goal', 'count': 10}]}, admin, 409)
    assert client.get('/api/v1/admin/participants', headers=admin).json()['total'] == 1
    # Updating or removing the registry entry does not replace the old immutable snapshot.
    body = update(1, 'change-model', modelName='new-model', apiKey='replacement-key')
    post(client, '/admin/settings', body, admin)
    newer = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': 'model-a'}, admin)
    assert newer['model']['configRef'] != selected['model']['configRef']
    assert json.dumps(app.state.service.store.get(selected['model']['configRef']), sort_keys=True) == original
    post(client, '/admin/settings', {**update(2, 'remove-model'), 'models': []}, admin)
    post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': 'model-a'}, admin, 422)
    with app.state.database.transaction() as session:
        assignment = session.get(Assignment, baseline['participants'][0])
        assert app.state.service.config(assignment)['model_ref'] == 'deterministic-integration-v1'


def test_model_registry_validation_and_single_model_migration(runtime):
    app, client, admin = runtime
    body = update()
    post(client, '/admin/settings', {**body, 'models': body['models'] * 2}, admin, 422)
    incomplete = update(modelName='')
    post(client, '/admin/settings', incomplete, admin)
    post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': 'model-a'}, admin, 422)
    cipher = EnvironmentSettings(app.state.service.settings).cipher.encrypt(b'legacy-private-key').decode()
    with app.state.database.transaction() as session:
        row = session.scalar(select(Job).where(Job.idempotency_key == CURRENT))
        row.progress = {'revision': 7, 'environmentName': '旧环境', 'notes': '', 'updatedAt': None,
                        'model': {'baseUrl': 'https://legacy.example/v1', 'modelName': 'legacy-model', 'apiKeyCiphertext': cipher}}
    migrated = client.get('/api/v1/admin/settings', headers=admin).json()
    assert migrated['models'][0]['id'] == 'legacy-model' and migrated['models'][0]['hasApiKey']
    assert 'model' not in migrated and 'legacy-private-key' not in json.dumps(migrated)
