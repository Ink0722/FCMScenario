"""Local material extraction audit; makes no model or external API requests."""
import argparse
import json
import re
from pathlib import Path
from .content import ContentStore, load_study
from .settings import PROJECT, Settings


def audit(store):
    study = load_study(PROJECT, store.study_file)
    config = store.preview([task['id'] for task in study['tasks'] if not task['probe_enabled']])
    documents = []
    for case in config['bundle']['scenarios']:
        for ref in case['references']:
            parsed = store.material_text(ref['revision'])
            rows = [line.strip() for page in parsed['pages'] for line in page['text'].splitlines()
                    if len(re.findall(r'\d+(?:[.,]\d+)?\s*%?', line)) >= 2 and len(line) < 350]
            documents.append({'caseId': case['case_id'], 'documentId': ref['document_id'], 'revision': ref['revision'],
                'extractor': parsed['extractor'], 'pages': len(parsed['pages']),
                'emptyPages': [p['page'] for p in parsed['pages'] if not p['textAvailable']],
                'numericRowSamples': rows[:6], 'tableValuesRequireHumanReview': True})
    return {'schemaVersion': 1, 'caseCount': len(config['bundle']['scenarios']), 'documentCount': len(documents),
            'uniquePdfCount': len({d['revision'] for d in documents}), 'documents': documents,
            'notes': ['Local extraction and scope checks only. No OCR or model validation.',
                      'Layout preserves spacing where possible; numeric samples do not establish table correctness.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    settings = Settings.from_env()
    result = audit(ContentStore(settings.artifact_dir, settings.study_file))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('caseCount', 'documentCount', 'uniquePdfCount')}))


if __name__ == '__main__':
    main()
