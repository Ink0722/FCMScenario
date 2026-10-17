import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))

from case_content import from_legacy, load_case, load_catalog, read_case, render_markdown, semantic
from cases import synchronize
from content_io import digest, read_yaml, validate, within, write_yaml
from generate_contracts import generate
from materials import load_legacy_case
from prepare_frontend import prepare
from study_content import development_config, load_profile, load_shared_copy, load_study


class PreservationTests(unittest.TestCase):
    def test_every_registered_legacy_pair_preserves_all_content(self):
        count = 0
        for case in load_catalog()['cases']:
            for locale, entry in case['locales'].items():
                if entry['legacy_mode'] != 'verify':
                    continue
                with self.subTest(case=case['case_id']):
                    structured = load_case(case['case_id'], locale=locale)
                    original = load_legacy_case(case['case_id'])
                    self.assertEqual(semantic(structured), semantic(original))
                    data, _, _, _ = read_case(case['case_id'], locale=locale)
                    rendered = render_markdown(data)
                    round_trip = load_legacy_case(case['case_id'], text_override=rendered)
                    self.assertEqual(semantic(round_trip), semantic(original))
                    count += 1
        self.assertEqual(count, sum(entry['legacy_mode'] == 'verify' for case in load_catalog()['cases'] for entry in case['locales'].values()))

    def test_compiler_leaves_all_legacy_files_unchanged_and_exports_no_private_fields(self):
        originals = {p: p.read_bytes() for p in (ROOT / 'cases').rglob('*')
                     if p.is_file() and p.suffix in ('.md', '.pdf', '.tex')}
        bundle = prepare()
        selected = list(dict.fromkeys(task['case_id'] for task in load_study()['tasks']))
        self.assertEqual([scenario['case_id'] for scenario in bundle['scenarios']], selected)
        self.assertEqual(sum(len(s['references']) for s in bundle['scenarios']),
                         sum(len(load_case(case_id)['references']) for case_id in selected))
        validate(bundle, 'runtime.schema.json')
        for scenario in bundle['scenarios']:
            self.assertFalse({'legacy_source', 'source_file', 'goal', 'answer', 'notes'} & set(scenario))
            for reference in scenario['references']:
                self.assertNotIn('path', reference)
                self.assertTrue(reference['url'].startswith('materials/assets/'))
        for path, original in originals.items():
            self.assertEqual(path.read_bytes(), original, str(path))

    def test_generated_contracts_match_the_schema(self):
        generate(check=True)


class ContentFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'cases').mkdir()
        shutil.copytree(ROOT / 'contracts', self.root / 'contracts')
        shutil.copytree(ROOT / 'shared', self.root / 'shared')
        shutil.copytree(ROOT / 'studies', self.root / 'studies')
        shutil.copytree(ROOT / 'cases/01_Fund_Shares', self.root / 'cases/01_Fund_Shares')
        (self.root / 'research/01').mkdir(parents=True)
        shutil.copy2(ROOT / 'research/case_index.json', self.root / 'research/case_index.json')
        shutil.copy2(ROOT / 'research/01/pdf_documents.json', self.root / 'research/01/pdf_documents.json')
        catalog = copy.deepcopy(load_catalog())
        catalog['cases'] = catalog['cases'][:1]
        write_yaml(self.root / 'cases/catalog.yaml', catalog)
        self.yaml_path = self.root / 'cases/01_Fund_Shares/case.zh-CN.yaml'
        self.md_path = self.yaml_path.parent / 'material.md'

    def edit_yaml(self, transform):
        value = read_yaml(self.yaml_path)
        transform(value)
        write_yaml(self.yaml_path, value)

    def edit_md(self, suffix=' Changed for a test.'):
        value = self.md_path.read_text()
        value = value.replace('你正在投资平台上了解基金M', '你正在投资平台上了解基金M' + suffix, 1)
        self.md_path.write_text(value)

    def test_divergence_is_rejected_without_overwriting(self):
        self.edit_yaml(lambda data: data.update(title='Changed title'))
        before = self.md_path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'YAML/Markdown differ'):
            load_case('01', self.root)
        self.assertEqual(before, self.md_path.read_bytes())

    def test_explicit_yaml_sync_round_trips_and_keeps_original_files(self):
        self.edit_yaml(lambda data: data.update(title='Changed title'))
        synchronize('01', 'yaml', self.root)
        self.assertIn('# Changed title', self.md_path.read_text())
        self.assertEqual(load_case('01', self.root)['title'], 'Changed title')
        self.assertTrue(self.md_path.exists())

    def test_explicit_markdown_sync_preserves_markdown_bytes(self):
        self.edit_md()
        before = self.md_path.read_bytes()
        synchronize('01', 'markdown', self.root)
        self.assertEqual(before, self.md_path.read_bytes())
        self.assertIn('Changed for a test', load_case('01', self.root)['background'])

    def test_two_sided_edits_require_deliberate_conflict_resolution(self):
        self.edit_yaml(lambda data: data.update(title='Changed title'))
        self.edit_md()
        before = (self.yaml_path.read_bytes(), self.md_path.read_bytes())
        for source in ('yaml', 'markdown'):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'also changed'):
                synchronize('01', source, self.root)
            self.assertEqual(before, (self.yaml_path.read_bytes(), self.md_path.read_bytes()))

    def test_legacy_unrepresentable_content_fails_before_writing(self):
        self.edit_yaml(lambda data: data['comparison'][0]['values'].update(A='First | second'))
        before = self.md_path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'pipes or newlines'):
            synchronize('01', 'yaml', self.root)
        self.assertEqual(before, self.md_path.read_bytes())

    def test_source_only_changes_still_need_explicit_alignment(self):
        self.md_path.write_text(self.md_path.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'metadata is stale'):
            load_case('01', self.root)
        synchronize('01', 'markdown', self.root)
        load_case('01', self.root)

    def test_private_or_unknown_input_fields_are_rejected(self):
        for field in ('goal', 'answer', 'notes', 'correct_option'):
            data = read_yaml(self.yaml_path)
            data[field] = 'must not enter participant content'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'Additional properties'):
                validate(data, 'case.schema.json', self.root)

    def test_duplicate_ids_and_incomplete_options_are_rejected(self):
        self.edit_yaml(lambda data: data['options'].__setitem__(1, copy.deepcopy(data['options'][0])))
        with self.assertRaisesRegex(ValueError, 'one A and one B'):
            load_case('01', self.root)

    def test_duplicate_yaml_keys_are_rejected(self):
        self.yaml_path.write_text(self.yaml_path.read_text() + '\ntitle: Duplicate\n')
        with self.assertRaisesRegex(ValueError, 'Duplicate YAML key'):
            read_yaml(self.yaml_path)

    def test_document_path_traversal_and_symlinks_are_rejected(self):
        self.edit_yaml(lambda data: data['references'][0].update(file='../../README.md'))
        with self.assertRaisesRegex(ValueError, 'relative paths'):
            load_case('01', self.root)
        outside = self.root / 'outside.pdf'
        outside.write_bytes(b'%PDF- outside')
        (self.yaml_path.parent / 'outside.pdf').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'escapes'):
            within(self.yaml_path.parent, 'outside.pdf')

    def test_no_silent_language_fallback(self):
        with self.assertRaisesRegex(ValueError, 'fallback is disabled'):
            load_case('01', self.root, 'en')

    def test_new_english_case_can_exist_without_a_legacy_markdown_or_research_index_entry(self):
        data = read_yaml(self.yaml_path)
        data.update(case_id='21', scenario_id='S-EXAMPLE-21', locale='en')
        data.pop('legacy_source')
        base = self.root / 'cases/21_Example'
        base.mkdir()
        original_pdf = self.yaml_path.parent / data['references'][0]['file']
        shutil.copy2(original_pdf, base / '21-01.pdf')
        data['references'][0].update(document_id='21-01', file='21-01.pdf')
        write_yaml(base / 'case.en.yaml', data)
        catalog = read_yaml(self.root / 'cases/catalog.yaml')
        catalog['cases'].append({'case_id':'21','folder':'21_Example','scenario_id':'S-EXAMPLE-21',
                                'locales':{'en':{'file':'case.en.yaml','legacy_mode':'none'}}})
        write_yaml(self.root / 'cases/catalog.yaml', catalog)
        self.assertEqual(load_case('21', self.root, 'en')['case_id'], '21')
        self.assertFalse((base / 'material.md').exists())
        study = read_yaml(self.root / 'studies/local-development.yaml')
        study.update(case_locale='en', tasks=[{'id':'task-example','number':'TASK-EXAMPLE','case_id':'21','probe_enabled':False}])
        write_yaml(self.root / 'studies/local-development.yaml', study)
        fixtures = read_yaml(self.root / 'studies/fixtures/local-codes.yaml')
        fixtures['codes'] = {'EXAMPLE-CODE': ['task-example']}
        write_yaml(self.root / 'studies/fixtures/local-codes.yaml', fixtures)
        bundle = prepare(self.root)
        self.assertEqual([case['case_id'] for case in bundle['scenarios']], ['21'])

    def test_fixture_assignments_and_policy_are_validated(self):
        study = read_yaml(self.root / 'studies/local-development.yaml')
        study['tasks'] = [task for task in study['tasks'] if task['case_id'] == '01']
        write_yaml(self.root / 'studies/local-development.yaml', study)
        parsed = load_study(self.root)
        with self.assertRaisesRegex(ValueError, 'Invalid development code'):
            development_config(parsed, self.root)
        study['policy']['probe_after_turns'] = 10
        write_yaml(self.root / 'studies/local-development.yaml', study)
        with self.assertRaisesRegex(ValueError, 'no later'):
            load_study(self.root)

    def test_shared_translation_and_profile_content_are_separate(self):
        study = read_yaml(self.root / 'studies/local-development.yaml')
        profile = load_profile(study, self.root)
        self.assertEqual(profile['scope'], 'participant_code')
        self.assertEqual(profile['questions'][0]['id'], 'preview_reading')
        load_shared_copy(study, self.root)
        source = self.root / 'shared/instructions.md'
        source.write_text(source.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'Shared instructions changed'):
            load_shared_copy(study, self.root)


if __name__ == '__main__':
    unittest.main()
