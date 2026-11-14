from collections import defaultdict, deque
from datetime import datetime
from typing import Annotated, Literal, Optional
import asyncio
import json
import time
from functools import lru_cache
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from itsdangerous import BadSignature, SignatureExpired
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import select

from .content import ContentStore, load_shared_copy, load_study
from .db import Assignment, Database, Job, Task, now
from .service import Problem, Service, aware, fail
from .settings import PROJECT, Settings
from .admin import AdminAuth, AdminReader
from .environment import EnvironmentSettings
from .model_runtime import ModelProbe
from .model_runtime import history as model_history, reconcile as reconcile_model
from .operations import worker_status
from .batches import batches as read_batches
from .allocation import AllocationService
from .advisor_settings import AdvisorTextUpdate, read as read_advisor_text, save as save_advisor_text

from jsonschema import Draft202012Validator

CONTRACT = json.loads((PROJECT / 'contracts/schemas/runtime.schema.json').read_text())
Draft202012Validator.check_schema(CONTRACT)


@lru_cache(maxsize=32)
def validator(definition):
    return Draft202012Validator({**CONTRACT, '$ref': f'#/$defs/{definition}'})


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_max_length=20000)


class Command(Input):
    requestId: str = Field(min_length=1, max_length=128)


class Exchange(Command):
    code: str = Field(min_length=1, max_length=80)


class AdminLogin(Input):
    password: str = Field(min_length=1, max_length=1024)


class ModelConnection(Input):
    id: str = Field(pattern='^[a-zA-Z0-9_-]{1,64}$')
    label: str = Field(min_length=1, max_length=80)
    baseUrl: str = Field(default='', max_length=2048)
    modelName: str = Field(default='', max_length=128)
    apiKey: Optional[str] = Field(default=None, max_length=8192)
    clearApiKey: bool = False

    @field_validator('baseUrl')
    @classmethod
    def address(cls, value):
        from urllib.parse import urlsplit
        value = value.strip().rstrip('/')
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or any(c.isspace() for c in value):
                raise ValueError('Use an HTTP(S) base URL without credentials, query, or fragment')
            parsed.port  # Validate a malformed port without making any network request.
        return value

    @field_validator('label', 'modelName', 'apiKey')
    @classmethod
    def clean(cls, value):
        if value is not None and any(ord(char) < 32 for char in value):
            raise ValueError('Control characters are not allowed')
        return value.strip() if value is not None else None


class EnvironmentUpdate(Command):
    revision: StrictInt = Field(ge=0)
    environmentName: str = Field(min_length=1, max_length=80)
    notes: str = Field(default='', max_length=4000)
    models: list[ModelConnection] = Field(default_factory=list, max_length=50)

    @field_validator('models')
    @classmethod
    def unique_models(cls, value):
        if len({model.id for model in value}) != len(value) or any(not model.label for model in value):
            raise ValueError('Model IDs must be unique and labels cannot be blank')
        return value

    @field_validator('environmentName')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Environment name cannot be blank')
        return value.strip()


class Preview(Input):
    taskCodes: list[str] = Field(min_length=1, max_length=100)
    maxTurns: StrictInt = Field(default=20, ge=3, le=100)
    modelId: Optional[str] = Field(default=None, pattern='^[a-zA-Z0-9_-]{1,64}$')
    participantCount: StrictInt = Field(default=1, ge=1, le=1000)


class EstimateBudget(Input):
    taskCount: StrictInt = Field(ge=0, le=100000)
    modelId: Optional[str] = Field(default=None, pattern='^[a-zA-Z0-9_-]{1,64}$')


class ProbeModel(Command):
    modelId: str = Field(pattern='^[a-zA-Z0-9_-]{1,64}$')


class ValidateAdvisor(ProbeModel):
    taskCode: str = Field(min_length=1, max_length=128)
    condition: Literal['neutral', 'goal'] = 'neutral'
    targetOptionId: Literal['A', 'B'] = 'A'
    turnCount: StrictInt = Field(default=1, ge=1, le=3)


class ReconcileModel(Command):
    inputTokens: StrictInt = Field(ge=0, le=400000)
    outputTokens: StrictInt = Field(ge=0, le=1536)
    providerReference: str = Field(min_length=6, max_length=256)
    evidence: str = Field(min_length=20, max_length=2000)
    verifiedCompleted: Literal[True]

    @field_validator('providerReference', 'evidence', mode='before')
    @classmethod
    def trim_evidence(cls, value):
        return value.strip() if isinstance(value, str) else value


class Allocation(Input):
    condition: Literal['neutral', 'goal']
    count: StrictInt = Field(ge=1, le=1000)


class CaseQuota(Input):
    caseId: str = Field(pattern='^[0-9]{2}$')
    neutral: StrictInt = Field(ge=0, le=1000)
    goal: StrictInt = Field(ge=0, le=1000)


class QuotaPreview(Command):
    quotas: list[CaseQuota] = Field(min_length=1, max_length=20)
    tasksPerPerson: StrictInt = Field(ge=1, le=20)
    maxTurns: StrictInt = Field(default=20, ge=3, le=100)
    modelId: Optional[str] = Field(default=None, pattern='^[a-zA-Z0-9_-]{1,64}$')
    batchId: Optional[str] = Field(default=None, max_length=128)
    seed: Optional[str] = Field(default=None, pattern='^[a-zA-Z0-9_-]{1,64}$')
    expiresAt: Optional[datetime] = None

    @field_validator('quotas')
    @classmethod
    def unique_cases(cls, value):
        if len({q.caseId for q in value}) != len(value):
            raise ValueError('Cases cannot be repeated')
        return value

    @field_validator('expiresAt')
    @classmethod
    def future_expiry(cls, value):
        if value is not None and (value.tzinfo is None or value <= now()):
            raise ValueError('Expiry must be a future time with explicit timezone')
        return value


class Issue(Command):
    configRef: str = Field(pattern='^[0-9a-f]{64}$')
    groups: list[Allocation] = Field(min_length=1, max_length=2)
    batchId: Optional[str] = Field(default=None, max_length=128)
    expiresAt: Optional[datetime] = None

    @field_validator('groups')
    @classmethod
    def group_counts(cls, value):
        if len({g.condition for g in value}) != len(value) or sum(g.count for g in value) > 1000:
            raise ValueError('Choose each condition once; total must not exceed 1000')
        return value

    @field_validator('expiresAt')
    @classmethod
    def expiry(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError('Expiry must have an explicit timezone')
        return value


class ProfileSubmission(Command):
    answers: dict[str, str]


class Decision(Input):
    choice: Literal['A','B']
    confidence: StrictInt = Field(ge=0, le=100)


class DecisionSubmission(Command):
    stage: Literal['pre','post']
    decision: Decision
    timestamp: str = Field(min_length=1, max_length=64)


class UserMessage(Input):
    id: str = Field(min_length=1, max_length=128)
    role: Literal['user']
    text: str = Field(min_length=1, max_length=12000)
    timestamp: str = Field(min_length=1, max_length=64)

    @field_validator('text')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('A message cannot be blank')
        return value


class Event(Input):
    id: str = Field(min_length=1, max_length=128)
    timestamp: str = Field(min_length=1, max_length=64)
    kind: Literal['stage_view','reference_open','information_toggle','dialogue_end']
    details: dict[str, str | int | float | bool]


def public(definition, value):
    validator(definition).validate(value)
    return value


def create_app(settings=None):
    settings = settings or Settings.from_env()
    database = Database(settings.database_url)
    store = ContentStore(settings.artifact_dir, settings.study_file)
    service = Service(settings, store)
    admin_auth = AdminAuth(settings, database)
    admin_reader = AdminReader(service)
    environment = EnvironmentSettings(settings)
    model_probe = ModelProbe(database, environment, store)
    quota_service = AllocationService(service, environment)
    app = FastAPI(title='FCM Experiment API', version='0.1.0', description='Experiment runtime with optional local-material GPT Advisor and a shared USD 1 ceiling.')
    app.state.database, app.state.service = database, service
    app.state.model_probe = model_probe
    from .advisor import AdvisorRuntime
    from .advisor_config import can_issue
    advisor = AdvisorRuntime(database, service, environment)
    app.state.advisor = advisor
    attempts = defaultdict(deque)

    @app.middleware('http')
    async def request_id(request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers['X-Request-ID'] = request.state.request_id
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(Problem)
    async def problem(request, exc):
        return JSONResponse({'code': exc.code, 'message': exc.message, 'requestId': request.state.request_id}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation(request, exc):
        return JSONResponse({'code': 'invalid_input', 'message': 'Check the request fields and required answers.', 'requestId': request.state.request_id}, status_code=422)

    def token(authorization: Annotated[str, Header()] = ''):
        if not authorization.startswith('Bearer '):
            raise Problem(401, 'credential_required', 'Enter your participant code to continue.')
        return authorization[7:]

    def admin(request: Request):
        admin_auth.authorize(request)

    def with_auth(credential, operation):
        with database.transaction() as session:
            assignment = service.authorize(session, credential)
            return operation(session, assignment)

    @app.get('/api/v1/health')
    def health():
        with database.transaction() as session:
            session.execute(select(1))
            worker = worker_status(session)
        return {'status': 'ok', 'runtimeMode': 'optional-agent',
                'experimentReady': worker['status'] == 'online' and not worker['queueStalled'], 'worker': worker}

    @app.get('/api/v1/instructions')
    def instructions():
        shared = load_shared_copy(load_study(PROJECT, settings.study_file), PROJECT)
        return public('ExperimentInstructions', {'welcome': shared['welcome'], 'revision': shared['revision']})

    @app.post('/api/v1/access/exchange')
    def exchange(body: Exchange, request: Request):
        key = request.client.host if request.client else 'unknown'
        if len(attempts) > 10000:
            attempts.clear()
        values = attempts[key]
        current = time.monotonic()
        while values and current - values[0] > 60:
            values.popleft()
        if len(values) >= 30:
            raise Problem(429, 'rate_limited', 'Wait a minute before trying another participant code.')
        values.append(current)
        with database.transaction() as session:
            return public('AccessGrant', service.exchange(session, body.code))

    @app.get('/api/v1/access')
    @app.post('/api/v1/access/refresh')
    def access(credential=Depends(token)):
        return with_auth(credential, lambda s, a: public('AccessGrant', service.grant(a)))

    @app.get('/api/v1/profile')
    def profile(credential=Depends(token)):
        return with_auth(credential, lambda s, a: public('ParticipantProfile', service.profile(s, a)))

    @app.post('/api/v1/profile', status_code=204)
    def submit_profile(body: ProfileSubmission, credential=Depends(token)):
        with_auth(credential, lambda s, a: service.submit_profile(s, a, body.requestId, body.answers))

    @app.get('/api/v1/tasks')
    def tasks(credential=Depends(token)):
        return with_auth(credential, lambda s, a: [public('TestTask', t) for t in service.tasks(s, a)])

    @app.post('/api/v1/tasks/{task_id}/start')
    def start(task_id: str, body: Command, credential=Depends(token)):
        return with_auth(credential, lambda s, a: public('StartedTask', service.start(s, a, task_id, body.requestId)))

    @app.get('/api/v1/attempts/{attempt_id}')
    def resume(attempt_id: str, credential=Depends(token)):
        return with_auth(credential, lambda s, a: public('StartedTask', service.snapshot(s, a, attempt_id)))

    @app.post('/api/v1/attempts/{attempt_id}/measurements/{stage}')
    def decision(attempt_id: str, stage: str, body: DecisionSubmission, credential=Depends(token)):
        if stage != body.stage:
            raise Problem(422, 'invalid_input', 'Measurement stage does not match the request.')
        return with_auth(credential, lambda s, a: public('DialoguePolicy', service.decision(s, a, attempt_id, body.model_dump())))

    @app.post('/api/v1/attempts/{attempt_id}/turns', status_code=202)
    def submit_turn(attempt_id: str, body: UserMessage, credential=Depends(token)):
        return with_auth(credential, lambda s, a: public('TurnSnapshot', service.submit_turn(s, a, attempt_id, body.model_dump())))

    @app.get('/api/v1/attempts/{attempt_id}/turns/{turn_id}')
    def get_turn(attempt_id: str, turn_id: str, credential=Depends(token)):
        return with_auth(credential, lambda s, a: public('TurnSnapshot', service.get_turn(s, a, attempt_id, turn_id)))

    @app.get('/api/v1/attempts/{attempt_id}/turns/{turn_id}/events')
    def stream(attempt_id: str, turn_id: str, credential=Depends(token), last_event_id: Annotated[Optional[str], Header()] = None):
        get_turn(attempt_id, turn_id, credential)

        async def events():
            # Public snapshots are restart-safe; no promise of exact token replay.
            last = None
            started = time.monotonic()
            while True:
                try:
                    current = await asyncio.to_thread(get_turn, attempt_id, turn_id, credential)
                except Problem as exc:
                    yield f'event: access.error\ndata: {json.dumps({"code": exc.code, "message": exc.message})}\n\n'
                    return
                if current['revision'] != last:
                    yield f'id: {current["revision"]}\nevent: turn.snapshot\ndata: {json.dumps(current)}\n\n'
                    last = current['revision']
                if current['status'] in ('completed','interrupted','cancelled') or time.monotonic() - started > 25:
                    return
                yield ': heartbeat\n\n'
                await asyncio.sleep(0.25)
        return StreamingResponse(events(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    @app.post('/api/v1/attempts/{attempt_id}/end-dialogue', status_code=204)
    def end(attempt_id: str, body: Command, credential=Depends(token)):
        with_auth(credential, lambda s, a: service.end(s, a, attempt_id, body.requestId))

    @app.post('/api/v1/attempts/{attempt_id}/complete')
    def complete(attempt_id: str, body: Command, credential=Depends(token)):
        return with_auth(credential, lambda s, a: service.complete(s, a, attempt_id, body.requestId))

    @app.post('/api/v1/attempts/{attempt_id}/abandon', status_code=204)
    def abandon(attempt_id: str, body: Command, credential=Depends(token)):
        with_auth(credential, lambda s, a: service.abandon(s, a, attempt_id, body.requestId))

    @app.post('/api/v1/attempts/{attempt_id}/events', status_code=204)
    def record_event(attempt_id: str, body: Event, credential=Depends(token)):
        with_auth(credential, lambda s, a: service.record_event(s, a, attempt_id, body.model_dump()))

    @app.get('/api/v1/attempts/{attempt_id}/documents/{document_id}')
    def document(attempt_id: str, document_id: str, ticket: str):
        try:
            payload = service.document_signer.loads(ticket, max_age=300)
        except (BadSignature, SignatureExpired):
            raise Problem(401, 'document_expired', 'Reload the task to refresh document access.')
        if payload.get('attempt_id') != attempt_id or payload.get('document_id') != document_id:
            raise Problem(403, 'document_denied', 'Document access does not match this task.')
        with database.transaction() as session:
            assignment = session.get(Assignment, payload.get('participant_id'))
            service.valid_assignment(assignment)
            if assignment.access_version != payload.get('access_version'):
                raise Problem(401, 'credential_revoked', 'Document access was replaced.')
            task, attempt = service.attempt(session, assignment, attempt_id)
            config = service.config(assignment)
            scenario = store.scenario(config, task)
            if document_id not in {r['document_id'] for r in scenario['references']}:
                raise Problem(404, 'not_found', 'Document not found.')
            ref = config['documents'][document_id]
        path = settings.artifact_dir / f'{ref}.pdf'
        from hashlib import sha256
        if sha256(path.read_bytes()).hexdigest() != ref:
            raise Problem(503, 'artifact_invalid', 'This document failed its integrity check.')
        return FileResponse(path, media_type='application/pdf', filename=f'{document_id}.pdf', content_disposition_type='inline')

    @app.post('/api/v1/admin/login')
    def admin_login(body: AdminLogin, request: Request, response: Response):
        key = 'admin:' + (request.client.host if request.client else 'unknown')
        values = attempts[key]
        current = time.monotonic()
        while values and current - values[0] > 60:
            values.popleft()
        if len(values) >= 10:
            raise Problem(429, 'rate_limited', '登录尝试过于频繁，请一分钟后重试。')
        try:
            result = admin_auth.login(request, response, body.password)
        except Problem as exc:
            if exc.status == 401:
                values.append(current)
            raise
        values.clear()
        return result

    @app.get('/api/v1/admin/session')
    def admin_session(request: Request):
        payload = admin_auth.payload(request)
        return {'actor': 'researcher', 'expiresAt': payload['expiresAt'], 'csrfToken': payload['csrf']}

    @app.post('/api/v1/admin/logout', status_code=204, dependencies=[Depends(admin)])
    def admin_logout(request: Request, response: Response):
        admin_auth.logout(request, response)

    @app.get('/api/v1/admin/catalog', dependencies=[Depends(admin)])
    def catalog():
        with database.transaction() as session:
            return {**admin_reader.catalog(), 'models': environment.models(session)}

    @app.get('/api/v1/admin/settings', dependencies=[Depends(admin)])
    def environment_settings():
        with database.transaction() as session:
            return environment.read(session)

    @app.post('/api/v1/admin/settings', dependencies=[Depends(admin)])
    def save_environment_settings(body: EnvironmentUpdate):
        if any(model.clearApiKey and model.apiKey for model in body.models):
            raise Problem(422, 'invalid_input', '替换 API Key 与删除 API Key 不能同时进行。')
        with database.transaction() as session:
            return environment.save(session, body.requestId, body.model_dump(exclude={'requestId'}))

    @app.get('/api/v1/admin/advisor-prompts', dependencies=[Depends(admin)])
    def advisor_prompts():
        with database.transaction() as session:
            return read_advisor_text(session)

    @app.post('/api/v1/admin/advisor-prompts', dependencies=[Depends(admin)])
    def update_advisor_prompts(body: AdvisorTextUpdate):
        with database.transaction() as session:
            return save_advisor_text(session, body.requestId, body.model_dump(exclude={'requestId'}))

    @app.post('/api/v1/admin/models/probe', dependencies=[Depends(admin)])
    def probe_model(body: ProbeModel):
        return model_probe.run(body.modelId, body.requestId)

    @app.post('/api/v1/admin/models/validate-advisor', dependencies=[Depends(admin)])
    def validate_advisor(body: ValidateAdvisor):
        try:
            return advisor.validation(body.modelId, body.requestId, body.taskCode, body.condition, body.targetOptionId, body.turnCount)
        except ValueError:
            raise Problem(422, 'invalid_validation_case', '请选择有效的验收任务。')

    @app.get('/api/v1/admin/models/advisor-validations/{job_id}', dependencies=[Depends(admin)])
    def advisor_validation(job_id: str):
        with database.transaction() as session:
            row = session.get(Job, job_id)
            fail(row is not None and row.kind == 'advisor_validation', 'not_found', '验证记录不存在。', 404)
            return advisor.validation_result(session, row)

    @app.get('/api/v1/admin/models/probes', dependencies=[Depends(admin)])
    def model_probe_history(page: int = Query(default=1, ge=1), pageSize: int = Query(default=20, ge=1, le=100)):
        with database.transaction() as session:
            return model_history(session, page, pageSize)

    @app.post('/api/v1/admin/model-budget/estimate', dependencies=[Depends(admin)])
    def estimate_budget(body: EstimateBudget):
        from .model_runtime import estimate
        with database.transaction() as session:
            return estimate(session, {'runtime_mode': 'agent' if body.modelId else 'deterministic', 'policy': {'minimum': 3}}, body.taskCount)

    @app.post('/api/v1/admin/models/probes/{job_id}/reconcile', dependencies=[Depends(admin)])
    def reconcile_probe(job_id: str, body: ReconcileModel):
        with database.transaction() as session:
            return reconcile_model(session, job_id, body.requestId, body.model_dump(exclude={'requestId'}))

    @app.get('/api/v1/admin/batches', dependencies=[Depends(admin)])
    def batch_summaries(page: int = Query(default=1, ge=1), pageSize: int = Query(default=20, ge=1, le=100),
                        q: Optional[str] = Query(default=None, max_length=128)):
        with database.transaction() as session:
            return read_batches(session, store, page, pageSize, q)

    @app.post('/api/v1/admin/allocation-plans', dependencies=[Depends(admin)])
    def create_quota_plan(body: QuotaPreview):
        with database.transaction() as session:
            payload = body.model_dump(exclude={'requestId'})
            payload['expiresAt'] = body.expiresAt.isoformat() if body.expiresAt else None
            return quota_service.create(session, body.requestId, payload)

    @app.get('/api/v1/admin/allocation-plans', dependencies=[Depends(admin)])
    def quota_plans(page: int = Query(default=1, ge=1), pageSize: int = Query(default=20, ge=1, le=100), archived: bool = False):
        with database.transaction() as session:
            return quota_service.list(session, page, pageSize, archived)

    @app.get('/api/v1/admin/allocation-plans/{plan_ref}', dependencies=[Depends(admin)])
    def quota_plan(plan_ref: str):
        with database.transaction() as session:
            return quota_service.read(session, plan_ref)

    @app.post('/api/v1/admin/allocation-plans/{plan_ref}/issue', dependencies=[Depends(admin)])
    def issue_quota_plan(plan_ref: str, body: Command):
        with database.transaction() as session:
            return quota_service.issue(session, plan_ref, body.requestId)

    @app.post('/api/v1/admin/allocation-plans/{plan_ref}/{action}', dependencies=[Depends(admin)])
    def manage_quota_plan(plan_ref: str, action: Literal['archive', 'restore', 'delete'], body: Command):
        with database.transaction() as session:
            return quota_service.manage(session, plan_ref, body.requestId, action)

    @app.get('/api/v1/admin/allocation-plans/{plan_ref}/export', dependencies=[Depends(admin)])
    def export_quota_plan(plan_ref: str):
        with database.transaction() as session:
            content = quota_service.export(session, plan_ref)
        return Response(content, media_type='text/csv; charset=utf-8', headers={
            'Content-Disposition': 'attachment; filename="fcm-quota-plan.csv"'})

    @app.get('/api/v1/admin/overview', dependencies=[Depends(admin)])
    def overview():
        with database.transaction() as session:
            return admin_reader.overview(session)

    @app.get('/api/v1/admin/worker', dependencies=[Depends(admin)])
    def admin_worker():
        with database.transaction() as session:
            return worker_status(session)

    @app.get('/api/v1/admin/participants', dependencies=[Depends(admin)])
    def admin_participants(page: int = Query(default=1, ge=1), pageSize: int = Query(default=20, ge=1, le=100),
                           status: Optional[Literal['pending', 'in_progress', 'completed', 'cancelled', 'expired']] = None,
                           condition: Optional[Literal['neutral', 'goal']] = None,
                           batch: Optional[str] = Query(default=None, max_length=128),
                           q: Optional[str] = Query(default=None, max_length=128),
                           configRef: Optional[str] = Query(default=None, pattern='^[0-9a-f]{64}$'), unnamed: bool = False):
        with database.transaction() as session:
            return admin_reader.participants(session, page, pageSize, status, condition, batch, q, configRef, unnamed)

    @app.get('/api/v1/admin/participants/{participant_id}', dependencies=[Depends(admin)])
    def admin_participant(participant_id: str):
        with database.transaction() as session:
            return admin_reader.participant(session, participant_id)

    @app.get('/api/v1/admin/codes/export', dependencies=[Depends(admin)])
    def export_codes(status: Optional[Literal['pending', 'in_progress', 'completed', 'cancelled', 'expired']] = None,
                     condition: Optional[Literal['neutral', 'goal']] = None,
                     batch: Optional[str] = Query(default=None, max_length=128),
                     q: Optional[str] = Query(default=None, max_length=128),
                     configRef: Optional[str] = Query(default=None, pattern='^[0-9a-f]{64}$'), unnamed: bool = False):
        with database.transaction() as session:
            content = admin_reader.export_codes(session, status, condition, batch, q, configRef, unnamed)
        return Response(content, media_type='text/csv; charset=utf-8', headers={
            'Content-Disposition': 'attachment; filename="fcm-test-codes.csv"'})

    @app.get('/api/v1/admin/tasks/{task_id}', dependencies=[Depends(admin)])
    def admin_task(task_id: str):
        with database.transaction() as session:
            return admin_reader.task(session, task_id)

    @app.get('/api/v1/admin/tasks/{task_id}/documents/{document_id}', dependencies=[Depends(admin)])
    def admin_document(task_id: str, document_id: str):
        with database.transaction(read_only=True) as session:
            task = session.get(Task, task_id)
            fail(task is not None, 'not_found', '任务不存在。', 404)
            config = service.config(session.get(Assignment, task.participant_id))
            scenario = store.scenario(config, task)
            fail(document_id in {r['document_id'] for r in scenario['references']}, 'not_found', '该任务不包含此材料。', 404)
            ref = config['documents'][document_id]
        path = settings.artifact_dir / f'{ref}.pdf'
        from hashlib import sha256
        if not path.is_file() or sha256(path.read_bytes()).hexdigest() != ref:
            raise Problem(503, 'artifact_invalid', '材料完整性检查未通过。')
        return FileResponse(path, media_type='application/pdf', filename=f'{document_id}.pdf', content_disposition_type='inline')

    @app.get('/api/v1/admin/research/export', dependencies=[Depends(admin)])
    def research_export(status: Optional[Literal['pending', 'in_progress', 'completed', 'cancelled', 'expired']] = None,
                        condition: Optional[Literal['neutral', 'goal']] = None,
                        batch: Optional[str] = Query(default=None, max_length=128), q: Optional[str] = Query(default=None, max_length=128),
                        configRef: Optional[str] = Query(default=None, pattern='^[0-9a-f]{64}$'), unnamed: bool = False):
        from .research_export import export_research
        with database.transaction(read_only=True) as session:
            data = export_research(session, admin_reader, {'status': status, 'condition': condition, 'batch': batch,
                                                         'query': q, 'config_ref': configRef, 'unnamed': unnamed})
        return Response(data, media_type='application/zip', headers={'Content-Disposition': 'attachment; filename="fcm-research-data.zip"'})

    @app.post('/api/v1/admin/code-preview', dependencies=[Depends(admin)])
    def preview(body: Preview):
        try:
            with database.transaction() as session:
                model = environment.freeze_model(session, body.modelId, store)
            config = store.preview(body.taskCodes, body.maxTurns, model)
        except ValueError as exc:
            raise Problem(422, 'invalid_configuration', str(exc))
        ref = store.freeze(config)
        from .model_runtime import estimate
        with database.transaction() as session:
            budget_check = estimate(session, config, len(config['tasks']) * body.participantCount)
        return {'configRef': ref, 'runtimeMode': config['runtime_mode'], 'model': model,
                'canIssue': can_issue(config) and budget_check['canIssue'], 'budgetCheck': budget_check,
                'readinessMessage': None if model is None else '请先在设置中完成 Advisor 验证，再创建新预览。' if not can_issue(config)
                    else budget_check['message'] if not budget_check['canIssue'] else '本地材料真实 Advisor 联调；目标仍为开发分配。',
                'tasks': [{'taskCode': t['id'], 'number': t['case_id'].zfill(2), 'caseId': t['case_id']} for t in config['tasks']], 'maxTurns': body.maxTurns}

    @app.post('/api/v1/admin/codes', dependencies=[Depends(admin)])
    def issue(body: Issue):
        try:
            with database.transaction() as session:
                return service.issue(session, body.requestId, body.configRef, batch_id=body.batchId,
                                     expires_at=body.expiresAt, groups=[g.model_dump() for g in body.groups])
        except (ValueError, FileNotFoundError):
            raise Problem(422, 'invalid_configuration', 'Preview a valid configuration before generating codes.')

    @app.post('/api/v1/admin/participants/{participant_id}/rotate', dependencies=[Depends(admin)])
    def rotate(participant_id: str, body: Command):
        with database.transaction() as session:
            return service.rotate(session, participant_id, body.requestId)

    @app.post('/api/v1/admin/participants/{participant_id}/cancel', dependencies=[Depends(admin)])
    def cancel(participant_id: str, body: Command):
        with database.transaction() as session:
            return service.rotate(session, participant_id, body.requestId, cancel=True)

    return app
