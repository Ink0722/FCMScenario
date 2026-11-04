"""Research ZIP: stable rows, all attempts, explicit quality flags, no credentials."""
import csv
import io
import json
from copy import deepcopy
from datetime import datetime
from zipfile import ZIP_DEFLATED, ZipFile
from zoneinfo import ZoneInfo

from sqlalchemy import select
from .db import Assignment, Job, Participant, Task
from .service import aware, stamp

BASE = 'participant_id task_id condition case_id batch_id config_ref runtime_mode collection_scope'.split()
ATTEMPT = BASE + ['attempt_id', 'attempt_no']
TURN = ATTEMPT + ['turn_id', 'turn_no']
COLUMNS = {
    'participants': 'participant_id study_id batch_id condition assignment_status profile_status profile_answers profile_instrument_ref config_ref assigned_at_beijing completed_at_beijing'.split(),
    'tasks': BASE + 'task_code task_status sequence model_ref target_option_id target_used option_order target_rule attempt_count completed_at_beijing'.split(),
    'attempts': ATTEMPT + 'attempt_status phase stop_reason completed_turns pre_choice pre_confidence post_choice post_confidence choice_changed confidence_delta analysis_candidate quality_flags started_at_beijing ended_at_beijing'.split(),
    'turns': TURN + 'turn_status strategy_id user_text assistant_text error_code citation_warnings model_call_count settled_usd reserved_usd started_at_beijing finished_at_beijing'.split(),
    'model_calls': TURN + 'call_id stage status model_name provider_request_id provider_response_id input_tokens output_tokens reasoning_tokens cost_or_reservation_usd cost_status elapsed_ms failure_kind reasoning_summary_status reasoning_summary request_ref response_ref'.split(),
    'tool_calls': TURN + 'call_id tool_name status arguments result error started_at_beijing finished_at_beijing'.split(),
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def local_time(value):
    if not value:
        return ''
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
    return aware(parsed).astimezone(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')


def cell(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (dict, list)):
        value = compact(value)
    if isinstance(value, str) and (value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n'))):
        return "'" + value
    return value


def export_research(session, reader, filters):
    tables = {name: [] for name in ('participants', 'tasks', 'attempts', 'turns', 'model_calls', 'tool_calls')}
    configs, counts = {}, {'participants': 0, 'tasks': 0, 'attempts': 0, 'turns': 0}
    assignments = session.scalars(select(Assignment).where(*reader.participant_filters(**filters)).order_by(Assignment.participant_id))
    for assignment in assignments:
        pid = assignment.participant_id
        profile = session.get(Participant, pid).profile
        config = reader.service.config(assignment)
        if assignment.config_ref not in configs:
            selected = config.get('model_selection')
            configs[assignment.config_ref] = {
                'studyId': config['study_id'], 'runtimeMode': config['runtime_mode'], 'targetRule': config['target_rule'],
                'policy': config['policy'], 'scenarios': config['bundle']['scenarios'],
                'profileInstrument': config['profile'],
                'model': {k: selected.get(k) for k in ('id', 'label', 'baseUrl', 'modelName', 'configRef')} if selected else None,
                'advisor': reader.service.store.get(config['advisor']['runtimeRef']) if config.get('advisor') else None}
        counts['participants'] += 1
        tables['participants'].append({'participant_id': pid, 'study_id': assignment.study_id, 'batch_id': assignment.batch_id,
            'condition': assignment.condition, 'assignment_status': reader.assignment_row(assignment, profile, 0, 0)['status'],
            'profile_status': profile.get('submission_status'), 'profile_answers': profile.get('answers'),
            'profile_instrument_ref': profile.get('instrument_ref'), 'config_ref': assignment.config_ref,
            'assigned_at_beijing': local_time(assignment.assigned_at), 'completed_at_beijing': local_time(assignment.completed_at)})
        for task in reader.service.ordered_tasks(session.scalars(select(Task).where(Task.participant_id == pid)), config):
            counts['tasks'] += 1
            base = {'participant_id': pid, 'task_id': task.task_id, 'condition': assignment.condition,
                    'case_id': next(s['case_id'] for s in config['bundle']['scenarios'] if s['scenario_id'] == task.scenario_id),
                    'batch_id': assignment.batch_id, 'config_ref': assignment.config_ref,
                    'runtime_mode': config['runtime_mode'], 'collection_scope': config.get('advisor', {}).get('scope', 'deterministic-development')}
            tables['tasks'].append({**base, 'task_code': task.task_code, 'task_status': task.status,
                'sequence': task.task_data.get('allocation', {}).get('position'), 'model_ref': task.model_ref,
                'target_option_id': task.target_option_id, 'target_used': assignment.condition == 'goal',
                'option_order': task.option_order, 'target_rule': config['target_rule'],
                'attempt_count': len(task.task_data['attempts']), 'completed_at_beijing': local_time(task.completed_at)})
            attempts = deepcopy(task.task_data['attempts'])
            from .model_runtime import hydrate_turn_calls
            hydrate_turn_calls(session, [t for a in attempts for t in a['turns']])
            for attempt in attempts:
                counts['attempts'] += 1
                pre = attempt['measurements']['pre'].get('answers') or {}
                post = attempt['measurements']['post'].get('answers') or {}
                completed = sum(t['status'] == 'completed' for t in attempt['turns'])
                flags = sorted({'interrupted_turn' for t in attempt['turns'] if t['status'] in ('interrupted', 'cancelled')}
                               | {'unverified_citation' for t in attempt['turns'] if t.get('citation_warnings')}
                               | ({'deterministic_runtime'} if config['runtime_mode'] == 'deterministic' else set())
                               | ({'development_target_rule'} if config['target_rule'].startswith('development-') else set()))
                ab = {**base, 'attempt_id': attempt['attempt_id'], 'attempt_no': attempt['attempt_no']}
                tables['attempts'].append({**ab, 'attempt_status': attempt['status'], 'phase': attempt['phase'],
                    'stop_reason': attempt.get('stop_reason'), 'completed_turns': completed,
                    'pre_choice': pre.get('choice'), 'pre_confidence': pre.get('confidence'),
                    'post_choice': post.get('choice'), 'post_confidence': post.get('confidence'),
                    'choice_changed': pre['choice'] != post['choice'] if pre and post else None,
                    'confidence_delta': post['confidence'] - pre['confidence'] if pre and post else None,
                    'analysis_candidate': attempt['status'] == 'completed' and bool(pre and post) and completed >= config['policy']['minimum'],
                    'quality_flags': flags, 'started_at_beijing': local_time(attempt.get('started_at')),
                    'ended_at_beijing': local_time(attempt.get('ended_at'))})
                for turn in attempt['turns']:
                    counts['turns'] += 1
                    tb = {**ab, 'turn_id': turn['turn_id'], 'turn_no': turn['turn_no']}
                    calls = []
                    for saved in turn.get('model_calls', []):
                        ledger = session.get(Job, saved.get('callId'))
                        actual = ledger.progress if ledger and ledger.kind == 'advisor_model_call' else saved
                        usage = actual.get('usage') or {}
                        charge = actual.get('chargeNano')
                        calls.append({'cost': charge / 1e9 if charge is not None else saved.get('costUsd', saved.get('reservedUsd', 0)),
                                      'confirmed': bool(actual.get('usage'))})
                        tables['model_calls'].append({**tb, 'call_id': saved.get('callId'), 'stage': saved.get('stage'),
                            'status': ledger.status if ledger else saved.get('status'), 'model_name': saved.get('modelName'),
                            'provider_request_id': actual.get('providerRequestId'), 'provider_response_id': actual.get('providerResponseId'),
                            'input_tokens': usage.get('inputTokens'), 'output_tokens': usage.get('outputTokens'),
                            'reasoning_tokens': usage.get('reasoningTokens'), 'cost_or_reservation_usd': calls[-1]['cost'],
                            'cost_status': 'settled' if calls[-1]['confirmed'] else 'reserved',
                            'elapsed_ms': actual.get('elapsedMs'), 'failure_kind': actual.get('failureKind'),
                            'reasoning_summary_status': saved.get('reasoningSummaryStatus'), 'reasoning_summary': saved.get('reasoningSummary'),
                            'request_ref': actual.get('requestRef'), 'response_ref': actual.get('responseRef')})
                    tables['turns'].append({**tb, 'turn_status': turn['status'],
                        'strategy_id': (turn.get('selected_strategy') or {}).get('strategy_id'),
                        'user_text': '\n'.join(m['text'] for m in turn['messages'] if m['role'] == 'user'),
                        'assistant_text': '\n'.join(m['text'] for m in turn['messages'] if m['role'] == 'assistant'),
                        'error_code': turn.get('execution', {}).get('error_code'), 'citation_warnings': turn.get('citation_warnings', []),
                        'model_call_count': len(calls), 'settled_usd': sum(c['cost'] for c in calls if c['confirmed']),
                        'reserved_usd': sum(c['cost'] for c in calls if not c['confirmed']),
                        'started_at_beijing': local_time(turn.get('started_at')), 'finished_at_beijing': local_time(turn.get('finished_at'))})
                    for tool in turn.get('tool_calls', []):
                        tables['tool_calls'].append({**tb, 'call_id': tool.get('callId'), 'tool_name': tool.get('name'),
                            'status': tool.get('status'), 'arguments': tool.get('arguments'), 'result': tool.get('result'),
                            'error': tool.get('error'), 'started_at_beijing': local_time(tool.get('startedAt')),
                            'finished_at_beijing': local_time(tool.get('finishedAt'))})
    output = io.BytesIO()
    # Even an empty selection has stable headers, suitable for scripted imports.
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for name, rows in tables.items():
            text = io.StringIO(newline='')
            fields = COLUMNS[name]
            writer = csv.writer(text)
            writer.writerow(fields)
            writer.writerows([cell(row.get(field)) for field in fields] for row in rows)
            archive.writestr(name + '.csv', '\ufeff' + text.getvalue())
        archive.writestr('configs.json', json.dumps(configs, ensure_ascii=False, indent=2))
        archive.writestr('manifest.json', json.dumps({'schemaVersion': 1, 'createdAt': stamp(), 'timeZone': 'Asia/Shanghai',
            'counts': counts, 'filters': {k: v for k, v in filters.items() if k != 'query'} | {'queryProvided': bool(filters.get('query'))},
            'notes': ['All saved attempts are included; no automatic deduplication or exclusion.',
                      'analysis_candidate checks workflow completeness only, not scientific validity. Review runtime_mode, collection_scope and quality_flags before analysis.',
                      'Neutral target_option_id is a comparator only; target_used=false.',
                      'Costs include stored reservations separately; model_calls reads the authoritative billing ledger.',
                      'No login codes, API keys, authorization tokens or encrypted connection artifacts are exported.']}, ensure_ascii=False, indent=2))
    return output.getvalue()
