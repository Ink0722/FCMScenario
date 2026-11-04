from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.api import create_app
from backend.app.db import AuditLog, Job, Participant
from backend.app.environment import EnvironmentSettings
from backend.app.model_runtime import CAP_NANO, DEFAULT_MODEL, KIND, MODEL_ID, MODEL_NAME, RESERVE_NANO, budget
from backend.app.service import Problem
from backend.tests.test_experiment import runtime, post


def configure(runtime, api_key='test-secret-never-return', **changes):
    app, client, admin = runtime
    saved = client.get('/api/v1/admin/settings', headers=admin).json()
    return post(client, '/admin/settings', {
        'requestId': f'configure-{saved["revision"]}', 'revision': saved['revision'],
        'environmentName': '联调测试', 'notes': '',
        'models': [{**DEFAULT_MODEL, 'apiKey': api_key, **changes}],
    }, admin)


def install_transport(runtime, handler):
    runtime[0].state.model_probe.client = lambda: httpx.Client(transport=httpx.MockTransport(handler))


def successful_response():
    return httpx.Response(200, headers={'x-request-id': 'provider-request-1'}, json={
        'id': 'resp_test', 'model': MODEL_NAME, 'status': 'completed',
        'usage': {'input_tokens': 17, 'output_tokens': 3},
        'output': [{'type': 'reasoning'}, {'type': 'message', 'content': [{'type': 'output_text', 'text': 'Connection OK'}]}]})


def test_probe_requires_admin_key_and_allowlisted_connection_before_spending(runtime):
    app, client, admin = runtime
    install_transport(runtime, lambda _: pytest.fail('No request should be sent'))
    command = {'requestId': 'first-probe', 'modelId': MODEL_ID}
    post(client, '/admin/models/probe', command, status=401)
    saved = configure(runtime, api_key=None)
    assert saved['modelBudget']['limitUsd'] == 1 and saved['modelBudget']['requestCount'] == 0
    assert saved['models'][0]['probeSupported'] and not saved['models'][0]['runtimeReady']
    missing = post(client, '/admin/models/probe', command, admin, 422)
    assert missing['code'] == 'model_key_required'
    configure(runtime, baseUrl='https://untrusted.example/v1')
    denied = post(client, '/admin/models/probe', command, admin, 422)
    assert denied['code'] == 'unsupported_probe_model'
    with app.state.database.transaction() as session:
        assert budget(session)['requestCount'] == 0


def test_probe_settles_real_usage_replays_without_payment_or_participant_changes(runtime):
    app, client, admin = runtime
    configure(runtime)
    calls = []
    def provider(request):
        import json
        calls.append(request)
        assert str(request.url) == 'https://api.openai.com/v1/responses'
        assert request.headers['authorization'] == 'Bearer test-secret-never-return'
        body = json.loads(request.content)
        assert body == {'model': MODEL_NAME, 'input': 'Reply with exactly: Connection OK',
                        'max_output_tokens': 128, 'reasoning': {'effort': 'none'}, 'store': False,
                        'stream': False, 'tools': [], 'service_tier': 'default'}
        return successful_response()
    install_transport(runtime, provider)
    command = {'requestId': 'connection-test', 'modelId': MODEL_ID}
    result = post(client, '/admin/models/probe', command, admin)
    assert result['status'] == 'succeeded' and result['responseText'] == 'Connection OK'
    assert result['costStatus'] == 'settled' and result['costUsd'] == (17 * 750 + 3 * 4500) / 1e9
    assert result['budget']['reservedUsd'] == 0
    assert post(client, '/admin/models/probe', command, admin) == result
    assert len(calls) == 1
    with app.state.database.transaction() as session:
        assert not list(session.scalars(select(Participant)))
        rows = list(session.scalars(select(Job))) + list(session.scalars(select(AuditLog)))
        assert 'test-secret-never-return' not in repr([r.__dict__ for r in rows])
        job = session.scalar(select(Job).where(Job.kind == KIND))
        assert job.progress['providerRequestId'] == 'provider-request-1'
    assert 'test-secret-never-return' not in str(result)
    # Filling a key/probing does not accidentally open research issuance.
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': MODEL_ID}, admin)
    assert preview['canIssue'] is False


@pytest.mark.parametrize('outcome', ['timeout', 'http-error', 'missing-usage', 'wrong-model', 'malformed'])
def test_unknown_outcome_keeps_hold_and_replay_never_resends(runtime, outcome):
    app, client, admin = runtime
    configure(runtime)
    calls = []
    def provider(request):
        calls.append(request)
        if outcome == 'timeout':
            raise httpx.ReadTimeout('Private provider details must not escape', request=request)
        if outcome == 'http-error':
            return httpx.Response(401, json={'error': 'test-secret-never-return'})
        if outcome == 'malformed':
            return httpx.Response(200, text='not json')
        data = successful_response().json()
        if outcome == 'missing-usage':
            data.pop('usage')
        else:
            data['model'] = 'different-model'
        return httpx.Response(200, json=data)
    install_transport(runtime, provider)
    command = {'requestId': 'uncertain', 'modelId': MODEL_ID}
    result = post(client, '/admin/models/probe', command, admin)
    assert result['status'] == 'uncertain' and result['costStatus'] == 'reserved'
    assert result['budget']['reservedUsd'] == RESERVE_NANO / 1e9
    assert result['budget']['spentUsd'] == 0
    assert post(client, '/admin/models/probe', command, admin) == result and len(calls) == 1
    assert 'test-secret-never-return' not in str(result)
    # A new process and saving/removing models cannot erase spend/holds.
    new_app = create_app(app.state.service.settings)
    with TestClient(new_app) as new_client:
        settings = new_client.get('/api/v1/admin/settings', headers=admin).json()
        saved = post(new_client, '/admin/settings', {'requestId': 'remove-model', 'revision': settings['revision'],
                     'environmentName': '另一个环境名', 'models': []}, admin)
        assert saved['modelBudget'] == result['budget']
    new_app.state.database.engine.dispose()


def test_concurrent_requests_cannot_exceed_budget_and_uncertain_calls_are_not_retried(runtime):
    app, _, _ = runtime
    configure(runtime)
    def provider(request):
        raise httpx.ReadTimeout('unknown outcome', request=request)
    install_transport(runtime, provider)
    def run(index):
        try:
            return app.state.model_probe.run(MODEL_ID, f'parallel-{index}')
        except Problem as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, range(6)))
    assert results.count('model_budget_exhausted') == 3
    with app.state.database.transaction() as session:
        jobs = list(session.scalars(select(Job).where(Job.kind == KIND)))
        assert len(jobs) == 3 and sum(job.progress['chargeNano'] for job in jobs) <= CAP_NANO
        assert not budget(session)['canRequest']


def test_same_request_in_flight_returns_original_job_without_duplicate_call(runtime):
    app, _, _ = runtime
    configure(runtime)
    entered, release = Event(), Event()
    calls = []
    def provider(request):
        calls.append(request)
        entered.set()
        assert release.wait(10)
        return successful_response()
    install_transport(runtime, provider)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(app.state.model_probe.run, MODEL_ID, 'same-command')
        assert entered.wait(10)
        try:
            replay = app.state.model_probe.run(MODEL_ID, 'same-command')
            assert replay['status'] == 'running' and len(calls) == 1
        finally:
            release.set()
        assert first.result()['status'] == 'succeeded'
    assert app.state.model_probe.run(MODEL_ID, 'same-command')['status'] == 'succeeded'
    assert len(calls) == 1
