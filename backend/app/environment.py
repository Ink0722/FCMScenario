"""Editable environment metadata and stored model connection settings for researchers."""
from base64 import urlsafe_b64encode
from copy import deepcopy
from hashlib import sha256
import hmac
from importlib.metadata import version
import platform

from cryptography.fernet import Fernet
from sqlalchemy import select, text
from sqlalchemy.engine import make_url

from .db import Job, now
from .service import Service, fail, fingerprint, stamp
from .model_runtime import budget, supported
from .operations import worker_status

CURRENT = 'environment-settings:current'


class EnvironmentSettings:
    def __init__(self, settings):
        self.settings = settings
        key = hmac.new(settings.secret_key.encode(), b'fcm-model-config-encryption-v1', sha256).digest()
        self.cipher = Fernet(urlsafe_b64encode(key))

    @staticmethod
    def record(session):
        return session.scalar(select(Job).where(Job.idempotency_key == CURRENT))

    @staticmethod
    def defaults():
        return {'revision': 0, 'environmentName': '测试环境', 'notes': '', 'updatedAt': None,
                'models': []}

    def private(self, session):
        row = self.record(session)
        saved = deepcopy(row.progress) if row else self.defaults()
        # Preserve the previous single connection when reading older settings.
        if 'models' not in saved:
            old = saved.pop('model', {})
            saved['models'] = ([{'id': 'legacy-model', 'label': old.get('modelName') or '默认模型', **old}]
                               if any(old.get(k) for k in ('baseUrl', 'modelName', 'apiKeyCiphertext')) else [])
        return saved

    @staticmethod
    def public_model(model):
        return {key: model[key] for key in ('id', 'label', 'baseUrl', 'modelName')} | {
            'hasApiKey': bool(model.get('apiKeyCiphertext')),
            'configured': bool(model.get('baseUrl') and model.get('modelName')),
            'probeSupported': supported(model),
            'runtimeReady': False}

    def models(self, session):
        return [self.model_status(session, model) for model in self.private(session)['models']]

    def model_status(self, session, model, runtime=None):
        from .advisor_config import descriptor, digest, verified
        result = self.public_model(model)
        connection_ref = digest({'schema_version': 1, 'kind': 'model_connection', 'connection': model})
        result['runtimeReady'] = bool(supported(model) and model.get('apiKeyCiphertext')
                                      and verified(session, connection_ref, digest(runtime if runtime is not None else descriptor(session))))
        return result

    def freeze_model(self, session, model_id, store):
        if model_id is None:
            return None
        model = next((model for model in self.private(session)['models'] if model['id'] == model_id), None)
        fail(model is not None, 'model_not_found', '所选模型已不存在，请刷新模型列表。', 422)
        fail(model['baseUrl'] and model['modelName'], 'model_incomplete', '请先填写该模型的接口地址和模型名。', 422)
        # Private immutable snapshot retains the credential revision; no key enters preview responses.
        ref = store.freeze({'schema_version': 1, 'kind': 'model_connection', 'connection': model})
        from .advisor_config import descriptor
        runtime = descriptor(session)
        return {**self.model_status(session, model, runtime), 'configRef': ref, 'advisorRuntimeRef': store.freeze(runtime)}

    def read(self, session):
        saved = self.private(session)
        saved['models'] = [self.model_status(session, model) for model in saved['models']]
        url = make_url(self.settings.database_url)
        if url.get_backend_name() == 'sqlite':
            location = url.database or ':memory:'
        else:
            location = (url.host or '本机') + (f':{url.port}' if url.port else '') + '/' + (url.database or '')
        session.execute(select(1))
        return {**saved, 'modelBudget': budget(session), 'runtime': {
            'mode': 'optional-agent', 'apiStatus': 'ready', 'databaseStatus': 'ready',
            'worker': worker_status(session),
            'databaseEngine': url.get_backend_name(), 'databaseLocation': location,
            'artifactDirectory': str(self.settings.artifact_dir.resolve()), 'studyFile': self.settings.study_file,
            'timeZone': 'Asia/Shanghai', 'pythonVersion': platform.python_version(),
            'fastapiVersion': version('fastapi'), 'sqlalchemyVersion': version('SQLAlchemy'),
            'activeModel': '按批次冻结；不选模型使用确定性回复',
            'modelConnectionActive': any(m['runtimeReady'] for m in saved['models']),
        }}

    def save(self, session, request_id, payload):
        if session.bind.dialect.name == 'postgresql':
            session.execute(text('SELECT pg_advisory_xact_lock(713022)'))
        key = f'environment-settings:save:{request_id}'
        prior = session.scalar(select(Job).where(Job.idempotency_key == key))
        digest = fingerprint(payload)
        if prior:
            fail(prior.progress['hash'] == digest, 'idempotency_conflict', '该请求编号已用于不同设置。')
            return self.read(session)
        row = self.record(session)
        previous = self.private(session)
        fail(payload['revision'] == previous['revision'], 'settings_revision_conflict', '设置已在其他页面更新，请重新读取最新配置。')
        known = {model['id']: model for model in previous['models']}
        models = []
        for model in payload['models']:
            stored_key = known.get(model['id'], {}).get('apiKeyCiphertext')
            if model['clearApiKey']:
                stored_key = None
            elif model.get('apiKey'):
                stored_key = self.cipher.encrypt(model['apiKey'].encode()).decode()
            models.append({key: model[key] for key in ('id', 'label', 'baseUrl', 'modelName')} | {'apiKeyCiphertext': stored_key})
        saved = {'revision': previous['revision'] + 1, 'updatedAt': stamp(),
                 'environmentName': payload['environmentName'], 'notes': payload['notes'],
                 'models': models}
        if row:
            row.progress = saved
            row.finished_at = now()
        else:
            session.add(Job(kind='environment_settings', scope_ref={}, actor_id='researcher', idempotency_key=CURRENT,
                            status='succeeded', progress=saved, finished_at=now()))
        session.add(Job(kind='save_environment_settings', scope_ref={}, actor_id='researcher', idempotency_key=key,
                        status='succeeded', progress={'hash': digest, 'revision': saved['revision']}, finished_at=now()))
        # Record changed fields, never API keys, credentials, or a copy of the submitted payload.
        changed = [key for key in ('environmentName', 'notes') if previous[key] != saved[key]]
        if previous['models'] != saved['models']:
            changed.append('models')
        Service.audit(session, 'save_environment_settings', request_id, {}, {'revision': saved['revision'], 'changedFields': changed})
        session.flush()
        return self.read(session)
