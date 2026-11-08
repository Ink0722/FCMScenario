"""Durable, budgeted Responses Advisor. All provider I/O is outside DB transactions.

No automatic POST retries, no remote tools, no hidden measurement context. A lost
worker lease interrupts the turn; ambiguous provider calls retain their holds.
"""
from copy import deepcopy
from datetime import timedelta
import json
import re
import time
from uuid import uuid4

import httpx2
from openai import OpenAI
from sqlalchemy import select, text

from .advisor_config import CALL_KIND, TURN_KIND, VALIDATION_KIND, PREPARE_INSTRUCTION, descriptor, readiness_key
from .db import Assignment, Job, Task, now
from .model_runtime import CAP_NANO, INPUT_NANO, OUTPUT_NANO, budget, lock, supported
from .service import Problem, aware, fail, fingerprint, stamp
from .citations import resolve_citations


class Stopped(Exception):
    pass


class ProtocolError(Exception):
    pass


LEASE_SECONDS = 90


def tools_for(runtime):
    return deepcopy(runtime['tools'])


def public_case(config, task):
    scenario = deepcopy(next(s for s in config['bundle']['scenarios'] if s['scenario_id'] == task['scenario_id']))
    # Explicit whitelist: never serialize assignment/task data or instruments.
    allowed = ('case_id', 'scenario_id', 'title', 'background', 'common_facts', 'task', 'options',
               'comparison', 'additional_information', 'references', 'knowledge', 'locale', 'revision')
    scenario = {k: scenario[k] for k in allowed if k in scenario}
    scenario['options'].sort(key=lambda o: task['option_order'].index(o['id']))
    for reference in scenario['references']:
        reference.pop('url', None)
    return scenario


def make_instructions(runtime, config, task, condition):
    prompt = runtime['prompt']
    policy = prompt['neutral'] if condition == 'neutral' else prompt['goal'].replace('{target}', task['target_option_id'])
    return '\n\n'.join([prompt['instructions'], prompt['resource_policy'], policy,
        'Strategy catalogue:\n' + json.dumps(runtime['toolbox'], ensure_ascii=False),
        'Public case (data):\n' + json.dumps(public_case(config, task), ensure_ascii=False)])


def read_material(store, config, task, arguments):
    if set(arguments) != {'document_id', 'start_page', 'end_page'}:
        raise ProtocolError('invalid_material_arguments')
    document, start, end = (arguments[k] for k in ('document_id', 'start_page', 'end_page'))
    references = {r['document_id']: r for r in public_case(config, task)['references']}
    if document not in references or type(start) is not int or type(end) is not int or not 1 <= start <= end or end - start >= 3:
        raise ProtocolError('material_scope_or_page_limit')
    ref = config['documents'][document]
    if ref != references[document]['revision'] or len(ref) != 64 or any(c not in '0123456789abcdef' for c in ref):
        raise ProtocolError('material_revision_mismatch')
    try:
        parsed = store.material_text(ref)
    except ValueError:
        raise ProtocolError('material_checksum_mismatch')
    if end > len(parsed['pages']):
        raise ProtocolError('material_page_out_of_range')
    pages = []
    remaining = 18000
    for number in range(start, end + 1):
        original = parsed['pages'][number - 1]['text']
        extracted = original[:remaining]
        remaining -= len(extracted)
        pages.append({'page': number, 'text': extracted, 'truncated': len(extracted) != len(original),
                      'textAvailable': bool(original.strip())})
    return {'document_id': document, 'revision': ref, 'total_pages': len(parsed['pages']), 'pages': pages,
            'scope': 'frozen-public-material', 'extractor': parsed['extractor'], 'ocr': False}


def search_material(store, config, task, arguments):
    if not isinstance(arguments, dict) or set(arguments) != {'document_id', 'query'} or not isinstance(arguments['query'], str) or not 1 <= len(arguments['query']) <= 200:
        raise ProtocolError('invalid_material_search')
    # Reuse the same case/revision/checksum checks; read only frozen PDF bytes.
    first = read_material(store, config, task, {'document_id': arguments['document_id'], 'start_page': 1, 'end_page': 1})
    parsed = store.material_text(first['revision'])
    keywords = set(re.findall(r'[a-z0-9]{2,}|[\u3400-\u9fff]{2,}', arguments['query'].lower()))
    if not keywords:
        raise ProtocolError('material_search_keywords_required')
    matches = []
    for number, page in enumerate(parsed['pages'], 1):
        content = page['text']
        lower = content.lower()
        score = sum(min(lower.count(word), 5) for word in keywords)
        if score:
            hit = min(lower.find(word) for word in keywords if word in lower)
            offset = max(0, hit - 300)
            matches.append((score, number, {'page': number, 'text': content[offset:offset + 4000],
                                           'excerptOffset': offset, 'truncated': offset > 0 or len(content) > offset + 4000}))
    matches.sort(key=lambda value: (-value[0], value[1]))
    return {'document_id': arguments['document_id'], 'revision': first['revision'], 'query': arguments['query'],
            'pages': [match[2] for match in matches[:3]], 'total_pages': len(parsed['pages']),
            'scope': 'frozen-public-material', 'method': 'local-keyword-search', 'extractor': parsed['extractor'], 'ocr': False}


class AdvisorRuntime:
    def __init__(self, database, service, environment):
        self.database, self.service, self.environment = database, service, environment
        self.store = service.store

    @staticmethod
    def client(connection, key):
        return OpenAI(api_key=key, base_url=connection['baseUrl'], max_retries=0,
                      timeout=httpx2.Timeout(25, connect=8),
                      http_client=httpx2.Client(trust_env=True, follow_redirects=False, timeout=httpx2.Timeout(25, connect=8)))

    def validation(self, model_id, request_id, task_code='task-7k3m', condition='neutral', target='A', turn_count=1):
        payload = {'modelId': model_id, 'taskCode': task_code, 'condition': condition, 'targetOptionId': target, 'turnCount': turn_count}
        with self.database.transaction() as session:
            if session.bind.dialect.name == 'postgresql':
                session.execute(text('SELECT pg_advisory_xact_lock(713025)'))
            key = f'advisor-validation:{request_id}'
            row = session.scalar(select(Job).where(Job.idempotency_key == key))
            if row:
                fail(row.progress['modelId'] == model_id, 'idempotency_conflict', '该验证编号已用于其他模型。')
                fail(row.progress.get('requestHash', fingerprint(payload)) == fingerprint(payload), 'idempotency_conflict', '该验证编号已用于其他验收范围。')
                return self.validation_result(session, row)
            model = self.environment.freeze_model(session, model_id, self.store)
            connection = self.store.get(model['configRef'])['connection']
            fail(supported(connection), 'unsupported_advisor_model', '首版 Advisor 仅支持已核价的 GPT 预设连接。', 422)
            fail(bool(connection.get('apiKeyCiphertext')), 'model_key_required', '请先在设置中保存 API Key。', 422)
            self.environment.cipher.decrypt(connection['apiKeyCiphertext'].encode())
            config = self.store.preview([task_code], model=model)
            from .model_runtime import estimate
            check = estimate(session, {'runtime_mode': 'agent', 'policy': {'minimum': turn_count}}, 1)
            fail(check['canIssue'], 'model_budget_insufficient_for_validation', f'本次 {turn_count} 轮验收参考费用 ${check["estimatedMinimumUsd"]:.6f}，可用 ${check["remainingUsd"]:.6f}。')
            ref = self.store.freeze(config)
            row = Job(kind=VALIDATION_KIND, actor_id='researcher', scope_ref={'config_ref': ref},
                      idempotency_key=key, status='queued', progress={
                          'modelId': model_id, 'readinessKey': readiness_key(model['configRef'], config['advisor']['runtimeRef']),
                          'requestHash': fingerprint(payload), 'taskCode': task_code, 'caseId': config['bundle']['scenarios'][0]['case_id'],
                          'condition': condition, 'targetOptionId': target if condition == 'goal' else None,
                          'turnCount': turn_count, 'completedTurns': 0, 'validationTurns': [],
                          'message': '等待 Worker 验证本地材料 Advisor。', 'tool_calls': [], 'model_calls': [], 'selected_strategy': None})
            session.add(row)
            session.flush()
            self.service.audit(session, 'validate_advisor', request_id, {'jobId': row.job_id}, {'modelId': model_id})
            return self.validation_result(session, row)

    @staticmethod
    def validation_result(session, row):
        return {'jobId': row.job_id, 'status': row.status, 'message': row.progress['message'],
                **{k: row.progress.get(k) for k in ('taskCode', 'caseId', 'condition', 'targetOptionId', 'turnCount', 'completedTurns', 'validationTurns')},
                'modelId': row.progress['modelId'], 'scope': 'local-materials-pilot',
                'selectedStrategy': row.progress.get('selected_strategy'),
                'modelCalls': row.progress.get('model_calls', []), 'toolCalls': row.progress.get('tool_calls', []),
                'responseText': row.progress.get('responseText'), 'budget': budget(session)}

    def _locate(self, session, job):
        if job.kind == VALIDATION_KIND:
            return None, None, job.progress
        assignment = session.scalar(select(Assignment).where(Assignment.participant_id == job.scope_ref['participant_id']).with_for_update())
        task = session.get(Task, job.scope_ref['task_id'])
        task.task_data = deepcopy(task.task_data)
        attempt = next(a for a in task.task_data['attempts'] if a['attempt_id'] == job.scope_ref['attempt_id'])
        turn = next(t for t in attempt['turns'] if t['turn_id'] == job.scope_ref['turn_id'])
        valid = (assignment.status not in ('cancelled', 'completed') and (not assignment.expires_at or aware(assignment.expires_at) > now())
                 and attempt['status'] == 'in_progress' and attempt['phase'] == 'dialogue'
                 and task.runtime_state.get('current_attempt_id') == attempt['attempt_id']
                 and task.runtime_state.get('active_turn_id') == turn['turn_id'])
        return task, attempt, turn if valid else None

    def _update(self, job_id, owner, action):
        with self.database.transaction() as session:
            # Assignment -> job matches the participant API, including cancellation.
            scope = session.get(Job, job_id).scope_ref
            if 'participant_id' in scope:
                session.scalar(select(Assignment).where(Assignment.participant_id == scope['participant_id']).with_for_update())
            job = session.scalar(select(Job).where(Job.job_id == job_id).with_for_update())
            if job.status != 'running' or job.progress.get('owner') != owner or aware(job.lease_expires_at) <= now():
                raise Stopped()
            job.progress = deepcopy(job.progress)
            task, attempt, record = self._locate(session, job)
            if record is None:
                job.status, job.finished_at = 'cancelled', now()
            else:
                action(session, job, task, attempt, record)
                job.lease_expires_at = now() + timedelta(seconds=LEASE_SECONDS)
                if task:
                    self.service.touch(task)
                else:
                    job.progress = deepcopy(record)
                return
        raise Stopped()

    def _finish(self, job_id, owner, error=None):
        def finish(session, job, task, attempt, record):
            job.status, job.finished_at = ('interrupted' if error else 'succeeded'), now()
            if job.kind == VALIDATION_KIND:
                record['message'] = f'验证未完成：{error}。未开放该连接。' if error else '真实 Advisor 验证通过：本地材料、策略提交和流式回复可用。仅供联调，案例目标尚为开发分配。'
                return
            record['status'], record['finished_at'] = ('interrupted' if error else 'completed'), stamp()
            if error:
                record['execution']['error_code'] = error
                record['error'] = ('The model budget has been reached. Please contact the researcher.' if error == 'model_budget_exhausted'
                                   else 'This reply could not be completed. Your saved messages are retained. Return to tasks to start a new attempt.')
                for message in record['messages']:
                    if message['role'] == 'assistant':
                        message['status'] = 'interrupted'
            else:
                next(m for m in record['messages'] if m['role'] == 'assistant')['status'] = 'complete'
                config = self.service.config(session.get(Assignment, task.participant_id))
                if sum(t['status'] == 'completed' for t in attempt['turns']) >= config['policy']['maximum']:
                    attempt.update(phase='post', dialogue_ended_at=stamp(), dialogue_end_reason='max_turns')
            task.runtime_state = {**task.runtime_state, 'active_turn_id': None}
        self._update(job_id, owner, finish)

    def _claim(self):
        with self.database.transaction() as session:
            if session.bind.dialect.name == 'postgresql':
                session.execute(text('SELECT pg_advisory_xact_lock(713025)'))
            jobs = list(session.scalars(select(Job).where(Job.kind.in_([TURN_KIND, VALIDATION_KIND]), Job.status.in_(['queued', 'running'])).order_by(Job.created_at)))
            # One real Advisor at a time across workers, validation and participants.
            if any(j.status == 'running' and j.lease_expires_at and aware(j.lease_expires_at) > now() for j in jobs):
                return None
            for row in jobs:
                if 'participant_id' in row.scope_ref:
                    session.scalar(select(Assignment).where(Assignment.participant_id == row.scope_ref['participant_id']).with_for_update())
                job = session.scalar(select(Job).where(Job.job_id == row.job_id).with_for_update())
                if job.status not in ('running', 'queued'):
                    continue
                job.progress = deepcopy(job.progress)
                task, attempt, record = self._locate(session, job)
                if record is None:
                    job.status, job.finished_at = 'cancelled', now()
                    continue
                if job.status == 'running':
                    # Never repeat a paid request whose outcome is ambiguous.
                    job.status, job.finished_at = 'interrupted', now()
                    record.update(status='interrupted', error='worker_interrupted', finished_at=stamp(), message='Worker 中断；预占保留，不自动重发。')
                    for message in record.get('messages', []):
                        if message['role'] == 'assistant':
                            message['status'] = 'interrupted'
                    if task:
                        record['execution']['error_code'] = 'worker_interrupted'
                        record['error'] = 'This reply was interrupted by a worker restart. Your saved messages are retained. Return to tasks to start a new attempt.'
                        task.runtime_state = {**task.runtime_state, 'active_turn_id': None}
                        self.service.touch(task)
                    else:
                        job.progress = deepcopy(record)
                    continue
                owner = str(uuid4())
                job.status, job.started_at, job.lease_expires_at = 'running', now(), now() + timedelta(seconds=LEASE_SECONDS)
                job.progress = {**job.progress, 'owner': owner}
                if task:
                    record['status'] = 'running'
                    self.service.touch(task)
                    assignment = session.get(Assignment, task.participant_id)
                    config = self.service.config(assignment)
                    task_input = {'scenario_id': task.scenario_id, 'option_order': task.option_order, 'target_option_id': task.target_option_id}
                    history = [{'role': 'assistant', 'content': attempt['opening']['text']}]
                    for turn in attempt['turns']:
                        if turn['turn_id'] == record['turn_id']:
                            break
                        if turn.get('advisor_items'):
                            # Legacy attempts retained per-turn developer controls.
                            # Keep provider output/tool evidence, not stage commands.
                            history.extend(item for item in turn['advisor_items'] if item.get('role') not in ('developer', 'system'))
                            if turn['status'] != 'completed':
                                history.extend({'role': 'assistant', 'content': m['text']} for m in turn['messages'] if m['role'] == 'assistant' and m['text'])
                        else:
                            history.extend({'role': m['role'], 'content': m['text']} for m in turn['messages'] if m['text'])
                    history.append({'role': 'user', 'content': record['messages'][0]['text']})
                    condition = assignment.condition
                else:
                    config = self.store.get(job.scope_ref['config_ref'])
                    config['_validation'] = {'turn_count': job.progress.get('turnCount', 1)}
                    task_input = {'scenario_id': config['bundle']['scenarios'][0]['scenario_id'], 'option_order': ['A', 'B'],
                                  'target_option_id': job.progress.get('targetOptionId') or 'A'}
                    history = [{'role': 'user', 'content': 'Please read a relevant reference page and explain the main comparison in this case in no more than two sentences. Do not compute exact outcomes or guess missing fees.'}]
                    condition = job.progress.get('condition', 'neutral')
                return job.job_id, owner, config, task_input, condition, history
        return None

    def _record(self, job_id, owner, collection, value):
        def record(session, job, task, attempt, data):
            data.setdefault(collection, []).append(deepcopy(value))
            if task:
                data['execution']['model_calls'] = len(data['model_calls'])
        self._update(job_id, owner, record)

    def _paid_call(self, client, connection, job_id, owner, stage, number, request, on_delta):
        self._update(job_id, owner, lambda *args: None)
        count_keys = ('model', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls', 'reasoning', 'truncation')
        count = client.responses.input_tokens.count(**{k: v for k, v in request.items() if k in count_keys}).input_tokens
        if type(count) is not int or not 0 < count <= 400000 - request['max_output_tokens']:
            raise ProtocolError('input_token_count_invalid')
        reserve = count * INPUT_NANO + request['max_output_tokens'] * OUTPUT_NANO
        # Check again after the counting network call; cancelled work must not spend.
        self._update(job_id, owner, lambda *args: None)
        request_ref = self.store.freeze({'schema_version': 1, 'kind': 'advisor_request', 'stage': stage, 'request': request,
                                         'inputTokensCounted': count, 'connectionRef': self.store.freeze({'connection': connection})})
        with self.database.transaction() as session:
            lock(session)
            parent = session.get(Job, job_id)
            fail(parent.status == 'running' and parent.progress.get('owner') == owner and aware(parent.lease_expires_at) > now(),
                 'advisor_cancelled', '运行已终止。')
            used = sum(row.progress['chargeNano'] for row in session.scalars(select(Job).where(Job.kind.in_(['model_connection_probe', CALL_KIND]))))
            fail(used + reserve <= CAP_NANO, 'model_budget_exhausted', '累计 $1 额度不足，本轮已停止。')
            ledger = Job(kind=CALL_KIND, actor_id='advisor', scope_ref={'jobId': job_id},
                         idempotency_key=f'advisor-call:{job_id}:{number}', status='running', started_at=now(),
                         progress={'chargeNano': reserve, 'usage': None, 'stage': stage, 'requestRef': request_ref,
                                   'inputTokensCounted': count, 'outputTokenLimit': request['max_output_tokens'],
                                   'modelName': connection['modelName'], 'modelId': connection['id'], 'modelLabel': connection['label'],
                                   'requestId': f'{job_id}:{number}', 'message': f'Advisor {stage}；真实流式调用。'})
            session.add(ledger)
            session.flush()
            ledger_id = ledger.job_id
        metadata = {'callId': ledger_id, 'stage': stage, 'status': 'running', 'requestRef': request_ref,
                    'modelName': connection['modelName'], 'inputTokensCounted': count,
                    'outputTokenLimit': request['max_output_tokens'], 'reservedUsd': reserve / 1e9, 'startedAt': stamp()}
        # The durable ledger is authoritative even if the attempt is closed here.
        response = None
        started = time.monotonic()
        request_id = None
        failure = None
        try:
            self._record(job_id, owner, 'model_calls', metadata)
            # Commit the ledger before sending, with retries explicitly disabled.
            with client.responses.with_streaming_response.create(**request, stream=True,
                    extra_headers={'X-Client-Request-Id': ledger_id}) as raw:
                request_id = raw.headers.get('x-request-id')
                stream = raw.parse()
                for event in stream:
                    if time.monotonic() - started > 50:
                        raise ProtocolError('provider_time_limit')
                    if event.type == 'response.output_text.delta' and stage == 'reply':
                        on_delta(event.delta)
                    elif event.type in ('response.completed', 'response.incomplete', 'response.failed'):
                        response = event.response
                    elif event.type == 'error':
                        raise ProtocolError('provider_stream_error')
                stream.close()
        except Stopped:
            failure = 'cancelled_or_lease_lost'
        except Exception as exc:
            # No upstream error bodies, keys or exception text in research records.
            failure = exc.args[0] if isinstance(exc, ProtocolError) else type(exc).__name__
        # SDK models include optional, unset output-only fields (e.g. async_).
        # Only populated wire aliases can be replayed as Responses input.
        dumped = response.model_dump(mode='json', exclude_none=True, by_alias=True) if response is not None else None
        result_ref = self.store.freeze({'response': dumped}) if dumped else None
        usage = dumped.get('usage') if dumped else None
        valid_usage = bool(dumped and dumped.get('model') == connection['modelName'] and isinstance(usage, dict)
                           and type(usage.get('input_tokens')) is int and type(usage.get('output_tokens')) is int
                           and 0 <= usage['input_tokens'] <= count and 0 <= usage['output_tokens'] <= request['max_output_tokens'])
        with self.database.transaction() as session:
            lock(session)
            ledger = session.get(Job, ledger_id)
            progress = {**ledger.progress, 'providerRequestId': request_id,
                        'providerResponseId': dumped.get('id') if dumped else None,
                        'responseRef': result_ref, 'failureKind': failure,
                        'elapsedMs': round((time.monotonic() - started) * 1000)}
            if valid_usage:
                progress['usage'] = {'inputTokens': usage['input_tokens'], 'outputTokens': usage['output_tokens'],
                                     'reasoningTokens': (usage.get('output_tokens_details') or {}).get('reasoning_tokens')}
                progress['chargeNano'] = usage['input_tokens'] * INPUT_NANO + usage['output_tokens'] * OUTPUT_NANO
            ledger.progress, ledger.finished_at = progress, now()
            ledger.status = 'succeeded' if valid_usage and not failure and dumped.get('status') == 'completed' else 'interrupted' if valid_usage else 'uncertain'
            metadata.update(status=ledger.status, **{k: progress[k] for k in ('usage', 'providerRequestId', 'providerResponseId', 'elapsedMs', 'failureKind')},
                            responseRef=result_ref, costUsd=progress['chargeNano'] / 1e9, costStatus='settled' if valid_usage else 'reserved')
        summaries = [part['text'] for item in (dumped or {}).get('output', []) if item.get('type') == 'reasoning'
                     for part in item.get('summary', []) if part.get('type') == 'summary_text']
        metadata.update(reasoningSummary=summaries, reasoningSummaryStatus=('partial' if failure or (dumped or {}).get('status') != 'completed' else 'available') if summaries else 'not_returned')
        # Billing evidence still belongs to the old turn after cancellation. Save
        # it without requiring active execution rights or advancing any attempt.
        with self.database.transaction() as session:
            parent = session.get(Job, job_id)
            if parent.kind == VALIDATION_KIND:
                record = deepcopy(parent.progress)
                record['model_calls'] = [metadata if c['callId'] == ledger_id else c for c in record['model_calls']]
                parent.progress = record
            else:
                session.scalar(select(Assignment).where(Assignment.participant_id == parent.scope_ref['participant_id']).with_for_update())
                model_task = session.get(Task, parent.scope_ref['task_id'])
                model_task.task_data = deepcopy(model_task.task_data)
                old_attempt = next(a for a in model_task.task_data['attempts'] if a['attempt_id'] == parent.scope_ref['attempt_id'])
                old_turn = next(t for t in old_attempt['turns'] if t['turn_id'] == parent.scope_ref['turn_id'])
                old_turn['model_calls'] = [metadata if c['callId'] == ledger_id else c for c in old_turn['model_calls']]
                self.service.touch(model_task)
        self._update(job_id, owner, lambda *args: None)
        if failure or not valid_usage or dumped.get('status') != 'completed':
            raise ProtocolError(failure or 'provider_incomplete_or_usage_unconfirmed')
        return dumped['output']

    def _run(self, job_id, owner, config, task, condition, history, call_offset=0):
        runtime = self.store.get(config['advisor']['runtimeRef'])
        connection = self.store.get(config['model_selection']['configRef'])['connection']
        if not supported(connection):
            raise ProtocolError('unsupported_advisor_model')
        key = self.environment.cipher.decrypt(connection['apiKeyCiphertext'].encode()).decode()
        instructions = make_instructions(runtime, config, task, condition)
        prompt = runtime['prompt']
        initial_size = len(history) - 1
        selected, tool_count = False, 0
        started = time.monotonic()
        reply = ''
        citations, citation_warnings = [], []
        last_save = 0

        def emit(delta):
            nonlocal reply, last_save
            reply += delta
            if time.monotonic() - last_save < .15:
                return
            save_text()

        def save_text():
            nonlocal last_save
            last_save = time.monotonic()
            def save(session, job, model_task, attempt, record):
                if not model_task:
                    record['responseText'] = reply
                    return
                message = next((m for m in record['messages'] if m['role'] == 'assistant'), None)
                if not message:
                    message = {'id': f'assistant-{record["turn_id"]}', 'role': 'assistant', 'text': '', 'timestamp': stamp(), 'status': 'partial', 'citations': []}
                    record['messages'].append(message)
                message['text'] = reply
                message['citations'] = deepcopy(citations)
                record['citation_warnings'] = deepcopy(citation_warnings)
            self._update(job_id, owner, save)

        def items_checkpoint():
            def save(session, job, model_task, attempt, record):
                record['advisor_items'] = deepcopy(history[initial_size:])
            self._update(job_id, owner, save)

        read_seen = any(c.get('type') == 'function_call' and c.get('name') == 'read_material' for c in history)
        with self.client(connection, key) as client:
            for number in range(1, prompt['max_model_calls_per_turn'] + 1):
                if time.monotonic() - started > prompt['max_turn_seconds']:
                    raise ProtocolError('turn_time_limit')
                stage = 'reply' if selected else 'prepare'
                phase_instruction = prompt['reply'] if selected else prompt.get('prepare', PREPARE_INSTRUCTION)
                request = {'model': connection['modelName'], 'instructions': instructions + '\n\n' + phase_instruction,
                           'input': deepcopy(history), 'store': False, 'reasoning': prompt['reasoning'],
                           'include': ['reasoning.encrypted_content'], 'max_output_tokens': prompt['max_output_tokens'],
                           'tools': [] if selected else tools_for(runtime), 'parallel_tool_calls': False,
                           'tool_choice': 'none' if selected else {'type': 'function', 'name': 'select_strategy'} if number == prompt['max_model_calls_per_turn'] - 1
                               else 'auto' if read_seen or not config['documents'] else {'type': 'function', 'name': 'read_material'},
                           'truncation': 'disabled', 'service_tier': 'default'}
                output = self._paid_call(client, connection, job_id, owner, stage, number + call_offset, request, emit)
                history.extend(output)
                if selected:
                    if any(item.get('type') == 'function_call' for item in output):
                        raise ProtocolError('reply_tool_call_forbidden')
                    final = ''.join(p['text'] for item in output if item.get('type') == 'message'
                                    for p in item.get('content', []) if p.get('type') == 'output_text')
                    if not final.strip():
                        raise ProtocolError('empty_public_reply')
                    reply = final
                    citations, citation_warnings = resolve_citations(final, history, config, task)
                    save_text()
                    items_checkpoint()
                    return
                calls = [item for item in output if item.get('type') == 'function_call']
                if len(calls) != 1:
                    raise ProtocolError('prepare_requires_one_tool_call')
                call = calls[0]
                tool_count += 1
                if tool_count > prompt['max_tool_calls_per_turn']:
                    raise ProtocolError('tool_call_limit')
                try:
                    arguments = json.loads(call['arguments'])
                except (ValueError, TypeError):
                    raise ProtocolError('invalid_tool_json')
                trace = {'callId': call['call_id'], 'name': call['name'], 'arguments': arguments,
                         'startedAt': stamp(), 'status': 'running'}
                try:
                    if call['name'] == 'read_material':
                        result = read_material(self.store, config, task, arguments)
                        read_seen = True
                    elif call['name'] == 'search_material':
                        result = search_material(self.store, config, task, arguments)
                        read_seen = True
                    elif call['name'] == 'select_strategy':
                        ids = {s['id'] for s in runtime['toolbox']['strategies']}
                        if not isinstance(arguments, dict) or set(arguments) != {'strategy_id'} or arguments['strategy_id'] not in ids or selected:
                            raise ProtocolError('invalid_or_duplicate_strategy')
                        selection = {'strategy_id': arguments['strategy_id'], 'committed_at': stamp(), 'call_id': call['call_id'],
                                     'toolbox_version': runtime['toolbox']['version']}
                        def commit(session, job, model_task, attempt, record):
                            record['selected_strategy'] = selection
                        self._update(job_id, owner, commit)
                        selected = True
                        result = {'committed': True, 'strategy_id': arguments['strategy_id']}
                    else:
                        raise ProtocolError('unknown_tool')
                    trace.update(status='succeeded', result=result, finishedAt=stamp())
                except Exception as exc:
                    trace.update(status='failed', error=exc.args[0] if isinstance(exc, ProtocolError) else type(exc).__name__, finishedAt=stamp())
                    self._record(job_id, owner, 'tool_calls', trace)
                    raise
                self._record(job_id, owner, 'tool_calls', trace)
                history.append({'type': 'function_call_output', 'call_id': call['call_id'], 'output': json.dumps(result, ensure_ascii=False)})
                items_checkpoint()
        raise ProtocolError('model_call_limit')

    def tick(self):
        claimed = self._claim()
        if not claimed:
            return False
        job_id, owner, *_ = claimed
        try:
            config, history = claimed[2], claimed[5]
            rounds = config.get('_validation', {}).get('turn_count', 1)
            for index in range(rounds):
                if index:
                    history.append({'role': 'user', 'content': ('Which assumptions and limitations should I check before deciding?' if index == 1
                                                              else 'Compare the two displayed options again using the evidence already available. Say what remains uncertain.')})
                    def reset_round(session, job, task, attempt, record):
                        record['selected_strategy'], record['responseText'] = None, ''
                    self._update(job_id, owner, reset_round)
                self._run(*claimed, call_offset=index * self.store.get(config['advisor']['runtimeRef'])['prompt']['max_model_calls_per_turn'])
                if config.get('_validation'):
                    def save_round(session, job, task, attempt, record):
                        record['completedTurns'] = index + 1
                        record.setdefault('validationTurns', []).append({'turn': index + 1, 'responseText': record.get('responseText'),
                                                                       'selectedStrategy': record.get('selected_strategy')})
                    self._update(job_id, owner, save_round)
            self._finish(job_id, owner)
        except Stopped:
            pass
        except Exception as exc:
            error = exc.code if isinstance(exc, Problem) else exc.args[0] if isinstance(exc, ProtocolError) else type(exc).__name__
            try:
                self._finish(job_id, owner, error)
            except Stopped:
                pass
        return True
