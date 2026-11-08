"""Editable text persists and reaches new runtimes without changing frozen trials."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.api import create_app
from backend.app.advisor_config import descriptor, digest
from backend.app.db import AuditLog, Job
from backend.tests.test_admin import login
from backend.tests.test_advisor import install, validate, live_enter
from backend.tests.test_allocation import request as quota_request
from backend.tests.test_experiment import runtime, post, send
from backend.app.model_runtime import MODEL_ID


def read(runtime):
    return runtime[1].get('/api/v1/admin/advisor-prompts', headers=runtime[2]).json()


def update(value, request_id=None):
    return {'requestId': request_id or str(uuid4()), 'revision': value['revision'], 'config': deepcopy(value['config'])}


def test_prompt_defaults_follow_incoming_catalogue_and_executable_enum(runtime):
    app, client, admin = runtime
    assert client.get('/api/v1/admin/advisor-prompts').status_code == 401
    value = read(runtime)
    assert value['revision'] == 0 and value['updatedAt'] is None
    assert value['config'] == value['defaults']
    assert value['runtimeRef'] == digest(descriptor())
    cards = value['config']['strategies']
    assert [item['id'] for item in cards] == [f'S{index:02}' for index in range(11)] + ['S14']
    assert all(item['boundary'] and item['execution_prompt'] for item in cards)
    selection = next(tool for tool in value['toolSchemas'] if tool['name'] == 'select_strategy')
    assert selection['parameters']['properties']['strategy_id']['enum'] == [item['id'] for item in cards]
    assert value['runtime']['maxOutputTokens'] == 1536


def test_prompt_save_requires_csrf_persists_and_keeps_audited_revisions(runtime):
    app, client, admin = runtime
    original = read(runtime)
    _, csrf = login(runtime)
    request = update(original, 'save-text')
    request['config']['prompt']['instructions'] += '\nA researcher-edited instruction.'
    request['config']['strategies'][1]['execution_prompt'] += '\nUse the edited execution card.'
    request['config']['tools'][0]['description'] += ' Edited tool help.'
    post(client, '/admin/advisor-prompts', request, status=403)
    saved = post(client, '/admin/advisor-prompts', request, csrf)
    assert saved['revision'] == 1 and saved['runtimeRef'] != original['runtimeRef']
    assert saved['config'] == request['config'] and saved['defaults'] == original['defaults']
    assert post(client, '/admin/advisor-prompts', request, csrf) == saved
    post(client, '/admin/advisor-prompts', {**request, 'revision': 3}, csrf, 409)
    with app.state.database.transaction() as session:
        changes = list(session.scalars(select(AuditLog).where(AuditLog.action == 'save_advisor_text')))
        assert len(changes) == 1
        assert set(changes[0].change_summary['changedFields']) == {'prompt.instructions', 'strategy.S01', 'tool.read_material'}
        versions = list(session.scalars(select(Job).where(Job.kind == 'save_advisor_text')))
        assert len(versions) == 1 and versions[0].progress['config'] == saved['config']
    restarted = create_app(app.state.service.settings)
    with TestClient(restarted) as other:
        assert other.get('/api/v1/admin/advisor-prompts', headers=admin).json() == saved
    restarted.state.database.engine.dispose()
    restored = post(client, '/admin/advisor-prompts', {**update(saved), 'config': original['defaults']}, csrf)
    assert restored['revision'] == 2 and restored['runtimeRef'] == original['runtimeRef']


def test_invalid_text_cannot_change_tool_schema_ids_or_runtime_limits(runtime):
    _, client, admin = runtime
    original = read(runtime)
    invalid = []
    request = update(original); request['config']['prompt']['goal'] = 'Missing the required target'; invalid.append(request)
    request = update(original); request['config']['prompt']['instructions'] = '  \n '; invalid.append(request)
    request = update(original); request['config']['prompt']['max_output_tokens'] = 999999; invalid.append(request)
    request = update(original); request['config']['strategies'][0]['id'] = 'S11'; invalid.append(request)
    request = update(original); request['config']['strategies'][0]['id'] = 'S01'; invalid.append(request)
    request = update(original); request['config']['tools'][0]['parameters'] = {}; invalid.append(request)
    request = update(original); request['config']['tools'][0]['name'] = 'web_search'; invalid.append(request)
    request = update(original); request['config']['strategies'][0]['execution_prompt'] = 'x' * 8001; invalid.append(request)
    for body in invalid:
        post(client, '/admin/advisor-prompts', body, admin, 422)
    assert read(runtime) == original


def test_concurrent_prompt_editors_cannot_overwrite_another_saved_revision(runtime):
    _, client, admin = runtime
    original = read(runtime)
    def save(index):
        body = update(original)
        body['config']['prompt']['opening'] = f'Opening from editor {index}'
        return client.post('/api/v1/admin/advisor-prompts', json=body, headers=admin).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, [1, 2])) == [200, 409]
    assert read(runtime)['revision'] == 1


def test_new_text_reaches_validation_normal_and_quota_previews_while_old_batch_runs_unchanged(runtime):
    app, client, admin = runtime
    provider = install(runtime)
    assert validate(runtime)['status'] == 'succeeded'
    headers, attempt_id, snapshot = live_enter(runtime)
    old_config = app.state.service.store.get(snapshot['bundleRevision'])
    old_runtime_ref = old_config['advisor']['runtimeRef']
    old_runtime = json.dumps(app.state.service.store.get(old_runtime_ref), sort_keys=True)
    original = read(runtime)
    body = update(original)
    for key in body['config']['prompt']:
        body['config']['prompt'][key] += f'\nPANEL-{key}-EDIT'
    body['config']['strategies'][1]['boundary'] += ' PANEL-BOUNDARY-EDIT'
    body['config']['strategies'][1]['execution_prompt'] += ' PANEL-EXECUTION-EDIT'
    body['config']['tools'][0]['description'] += ' PANEL-TOOL-EDIT'
    saved = post(client, '/admin/advisor-prompts', body, admin)
    assert not client.get('/api/v1/admin/settings', headers=admin).json()['models'][0]['runtimeReady']
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': MODEL_ID}, admin)
    assert not preview['canIssue']
    frozen = app.state.service.store.get(preview['configRef'])
    assert frozen['advisor']['runtimeRef'] == saved['runtimeRef'] != old_runtime_ref
    quota = post(client, '/admin/allocation-plans', quota_request(modelId=MODEL_ID), admin)
    assert app.state.service.store.get(quota['configRef'])['advisor']['runtimeRef'] == saved['runtimeRef']
    assert json.dumps(app.state.service.store.get(old_runtime_ref), sort_keys=True) == old_runtime
    provider.requests.clear()
    send(runtime, headers, attempt_id)
    assert app.state.advisor.tick()
    assert provider.requests and all('PANEL-' not in json.dumps(request) for _, request in provider.requests)
    provider.requests.clear()
    assert validate(runtime, 'validate-edited-text')['status'] == 'succeeded'
    calls = [request for _, request in provider.requests if 'instructions' in request]
    assert calls and all('PANEL-instructions-EDIT' in request['instructions'] for request in calls)
    assert all('PANEL-BOUNDARY-EDIT' in request['instructions'] and 'PANEL-EXECUTION-EDIT' in request['instructions'] for request in calls)
    assert any('PANEL-prepare-EDIT' in request['instructions'] for request in calls)
    assert any('PANEL-reply-EDIT' in request['instructions'] for request in calls)
    assert any('PANEL-TOOL-EDIT' in json.dumps(request['tools']) for request in calls)
    assert client.get('/api/v1/admin/settings', headers=admin).json()['models'][0]['runtimeReady']
    _, _, new_snapshot = live_enter(runtime)
    assert 'PANEL-opening-EDIT' in new_snapshot['session']['initialMessage']['text']
