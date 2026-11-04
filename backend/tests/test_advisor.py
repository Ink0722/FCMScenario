"""Exercise the actual SDK/Responses wire protocol with no paid provider traffic."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
import json
from threading import Event
from uuid import uuid4

import httpx2
import pytest
from openai import OpenAI
from sqlalchemy import select

from backend.app.advisor import ProtocolError, make_instructions, public_case, read_material, search_material
from backend.app.advisor_config import CALL_KIND, TURN_KIND, VALIDATION_KIND, descriptor
from backend.app.db import Assignment, Job, Participant, Task, now
from backend.app.model_runtime import CAP_NANO, KIND, MODEL_ID, MODEL_NAME, RESERVE_NANO, budget
from backend.tests.test_experiment import runtime, post, enter, start, decide, send
from backend.tests.test_model_runtime import configure


class Provider:
    def __init__(self):
        self.requests = []
        self.fail_at = None
        self.before_reply = None
        self.invalid_strategy = False
        self.generations = 0
        self.truncate_reply = False
        self.extra_material = False

    def __call__(self, request):
        body = json.loads(request.content)
        for item in body.get('input', []):
            if isinstance(item, dict):
                assert 'async_' not in item
                assert all(value is not None for value in item.values())
        self.requests.append((str(request.url), body))
        if request.url.path.endswith('/input_tokens'):
            return httpx2.Response(200, json={'input_tokens': 1000, 'object': 'response.input_tokens'})
        self.generations += 1
        if self.fail_at == self.generations:
            raise httpx2.ReadTimeout('PRIVATE error body')
        stage = 'reply' if body['tool_choice'] == 'none' else 'prepare'
        case = json.JSONDecoder().raw_decode(body['instructions'].split('Public case (data):\n', 1)[1])[0]
        document_id = case['references'][0]['document_id']
        if stage == 'prepare':
            assert not any(item.get('role') in ('developer', 'system') for item in body['input'])
            assert 'Current phase: preparation.' in body['instructions']
        if stage == 'reply':
            if self.before_reply:
                self.before_reply()
            output = [{'type': 'message', 'id': 'msg1', 'role': 'assistant', 'status': 'completed',
                       'content': [{'type': 'output_text', 'text': f'Compare costs over eight years ({document_id}, p. 1).', 'annotations': []}]}]
        else:
            if isinstance(body['tool_choice'], dict) and body['tool_choice']['name'] == 'select_strategy':
                name, arguments = 'select_strategy', {'strategy_id': 'S00'}
            elif isinstance(body['tool_choice'], dict) or self.extra_material:
                name, arguments = 'read_material', {'document_id': document_id, 'start_page': 1, 'end_page': 1}
            else:
                name, arguments = 'select_strategy', {'strategy_id': 'BAD' if self.invalid_strategy else 'S00'}
            output = [{'type': 'function_call', 'id': f'fc{self.generations}', 'call_id': f'call{self.generations}',
                       'name': name, 'arguments': json.dumps(arguments), 'status': 'completed'}]
            # Preparation text must remain hidden from the participant.
            output.insert(0, {'type': 'message', 'id': 'hidden', 'role': 'assistant', 'status': 'completed',
                              'content': [{'type': 'output_text', 'text': 'PRIVATE PREPARATION', 'annotations': []}]})
        output.insert(0, {'type': 'reasoning', 'id': f'rs{self.generations}', 'summary': [{'type': 'summary_text', 'text': 'Provider native summary.'}], 'encrypted_content': 'opaque'})
        response = {'id': f'resp{self.generations}', 'object': 'response', 'created_at': 1, 'status': 'completed', 'model': MODEL_NAME,
                    'output': output, 'usage': {'input_tokens': 1000, 'output_tokens': 100, 'output_tokens_details': {'reasoning_tokens': 50}}}
        events = []
        if stage == 'reply':
            events.append({'type': 'response.output_text.delta', 'delta': output[-1]['content'][0]['text'],
                           'item_id': 'msg1', 'output_index': 1, 'content_index': 0, 'sequence_number': 1})
        if not (stage == 'reply' and self.truncate_reply):
            events.append({'type': 'response.completed', 'response': response, 'sequence_number': 2})
        data = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events)
        return httpx2.Response(200, text=data, headers={'content-type': 'text/event-stream', 'x-request-id': 'req_sdk_test'})


def install(runtime, provider=None):
    configure(runtime)
    provider = provider or Provider()
    runtime[0].state.advisor.client = lambda connection, key: OpenAI(api_key=key, base_url=connection['baseUrl'], max_retries=0,
        http_client=httpx2.Client(transport=httpx2.MockTransport(provider)))
    return provider


def validate(runtime, request='validate'):
    app, client, admin = runtime
    queued = post(client, '/admin/models/validate-advisor', {'requestId': request, 'modelId': MODEL_ID}, admin)
    assert queued['status'] == 'queued'
    assert app.state.advisor.tick()
    return client.get(f'/api/v1/admin/models/advisor-validations/{queued["jobId"]}', headers=admin).json()


def live_enter(runtime, maximum=3, condition='neutral'):
    app, client, admin = runtime
    preview = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'maxTurns': maximum, 'modelId': MODEL_ID}, admin)
    assert preview['canIssue'], preview
    codes = post(client, '/admin/codes', {'requestId': str(uuid4()), 'configRef': preview['configRef'],
                'groups': [{'condition': condition, 'count': 1}]}, admin)
    _, headers, tasks, code = enter(runtime, codes['codes'][0]['code'])
    snapshot = start(runtime, headers, tasks[0]['id'])
    attempt_id = snapshot['session']['id']
    decide(runtime, headers, attempt_id, 'pre')
    return headers, attempt_id, snapshot


def test_validation_actual_sdk_stream_tools_and_readiness_are_version_bound(runtime):
    app, client, admin = runtime
    provider = install(runtime)
    old = post(client, '/admin/code-preview', {'taskCodes': ['task-7k3m'], 'modelId': MODEL_ID}, admin)
    assert not old['canIssue']
    result = validate(runtime)
    assert result['status'] == 'succeeded', result
    assert result['selectedStrategy']['strategy_id'] == 'S00'
    assert [t['name'] for t in result['toolCalls']] == ['read_material', 'select_strategy']
    assert len(result['modelCalls']) == 3 and all(c['costStatus'] == 'settled' for c in result['modelCalls'])
    assert all(c['reasoningSummaryStatus'] == 'available' for c in result['modelCalls'])
    assert result['responseText'].startswith('Compare costs')
    assert result['budget']['spentUsd'] == 3 * (1000 * 750 + 100 * 4500) / 1e9
    assert result['budget']['reservedUsd'] == 0
    assert len(provider.requests) == 6
    assert post(client, '/admin/models/validate-advisor', {'requestId': 'validate', 'modelId': MODEL_ID}, admin) == result
    assert len(provider.requests) == 6
    post(client, '/admin/codes', {'requestId': 'old-preview', 'configRef': old['configRef'], 'groups': [{'condition': 'neutral', 'count': 1}]}, admin, 409)
    with app.state.database.transaction() as session:
        assert list(session.scalars(select(Participant))) == []
    assert client.get('/api/v1/admin/settings', headers=admin).json()['models'][0]['runtimeReady']
    configure(runtime, api_key='replacement-key')
    assert not client.get('/api/v1/admin/settings', headers=admin).json()['models'][0]['runtimeReady']
    assert 'test-secret-never-return' not in str(result)


def test_neutral_context_whitelist_goal_target_and_scoped_material(runtime):
    app = runtime[0]
    config = app.state.service.store.preview(['task-7k3m'])
    task = {'scenario_id': config['bundle']['scenarios'][0]['scenario_id'], 'option_order': ['B', 'A'], 'target_option_id': 'SECRET_TARGET'}
    config['bundle']['scenarios'][0]['research_notes'] = 'PRIVATE_REFERENCE'
    text = make_instructions(descriptor(), config, task, 'neutral')
    assert 'SECRET_TARGET' not in text and 'PRIVATE_REFERENCE' not in text
    assert [o['id'] for o in public_case(config, task)['options']] == ['B', 'A']
    assert 'SECRET_TARGET' in make_instructions(descriptor(), config, task, 'goal')
    pdf = read_material(app.state.service.store, config, task, {'document_id': '01-01', 'start_page': 1, 'end_page': 1})
    assert pdf['pages'][0]['textAvailable'] and pdf['revision'] == config['documents']['01-01']
    found = search_material(app.state.service.store, config, task, {'document_id': '01-01', 'query': '销售费 赎回'})
    assert found['pages'] and len(found['pages']) <= 3
    for args in ({'document_id': '../../private', 'start_page': 1, 'end_page': 1},
                 {'document_id': '01-01', 'start_page': 1, 'end_page': 4}):
        with pytest.raises(ProtocolError):
            read_material(app.state.service.store, config, task, args)


def test_live_http_three_turns_and_saved_replay_no_model_calls(runtime):
    app, client, admin = runtime
    provider = install(runtime)
    assert validate(runtime)['status'] == 'succeeded'
    headers, attempt, snapshot = live_enter(runtime)
    assert snapshot['session']['runtimeMode'] == 'agent'
    for index in range(3):
        accepted, message = send(runtime, headers, attempt)
        assert post(client, f'/attempts/{attempt}/turns', message, headers, 202)['turnId'] == accepted['turnId']
        def before_reply():
            with app.state.database.transaction() as session:
                task = session.scalar(select(Task))
                turn = task.task_data['attempts'][0]['turns'][-1]
                assert turn['selected_strategy']['strategy_id'] == 'S00'
                assert not any(m['role'] == 'assistant' for m in turn['messages'])
        provider.before_reply = before_reply
        assert app.state.advisor.tick()
        reply = client.get(f'/api/v1/attempts/{attempt}/turns/{accepted["turnId"]}', headers=headers).json()
        assert reply['status'] == 'completed', reply
        assert 'PRIVATE' not in str(reply) and 'S00' not in str(reply)
        assert reply['policy']['completedTurns'] == index + 1
        assert reply['stage'] == ('post' if index == 2 else 'dialogue')
    before = len(provider.requests)
    with app.state.database.transaction() as session:
        task_id = session.scalar(select(Task.task_id))
    detail = client.get(f'/api/v1/admin/tasks/{task_id}', headers=admin).json()
    assert len(detail['attempts'][0]['turns']) == 3
    assert len(provider.requests) == before
    requests = [b for url, b in provider.requests if url.endswith('/responses')]
    assert all(b['store'] is False and 'previous_response_id' not in b for b in requests)
    assert requests[-1]['tools'] == [] and requests[-1]['reasoning']['effort'] == 'medium'
    assert 'Provider native summary.' in str(detail)


def test_ambiguous_request_preserves_old_holds_no_retries_and_worker_recovery(runtime):
    app = runtime[0]
    provider = install(runtime)
    provider.fail_at = 1
    with app.state.database.transaction() as session:
        session.add(Job(kind=KIND, scope_ref={}, actor_id='researcher', idempotency_key='old-hold', status='uncertain',
                        progress={'chargeNano': RESERVE_NANO, 'usage': None}))
    result = validate(runtime)
    assert result['status'] == 'interrupted'
    assert provider.generations == 1
    assert result['budget']['reservedUsd'] > RESERVE_NANO / 1e9
    assert not app.state.advisor.tick() and provider.generations == 1
    assert 'PRIVATE error body' not in str(result)
    with app.state.database.transaction() as session:
        job = session.scalar(select(Job).where(Job.kind == VALIDATION_KIND))
        job.status, job.lease_expires_at = 'running', now() - timedelta(seconds=1)
    assert not app.state.advisor.tick()
    assert provider.generations == 1
    with app.state.database.transaction() as session:
        assert budget(session)['reservedUsd'] == result['budget']['reservedUsd']


def test_invalid_strategy_is_not_replaced_with_s00(runtime):
    provider = install(runtime)
    provider.invalid_strategy = True
    result = validate(runtime)
    assert result['status'] == 'interrupted'
    assert result['selectedStrategy'] is None and not result['responseText']
    assert result['toolCalls'][-1]['status'] == 'failed'
    assert provider.generations == 2


def test_abandon_during_provider_reply_prevents_late_result_advancing_new_attempt(runtime):
    app, client, admin = runtime
    provider = install(runtime)
    assert validate(runtime)['status'] == 'succeeded'
    headers, attempt, snapshot = live_enter(runtime)
    accepted, _ = send(runtime, headers, attempt)
    waiting, release = Event(), Event()
    provider.before_reply = lambda: (waiting.set(), release.wait(10))
    with ThreadPoolExecutor() as pool:
        work = pool.submit(app.state.advisor.tick)
        assert waiting.wait(10)
        # Refreshing and concurrent workers observe the original execution.
        assert not app.state.advisor.tick()
        post(client, f'/attempts/{attempt}/abandon', {'requestId': 'leave'}, headers, 204)
        new = start(runtime, headers, snapshot['task']['id'])
        release.set()
        assert work.result(10)
    with app.state.database.transaction() as session:
        task = session.scalar(select(Task))
        assert task.runtime_state['current_attempt_id'] == new['session']['id']
        assert task.runtime_state['active_turn_id'] is None
        assert task.task_data['attempts'][1]['turns'] == []
        assert task.task_data['attempts'][0]['turns'][0]['status'] == 'cancelled'
        # Cancellation closed the stream before terminal usage: preserve its
        # reservation, while earlier, confirmed calls stay settled.
        calls = list(session.scalars(select(Job).where(Job.kind == CALL_KIND).order_by(Job.created_at)))
        assert calls[-1].status == 'uncertain' and calls[-1].progress['usage'] is None
        assert all(row.progress['usage'] is not None for row in calls[:-1])


def test_global_budget_includes_old_holds_and_blocks_generation_before_send(runtime):
    app, client, _ = runtime
    provider = install(runtime)
    assert validate(runtime)['status'] == 'succeeded'
    headers, attempt, _ = live_enter(runtime)
    with app.state.database.transaction() as session:
        used = round(budget(session)['spentUsd'] * 1e9)
        session.add(Job(kind=KIND, scope_ref={}, actor_id='researcher', idempotency_key='hold-near-cap', status='uncertain',
                        progress={'usage': None, 'chargeNano': CAP_NANO - used - 1000}))
    before = provider.generations
    accepted, _ = send(runtime, headers, attempt)
    assert app.state.advisor.tick()
    result = client.get(f'/api/v1/attempts/{attempt}/turns/{accepted["turnId"]}', headers=headers).json()
    assert result['status'] == 'interrupted' and result['policy']['completedTurns'] == 0
    assert 'budget' in result['error'] and provider.generations == before
    with app.state.database.transaction() as session:
        assert budget(session)['remainingUsd'] == .000001


def test_lost_stream_retains_partial_text_and_hold_and_never_counts_completion(runtime):
    app, client, _ = runtime
    provider = install(runtime)
    assert validate(runtime)['status'] == 'succeeded'
    headers, attempt, _ = live_enter(runtime)
    provider.truncate_reply = True
    accepted, _ = send(runtime, headers, attempt)
    assert app.state.advisor.tick()
    result = client.get(f'/api/v1/attempts/{attempt}/turns/{accepted["turnId"]}', headers=headers).json()
    assert result['status'] == 'interrupted' and result['policy']['completedTurns'] == 0
    assert result['messages'][-1]['text'].startswith('Compare costs')
    assert result['messages'][-1]['status'] == 'interrupted'
    before = provider.generations
    assert not app.state.advisor.tick() and provider.generations == before
    with app.state.database.transaction() as session:
        assert budget(session)['reservedUsd'] > 0


def test_expired_worker_lease_interrupts_turn_without_reexecuting_it(runtime):
    app, client, _ = runtime
    provider = install(runtime)
    assert validate(runtime)['status'] == 'succeeded'
    headers, attempt, _ = live_enter(runtime)
    accepted, _ = send(runtime, headers, attempt)
    assert app.state.advisor._claim()
    with app.state.database.transaction() as session:
        job = session.scalar(select(Job).where(Job.kind == TURN_KIND))
        job.lease_expires_at = now() - timedelta(seconds=1)
    before = provider.generations
    assert not app.state.advisor.tick() and provider.generations == before
    result = client.get(f'/api/v1/attempts/{attempt}/turns/{accepted["turnId"]}', headers=headers).json()
    assert result['status'] == 'interrupted' and result['policy']['completedTurns'] == 0


def test_material_reading_always_leaves_a_generation_for_strategy_and_reply(runtime):
    provider = install(runtime)
    provider.extra_material = True
    result = validate(runtime)
    assert result['status'] == 'succeeded'
    assert len(result['modelCalls']) == 4 and len(result['toolCalls']) == 3
    assert result['selectedStrategy']['strategy_id'] == 'S00' and result['responseText']
