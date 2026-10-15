"""Build only participant-visible content; keep originals and old snapshots intact."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from materials import load_bundle


def prepare():
    bundle = load_bundle(ROOT)
    public = ROOT / 'frontend/public/materials'
    assets = public / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    for scenario in bundle['scenarios']:
        scenario.pop('source_file')
        for reference in scenario['references']:
            source = ROOT / reference.pop('path')
            data = source.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            name = f"{reference['document_id']}-{digest}.pdf"
            dest = assets / name
            if not dest.exists():
                dest.write_bytes(data)
            reference['url'] = f'materials/assets/{name}'
            reference['revision'] = digest
    bundle['shared'].pop('source_file')
    # Public entrance copy is separate from code-protected task materials.
    (public / 'instructions.json').write_text(json.dumps({
        'welcome': bundle['shared']['welcome'],
        'revision': bundle['shared']['revision'],
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    serialized = json.dumps(bundle, ensure_ascii=False, sort_keys=True).encode()
    revision = hashlib.sha256(serialized).hexdigest()
    bundle['bundle_revision'] = revision
    snapshot = f'snapshot-{revision}.json'
    (public / snapshot).write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
    (public / 'manifest.json').write_text(json.dumps({'snapshot': snapshot}), encoding='utf-8')
    print(f"Prepared {len(bundle['scenarios'])} scenarios and "
          f"{sum(len(s['references']) for s in bundle['scenarios'])} versioned PDFs.")


if __name__ == '__main__':
    prepare()
