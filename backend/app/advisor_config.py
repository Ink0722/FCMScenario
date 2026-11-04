"""Immutable local-material Advisor protocol; never infer readiness from a key."""
import json
from hashlib import sha256
from sqlalchemy import select
from .db import Job
from .settings import ROOT

TURN_KIND = 'advisor_turn'
VALIDATION_KIND = 'advisor_validation'
CALL_KIND = 'advisor_model_call'


def descriptor():
    return {'protocol': 'advisor-local-pilot-v1',
            'providerAdapter': 'openai-sdk-3.35.1-local-history-v2',
            'toolsVersion': 'local-pdf-read-search-v1',
            'materialExtractor': 'pypdf-6.21.1-layout-v1',
            'tools': json.loads((ROOT / 'config/advisor-tools.json').read_text()),
            'prompt': json.loads((ROOT / 'config/advisor-prompt.json').read_text()),
            'toolbox': json.loads((ROOT / 'config/advisor-toolbox.json').read_text())}


def digest(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def readiness_key(connection_ref, runtime_ref):
    return digest({'connection': connection_ref, 'runtime': runtime_ref})


def verified(session, connection_ref, runtime_ref):
    key = readiness_key(connection_ref, runtime_ref)
    return any(row.status == 'succeeded' and row.progress.get('readinessKey') == key
               for row in session.scalars(select(Job).where(Job.kind == VALIDATION_KIND, Job.status == 'succeeded')))


def can_issue(config):
    return config.get('runtime_mode') == 'deterministic' or (
        config.get('advisor', {}).get('protocol') == 'advisor-local-pilot-v1'
        and bool(config.get('model_selection', {}).get('runtimeReady')))
