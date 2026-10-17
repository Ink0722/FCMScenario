"""Validate all registered case locales, contracts and local study resources."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from case_content import load_case, load_catalog
from content_io import ROOT
from generate_contracts import generate
from study_content import development_config, load_profile, load_shared_copy, load_study


def check(root=ROOT):
    root = Path(root).resolve()
    schemas = list((root / 'contracts/schemas').glob('*.schema.json'))
    for path in schemas:
        Draft202012Validator.check_schema(json.loads(path.read_text()))
    generate(root, check=True)
    locales = 0
    for case in load_catalog(root)['cases']:
        for locale in case['locales']:
            load_case(case['case_id'], root, locale)
            locales += 1
    for path in sorted((root / 'studies').glob('*.yaml')):
        study = load_study(root, str(path.relative_to(root)))
        load_shared_copy(study, root)
        load_profile(study, root)
        if study.get('development_codes'):
            development_config(study, root)
    print(f'{locales} case locales, {len(schemas)} schemas, generated DTOs and shared/study resources verified.')


if __name__ == '__main__':
    check()
