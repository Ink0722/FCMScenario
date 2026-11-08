"""Researcher-editable Advisor text; executable schemas and budgets stay in code."""
from copy import deepcopy
import json

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator
from sqlalchemy import select, text

from .advisor_config import SETTINGS_CURRENT, descriptor, digest
from .db import Job, now
from .service import Service, fail, fingerprint, stamp

PROMPT_FIELDS = ('instructions', 'neutral', 'goal', 'prepare', 'reply', 'opening', 'resource_policy')
TOOL_NAMES = ['read_material', 'search_material', 'select_strategy']


class TextInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_max_length=20000)


class PromptText(TextInput):
    instructions: str = Field(min_length=1)
    neutral: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    prepare: str = Field(min_length=1)
    reply: str = Field(min_length=1)
    opening: str = Field(min_length=1)
    resource_policy: str = Field(min_length=1)

    @field_validator('*')
    @classmethod
    def meaningful(cls, value):
        if not value.strip():
            raise ValueError('Prompt text must not be blank')
        return value

    @field_validator('goal')
    @classmethod
    def target_placeholder(cls, value):
        if '{target}' not in value:
            raise ValueError('Goal must retain the {target} placeholder')
        return value


class StrategyText(TextInput):
    id: str = Field(pattern=r'^S(?:0[0-9]|1[0-4])$')
    name: str = Field(min_length=1, max_length=200)
    definition: str = Field(min_length=1, max_length=8000)
    boundary: str = Field(default='', max_length=8000)
    execution_prompt: str = Field(default='', max_length=8000)

    @field_validator('name', 'definition')
    @classmethod
    def meaningful(cls, value):
        if not value.strip():
            raise ValueError('Strategy text must not be blank')
        return value


class ToolText(TextInput):
    name: str = Field(pattern=r'^(read_material|search_material|select_strategy)$')
    description: str = Field(min_length=1, max_length=4000)

    @field_validator('description')
    @classmethod
    def meaningful(cls, value):
        if not value.strip():
            raise ValueError('Tool description must not be blank')
        return value


class AdvisorText(TextInput):
    prompt: PromptText
    strategies: list[StrategyText] = Field(min_length=1, max_length=50)
    tools: list[ToolText] = Field(min_length=3, max_length=3)

    @model_validator(mode='after')
    def fixed_catalogues(self):
        strategy_ids = sorted(item['id'] for item in descriptor()['toolbox']['strategies'])
        if sorted(item.id for item in self.strategies) != strategy_ids:
            raise ValueError('Keep exactly the current catalogue IDs, without duplicates')
        if sorted(item.name for item in self.tools) != sorted(TOOL_NAMES):
            raise ValueError('Keep exactly the three supported tools, without duplicates')
        if len(json.dumps(self.model_dump(), ensure_ascii=False)) > 100000:
            raise ValueError('Combined Advisor text exceeds 100000 characters')
        return self


class AdvisorTextUpdate(TextInput):
    requestId: str = Field(min_length=1, max_length=128)
    revision: StrictInt = Field(ge=0)
    config: AdvisorText


def editable(runtime):
    return {'prompt': {key: runtime['prompt'][key] for key in PROMPT_FIELDS},
            'strategies': deepcopy(runtime['toolbox']['strategies']),
            'tools': [{key: tool[key] for key in ('name', 'description')} for tool in runtime['tools']]}


def read(session):
    row = session.scalar(select(Job).where(Job.idempotency_key == SETTINGS_CURRENT))
    runtime = descriptor(session)
    return {'revision': row.progress['revision'] if row else 0,
            'updatedAt': row.progress['updatedAt'] if row else None,
            'runtimeRef': digest(runtime), 'config': editable(runtime), 'defaults': editable(descriptor()),
            'toolSchemas': deepcopy(runtime['tools']),
            'runtime': {key: runtime[key] for key in ('protocol', 'providerAdapter', 'materialExtractor')} | {
                'promptVersion': runtime['prompt']['version'], 'toolboxVersion': runtime['toolbox']['version'],
                'maxModelCallsPerTurn': runtime['prompt']['max_model_calls_per_turn'],
                'maxMaterialCallsPerTurn': runtime['prompt']['max_model_calls_per_turn'] - 2,
                'maxOutputTokens': runtime['prompt']['max_output_tokens'],
                'reasoning': deepcopy(runtime['prompt']['reasoning'])}}


def save(session, request_id, payload):
    if session.bind.dialect.name == 'postgresql':
        session.execute(text('SELECT pg_advisory_xact_lock(713026)'))
    key = f'advisor-text:save:{request_id}'
    prior = session.scalar(select(Job).where(Job.idempotency_key == key))
    request_hash = fingerprint(payload)
    if prior:
        fail(prior.progress['hash'] == request_hash, 'idempotency_conflict', '该请求编号已用于不同的提示词配置。')
        return read(session)
    previous = read(session)
    fail(payload['revision'] == previous['revision'], 'advisor_revision_conflict',
         '提示词已在其他页面更新，请先重新读取最新版本。')
    config = deepcopy(payload['config'])
    # Canonical order makes equivalent configurations share one frozen runtime.
    config['strategies'].sort(key=lambda item: item['id'])
    config['tools'].sort(key=lambda item: TOOL_NAMES.index(item['name']))
    revision, updated_at = previous['revision'] + 1, stamp()
    progress = {'revision': revision, 'updatedAt': updated_at, 'config': config}
    row = session.scalar(select(Job).where(Job.idempotency_key == SETTINGS_CURRENT))
    if row:
        row.progress, row.finished_at = progress, now()
    else:
        session.add(Job(kind='advisor_text_settings', scope_ref={}, actor_id='researcher',
                        idempotency_key=SETTINGS_CURRENT, status='succeeded', progress=progress, finished_at=now()))
    changed = [f'prompt.{key}' for key in PROMPT_FIELDS if config['prompt'][key] != previous['config']['prompt'][key]]
    changed += [f'strategy.{item["id"]}' for item, old in zip(config['strategies'], previous['config']['strategies']) if item != old]
    changed += [f'tool.{item["name"]}' for item, old in zip(config['tools'], previous['config']['tools']) if item != old]
    # Retain each saved text revision; no participant data or credentials enter it.
    session.add(Job(kind='save_advisor_text', scope_ref={}, actor_id='researcher', idempotency_key=key,
                    status='succeeded', progress={'hash': request_hash, **progress}, finished_at=now()))
    Service.audit(session, 'save_advisor_text', request_id, {}, {'revision': revision, 'changedFields': changed})
    session.flush()
    return read(session)
