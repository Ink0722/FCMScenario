"""OpenAI connection probe and shared durable USD 1 ledger for all model calls."""
import time
from datetime import timedelta

import httpx
from sqlalchemy import func, or_, select, text

from .db import Job, now
from .service import Service, aware, fail, fingerprint, stamp

MODEL_ID = 'openai-gpt54-mini'
MODEL_NAME = 'gpt-5.4-mini-2026-03-17'
BASE_URL = 'https://api.openai.com/v1'
DEFAULT_MODEL = {'id': MODEL_ID, 'label': 'GPT-5.4 mini（联调）', 'baseUrl': BASE_URL, 'modelName': MODEL_NAME}
# Integer nano-USD avoids rounding errors. Standard text rates checked 2026-10-20:
# input USD 0.75/M, output USD 4.50/M. Ignore cache discounts conservatively.
CAP_NANO = 1_000_000_000
INPUT_NANO = 750
OUTPUT_NANO = 4500
MAX_INPUT = 400_000
MAX_OUTPUT = 128
RESERVE_NANO = MAX_INPUT * INPUT_NANO + MAX_OUTPUT * OUTPUT_NANO
KIND = 'model_connection_probe'


def supported(model):
    return model.get('baseUrl') == BASE_URL and model.get('modelName') == MODEL_NAME


def budget(session):
    rows = list(session.scalars(select(Job).where(Job.kind.in_([KIND, 'advisor_model_call']))))
    spent = sum(row.progress['chargeNano'] for row in rows if row.progress.get('usage') is not None)
    reserved = sum(row.progress['chargeNano'] for row in rows if row.progress.get('usage') is None)
    return {'currency': 'USD', 'limitUsd': CAP_NANO / 1e9, 'spentUsd': spent / 1e9,
            'reservedUsd': reserved / 1e9, 'remainingUsd': max(0, CAP_NANO - spent - reserved) / 1e9,
            'requestCount': len(rows), 'nextRequestReserveUsd': RESERVE_NANO / 1e9,
            'canRequest': spent + reserved + RESERVE_NANO <= CAP_NANO,
            'scope': '本部署累计模型调用；更换模型、保存设置或重启均不重置'}


def lock(session):
    if session.bind.dialect.name == 'postgresql':
        session.execute(text('SELECT pg_advisory_xact_lock(713023)'))


def estimate(session, config, task_count):
    """Admission guidance, not a reservation or a guarantee of final spend."""
    current = budget(session)
    applies = config.get('runtime_mode') == 'agent'
    # A conservative reference until there is enough completed-turn history.
    totals = {}
    for row in session.scalars(select(Job).where(Job.kind == 'advisor_model_call', Job.status == 'succeeded').order_by(Job.created_at.desc()).limit(80)):
        parent = row.scope_ref.get('jobId')
        totals[parent] = totals.get(parent, 0) + row.progress['chargeNano']
    units = []
    for parent_id, total in totals.items():
        parent = session.get(Job, parent_id) if parent_id else None
        rounds = parent.progress.get('completedTurns', 1) if parent and parent.kind == 'advisor_validation' else 1
        units.append((total + max(1, rounds) - 1) // max(1, rounds))
    unit = max([30_000_000, *units])
    minimum = config.get('policy', {}).get('minimum', 3)
    needed = unit * minimum * task_count if applies else 0
    remaining = round(current['remainingUsd'] * 1e9)
    allowed = not applies or remaining >= needed
    return {'applies': applies, 'taskCount': task_count, 'minimumTurns': minimum,
            'estimatedPerTurnUsd': unit / 1e9, 'estimatedMinimumUsd': needed / 1e9,
            'remainingUsd': current['remainingUsd'], 'canIssue': allowed,
            'message': ('额度不足以覆盖本批最低轮数的参考用量，请先核对待确认费用。' if not allowed else
                        '余额覆盖最低轮数的参考用量；其他任务和后续上下文会影响实际费用。') if applies else None,
            'basis': '每轮至少按 $0.03 或近期完整运行费用估算；不是费用上界，不预占预算。'}


def check_issuance_budget(session, config, task_count):
    lock(session)
    result = estimate(session, config, task_count)
    fail(result['canIssue'], 'model_budget_insufficient_for_batch',
         f'本批最低轮数参考用量 ${result["estimatedMinimumUsd"]:.6f}，可用 ${result["remainingUsd"]:.6f}。请先核对待确认费用。')
    return result


def hydrate_turn_calls(session, turns):
    """Include calls committed before a worker died, and current reconciliation."""
    parents = [t.get('execution', {}).get('job_id') for t in turns]
    ids = [c.get('callId') for t in turns for c in t.get('model_calls', [])]
    rows = list(session.scalars(select(Job).where(Job.kind == 'advisor_model_call',
        or_(Job.job_id.in_(ids), Job.scope_ref['jobId'].as_string().in_([p for p in parents if p]))).order_by(Job.created_at)))
    for turn in turns:
        calls = {c['callId']: c for c in turn.get('model_calls', []) if c.get('callId')}
        parent = turn.get('execution', {}).get('job_id')
        for row in rows:
            if row.job_id not in calls and (not parent or row.scope_ref.get('jobId') != parent):
                continue
            p = row.progress
            call = calls.setdefault(row.job_id, {'callId': row.job_id, 'startedAt': stamp(row.created_at)})
            call.update({k: p[k] for k in ('stage', 'requestRef', 'responseRef', 'modelName', 'providerRequestId',
                                          'providerResponseId', 'elapsedMs', 'failureKind', 'outputTokenLimit') if k in p})
            call.update(status=row.status, usage=p.get('usage'), costUsd=p['chargeNano'] / 1e9,
                        costStatus='settled' if p.get('usage') is not None else 'reserved')
        turn['model_calls'] = list(calls.values())


def public_result(job):
    return {'jobId': job.job_id, 'createdAt': stamp(job.created_at),
            'outputTokenLimit': job.progress.get('outputTokenLimit', MAX_OUTPUT),
            'stage': job.progress.get('stage', 'connection-probe'),
            'providerRequestId': job.progress.get('providerRequestId'),
            'providerResponseId': job.progress.get('providerResponseId'),
            'httpStatus': job.progress.get('httpStatus'), 'failureKind': job.progress.get('failureKind'),
            'modelLabel': job.progress.get('modelLabel', job.progress['modelId']),
            'modelName': job.progress.get('modelName'),
            'reconciliation': job.progress.get('reconciliation'),
            'canReconcile': job.progress.get('usage') is None and job.status in ('uncertain', 'running')
                and aware(job.created_at) <= now() - timedelta(minutes=5),
            'requestId': job.progress['requestId'], 'modelId': job.progress['modelId'],
            'status': job.status, 'message': job.progress['message'],
            'responseText': job.progress.get('responseText'), 'usage': job.progress.get('usage'),
            'costUsd': job.progress['chargeNano'] / 1e9,
            'costStatus': 'settled' if job.progress.get('usage') is not None else 'reserved',
            'finishedAt': stamp(job.finished_at) if job.finished_at else None}


def history(session, page=1, size=20):
    rows = list(session.scalars(select(Job).where(Job.kind.in_([KIND, 'advisor_model_call'])).order_by(Job.created_at.desc(), Job.job_id)
                               .offset((page - 1) * size).limit(size)))
    return {'items': [public_result(row) for row in rows],
            'total': session.scalar(select(func.count()).select_from(Job).where(Job.kind.in_([KIND, 'advisor_model_call']))),
            'page': page, 'pageSize': size, 'budget': budget(session)}


def reconcile(session, job_id, request_id, payload):
    fail(payload.get('verifiedCompleted') is True and type(payload.get('inputTokens')) is int
         and 0 <= payload['inputTokens'] <= MAX_INPUT and type(payload.get('outputTokens')) is int
         and 0 <= payload['outputTokens'] <= 1536, 'invalid_usage', '请填写已由供应商确认的有效用量。', 422)
    lock(session)
    digest = fingerprint({'jobId': job_id, **payload})
    key = f'model-probe-reconcile:{request_id}'
    prior = session.scalar(select(Job).where(Job.idempotency_key == key))
    if prior:
        fail(prior.progress['hash'] == digest, 'idempotency_conflict', '该核对请求编号已用于其他内容。')
        row = session.get(Job, job_id)
        return {**public_result(row), 'budget': budget(session)}
    row = session.scalar(select(Job).where(Job.job_id == job_id, Job.kind.in_([KIND, 'advisor_model_call'])).with_for_update())
    fail(row is not None, 'not_found', '验证记录不存在。', 404)
    fail(payload['outputTokens'] <= row.progress.get('outputTokenLimit', MAX_OUTPUT)
         and payload['inputTokens'] <= row.progress.get('inputTokensCounted', MAX_INPUT),
         'invalid_usage', '用量超过原请求上界，请检查供应商记录。', 422)
    fail(public_result(row)['canReconcile'], 'probe_not_reconcilable', '仅可核对登记已满 5 分钟、用量仍未确认的请求；已结算记录不能改写。')
    charge = payload['inputTokens'] * INPUT_NANO + payload['outputTokens'] * OUTPUT_NANO
    fail(charge <= row.progress['chargeNano'], 'invalid_usage', '核对费用超过原预占，请保留预占并检查供应商记录。', 422)
    verification = {'providerReference': payload['providerReference'], 'evidence': payload['evidence'],
                    'verifiedCompleted': True, 'actor': 'researcher', 'reconciledAt': stamp()}
    row.progress = {**row.progress, 'reconciliation': verification, 'chargeNano': charge,
                    'usage': {'inputTokens': payload['inputTokens'], 'outputTokens': payload['outputTokens']},
                    'originalStatus': row.status, 'message': row.progress['message'] + ' 额度已按供应商确认记录核对。'}
    row.status, row.finished_at = 'reconciled', now()
    session.add(Job(kind='reconcile_model_probe', scope_ref={'jobId': job_id}, actor_id='researcher',
                    idempotency_key=key, status='succeeded', progress={'hash': digest}, finished_at=now()))
    Service.audit(session, 'reconcile_model_probe', request_id, {'jobId': job_id},
                  {'usage': row.progress['usage'], 'chargeNano': charge, **verification})
    session.flush()
    return {**public_result(row), 'budget': budget(session)}


class ModelProbe:
    def __init__(self, database, environment, store):
        self.database, self.environment, self.store = database, environment, store

    @staticmethod
    def client():
        return httpx.Client(timeout=httpx.Timeout(20, connect=5), follow_redirects=False,
                            transport=httpx.HTTPTransport(retries=0), trust_env=True)

    def run(self, model_id, request_id):
        digest = fingerprint({'modelId': model_id})
        key = f'model-probe:{request_id}'
        # Reserve before network I/O, commit, then release all DB locks. An abrupt
        # process exit leaves the reservation intact; replay never resends a POST.
        with self.database.transaction() as session:
            lock(session)
            prior = session.scalar(select(Job).where(Job.idempotency_key == key))
            if prior:
                fail(prior.progress['hash'] == digest, 'idempotency_conflict', '该请求编号已用于另一模型。')
                return {**public_result(prior), 'budget': budget(session)}
            selected = next((m for m in self.environment.private(session)['models'] if m['id'] == model_id), None)
            fail(selected is not None, 'model_not_found', '所选模型已不存在，请刷新设置。', 422)
            fail(supported(selected), 'unsupported_probe_model', '当前连接验证仅支持预设的 OpenAI GPT-5.4 mini 固定版本。', 422)
            fail(selected.get('apiKeyCiphertext'), 'model_key_required', '请先在此模型的 API Key 栏填写密钥并保存设置。', 422)
            # Decrypt before making a reservation, and never persist/log plaintext.
            api_key = self.environment.cipher.decrypt(selected['apiKeyCiphertext'].encode()).decode()
            current = budget(session)
            fail(current['canRequest'], 'model_budget_exhausted', '剩余额度不足以覆盖请求上界，已停止调用（累计上限 $1）。')
            ref = self.store.freeze({'schema_version': 1, 'kind': 'model_connection', 'connection': selected})
            job = Job(kind=KIND, scope_ref={'modelConfigRef': ref}, actor_id='researcher',
                      idempotency_key=key, status='running', started_at=now(), progress={
                          'hash': digest, 'requestId': request_id, 'modelId': model_id,
                          'modelLabel': selected['label'], 'modelName': selected['modelName'],
                          'chargeNano': RESERVE_NANO, 'usage': None,
                          'message': '请求已登记；若结果不明，将保留额度占用且不自动重发。'})
            session.add(job)
            session.flush()
            job_id = job.job_id
        started = time.monotonic()
        result = {'status': 'uncertain', 'message': '请求结果或用量未确认，已保留预占额度；请核对供应商记录。'}
        try:
            with self.client() as client:
                response = client.post(BASE_URL + '/responses', headers={
                    'Authorization': f'Bearer {api_key}', 'X-Client-Request-Id': job_id}, json={
                        'model': MODEL_NAME, 'input': 'Reply with exactly: Connection OK',
                        'max_output_tokens': MAX_OUTPUT, 'reasoning': {'effort': 'none'},
                        'store': False, 'stream': False, 'tools': [], 'service_tier': 'default'})
            result['providerRequestId'] = response.headers.get('x-request-id')
            result['httpStatus'] = response.status_code
            if response.is_success:
                data = response.json()
                usage = data.get('usage') or {}
                inp, out = usage.get('input_tokens'), usage.get('output_tokens')
                valid = (data.get('model') == MODEL_NAME and type(inp) is int and type(out) is int
                         and 0 <= inp <= MAX_INPUT and 0 <= out <= MAX_OUTPUT)
                if valid:
                    result.update(usage={'inputTokens': inp, 'outputTokens': out}, chargeNano=inp * INPUT_NANO + out * OUTPUT_NANO)
                texts = [part['text'] for item in data.get('output', []) if item.get('type') == 'message'
                         for part in item.get('content', []) if part.get('type') == 'output_text' and isinstance(part.get('text'), str)]
                if valid and data.get('model') == MODEL_NAME and data.get('status') == 'completed' and texts:
                    result.update(status='succeeded', message='连接验证成功；完整对话能力请使用独立的 Advisor 验证。', responseText='\n'.join(texts)[:2000])
                elif valid:
                    result.update(status='failed', message='已收到模型响应和用量，但未获得预期的完整文本回复。')
                result['providerResponseId'] = data.get('id')
            else:
                # Do not echo upstream bodies: they may contain credentials or
                # submitted content. Missing authoritative usage keeps the hold.
                result['message'] = f'供应商返回 HTTP {response.status_code}；未自动重试，预占额度保留待核对。'
                result['failureKind'] = ('authentication' if response.status_code in (401, 403) else
                                         'rate_limit' if response.status_code == 429 else 'provider_error')
        except httpx.TimeoutException:
            result['failureKind'] = 'timeout'
        except httpx.HTTPError:
            result['failureKind'] = 'transport'
        except (ValueError, TypeError, KeyError, AttributeError):
            result['failureKind'] = 'invalid_response'
        with self.database.transaction() as session:
            lock(session)
            job = session.get(Job, job_id)
            if job.progress.get('reconciliation'):
                return {**public_result(job), 'budget': budget(session)}
            job.status = result.pop('status')
            job.progress = {**job.progress, **result, 'elapsedMs': round((time.monotonic() - started) * 1000)}
            job.finished_at = now()
            session.flush()
            return {**public_result(job), 'budget': budget(session)}
