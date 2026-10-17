"""Study configuration and shared resources, independent of React or HTTP."""
from pathlib import Path
import hashlib
from case_content import load_catalog
from content_io import ROOT, read_yaml, validate, within


def load_study(root=ROOT, study_file='studies/local-development.yaml'):
    root = Path(root).resolve()
    study = validate(read_yaml(within(root, study_file)), 'study.schema.json', root)
    catalog = load_catalog(root)
    known = {case['case_id']: case for case in catalog['cases']}
    for field in ('id', 'number'):
        values = [task[field] for task in study['tasks']]
        if len(values) != len(set(values)):
            raise ValueError(f'Duplicate study task {field}')
    for task in study['tasks']:
        case = known.get(task['case_id'])
        if case is None or study['case_locale'] not in case['locales']:
            raise ValueError(f'{task["id"]}: unknown case or unavailable locale')
    policy = study['policy']
    if policy['probe_after_turns'] > policy['min_turns_before_end']:
        raise ValueError('A required probe must occur no later than the first permitted end')
    for key, prefix in [('shared_copy', 'shared/copy/'), ('profile', 'shared/questionnaires/')]:
        if not study[key].startswith(prefix):
            raise ValueError(f'{key} must refer to {prefix}')
        within(root, study[key])
    if study.get('development_codes'):
        if not study['development_codes'].startswith('studies/fixtures/'):
            raise ValueError('Development codes must be a studies/fixtures/ resource')
        within(root, study['development_codes'])
    return study


def load_profile(study, root=ROOT):
    data = validate(read_yaml(within(root, study['profile'])), 'questionnaire.schema.json', root)
    ids = [question['id'] for question in data['questions']]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate questionnaire question ID')
    for question in data['questions']:
        values = [option['value'] for option in question['options']]
        if len(values) != len(set(values)):
            raise ValueError(f'Duplicate response value: {question["id"]}')
    return data


def load_shared_copy(study, root=ROOT):
    root = Path(root).resolve()
    path = within(root, study['shared_copy'])
    data = validate(read_yaml(path), 'shared-copy.schema.json', root)
    original = root / 'shared/instructions.md'
    if data['source_revision'] != hashlib.sha256(original.read_bytes()).hexdigest():
        raise ValueError('Shared instructions changed; review the versioned translation in shared/copy/.')
    return {**data, 'revision': hashlib.sha256(path.read_bytes()).hexdigest()}


def development_config(study, root=ROOT, fixture_file=None):
    root = Path(root).resolve()
    fixture_file = fixture_file or study.get('development_codes')
    if not fixture_file:
        raise ValueError('The local Mock compiler requires an explicit development_codes fixture')
    codes = validate(read_yaml(within(root, fixture_file)), 'development-codes.schema.json', root)
    if codes['study_id'] != study['study_id']:
        raise ValueError('Development codes reference another study')
    task_ids = {task['id'] for task in study['tasks']}
    for code, assigned in codes['codes'].items():
        if code != code.strip().upper() or len(assigned) != len(set(assigned)) or not set(assigned) <= task_ids:
            raise ValueError(f'Invalid development code assignment: {code}')
    return {
        'studyId': study['study_id'],
        'tasks': [{'id': task['id'], 'number': task['number'], 'caseId': task['case_id'],
                   'probeEnabled': task['probe_enabled']} for task in study['tasks']],
        'codes': codes['codes'],
        'policy': {'minTurnsBeforeEnd': study['policy']['min_turns_before_end'],
                   'probeAfterTurns': study['policy']['probe_after_turns']},
    }
