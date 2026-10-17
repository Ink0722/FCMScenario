"""Compile checked participant content and local-development fixtures for the UI."""
from pathlib import Path
import hashlib
import json
from content_io import ROOT, validate
from generate_contracts import generate
from materials import load_bundle
from study_content import development_config, load_profile, load_shared_copy, load_study


def write_if_changed(path, value):
    path = Path(path)
    text = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if not path.is_file() or path.read_text() != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')


def prepare(root=ROOT, study_file='studies/local-development.yaml'):
    root = Path(root).resolve()
    generate(root, check=True)
    study = load_study(root, study_file)
    profile = load_profile(study, root)
    shared = load_shared_copy(study, root)
    # Validated pairs must agree before any public artifact is written.
    case_ids = list(dict.fromkeys(task['case_id'] for task in study['tasks']))
    bundle = load_bundle(root, locale=study['case_locale'], case_ids=case_ids)
    bundle['shared'] = shared
    config = development_config(study, root)
    public = root / 'frontend/public/materials'
    assets = public / 'assets'
    pending_assets = []
    for scenario in bundle['scenarios']:
        scenario.pop('source_file')
        for reference in scenario['references']:
            source = root / reference.pop('path')
            data = source.read_bytes()
            checksum = hashlib.sha256(data).hexdigest()
            name = f'{reference["document_id"]}-{checksum}.pdf'
            pending_assets.append((assets / name, data))
            reference['url'] = f'materials/assets/{name}'
            reference['revision'] = checksum
    serialized = json.dumps(bundle, ensure_ascii=False, sort_keys=True).encode()
    revision = hashlib.sha256(serialized).hexdigest()
    bundle['bundle_revision'] = revision
    validate(bundle, 'runtime.schema.json', root)
    snapshot = f'snapshot-{revision}.json'
    for path, data in pending_assets:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(data)
    write_if_changed(public / 'instructions.json', {'welcome': shared['welcome'], 'revision': shared['revision']})
    write_if_changed(public / snapshot, bundle)
    write_if_changed(public / 'manifest.json', {'snapshot': snapshot})
    generated = root / 'frontend/src/generated'
    write_if_changed(generated / 'study.json', config)
    write_if_changed(generated / 'profile.json', profile)
    print(f'Prepared {len(bundle["scenarios"])} verified cases and {len(pending_assets)} PDFs; '
          'legacy content retained; study/profile configuration compiled.')
    return bundle


if __name__ == '__main__':
    import argparse, os
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study', default=os.environ.get('FCM_STUDY_FILE', 'studies/local-development.yaml'))
    args = parser.parse_args()
    prepare(study_file=args.study)
