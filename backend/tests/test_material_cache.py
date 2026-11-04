from unittest.mock import patch
import pytest
from backend.app.content import ContentStore
from backend.app.material_audit import audit
from backend.app.citations import resolve_citations
from backend.app.advisor_config import descriptor
from backend.app.advisor import make_instructions
from backend.tests.test_experiment import runtime


def test_cached_pdf_layout_preserves_fee_row_and_is_verified_across_instances(runtime):
    store = runtime[0].state.service.store
    config = store.preview(['task-7k3m'])
    ref = config['documents']['01-01']
    parsed = store.material_text(ref)
    fee_lines = [line for line in parsed['pages'][0]['text'].splitlines() if '5.25%' in line]
    assert fee_lines and '无' in fee_lines[0]
    other = ContentStore(store.directory, store.study_file)
    with patch('backend.app.content.PdfReader', side_effect=AssertionError('Should use the persisted parsed artifact')):
        assert other.material_text(ref) == parsed
    path = store.directory / (ref + '.pdf')
    path.write_bytes(path.read_bytes() + b'changed')
    with pytest.raises(ValueError, match='checksum'):
        other.material_text(ref)


def test_all_cases_have_extractable_public_material_and_condition_scope(runtime):
    store = runtime[0].state.service.store
    result = audit(store)
    assert result['caseCount'] == 20 and result['documentCount'] >= 42
    assert all(item['pages'] > 0 and len(item['emptyPages']) < item['pages'] for item in result['documents'])
    from backend.app.content import load_study
    from backend.app.settings import PROJECT
    config = store.preview([t['id'] for t in load_study(PROJECT, store.study_file)['tasks'] if not t['probe_enabled']])
    for case in config['bundle']['scenarios']:
        task = {'scenario_id': case['scenario_id'], 'option_order': ['B', 'A'], 'target_option_id': 'PRIVATE_TARGET'}
        assert 'PRIVATE_TARGET' not in make_instructions(descriptor(), config, task, 'neutral')
        assert 'PRIVATE_TARGET' in make_instructions(descriptor(), config, task, 'goal')


def test_undelivered_or_cross_case_citations_do_not_get_links(runtime):
    store = runtime[0].state.service.store
    config = store.preview(['task-7k3m'])
    citations, warnings = resolve_citations('See 01-01, p. 1 and 20-01, p. 1.', [], config,
                                          {'scenario_id': config['bundle']['scenarios'][0]['scenario_id']})
    assert not citations and len(warnings) == 2
