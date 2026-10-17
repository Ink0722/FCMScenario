"""Read structured cases and verify the retained legacy representation."""
from pathlib import Path
import hashlib
from content_io import ROOT, digest, read_yaml, validate, within

FIELDS = ('case_id', 'scenario_id', 'title', 'template', 'background', 'common_facts',
          'comparison', 'additional_information', 'references', 'task', 'knowledge', 'options')


def number(value):
    return str(int(value)).zfill(2)


def load_catalog(root=ROOT):
    root = Path(root).resolve()
    catalog = validate(read_yaml(root / 'cases/catalog.yaml'), 'catalog.schema.json', root)
    for key in ('case_id', 'folder', 'scenario_id'):
        values = [item[key] for item in catalog['cases']]
        if len(values) != len(set(values)):
            raise ValueError(f'Duplicate catalog {key}')
    for item in catalog['cases']:
        base = root / 'cases' / item['folder']
        if not base.is_dir() or base.resolve().parent != (root / 'cases').resolve():
            raise ValueError(f'Invalid case folder: {item["folder"]}')
        for entry in item['locales'].values():
            within(base, entry['file'])
    return catalog


def locate(case_id, root=ROOT, locale=None):
    catalog = load_catalog(root)
    case_id = number(case_id)
    item = next((item for item in catalog['cases'] if item['case_id'] == case_id), None)
    if item is None:
        raise ValueError(f'Unknown case: {case_id}')
    locale = locale or catalog['default_locale']
    if locale not in item['locales']:
        raise ValueError(f'{case_id}: no reviewed {locale} case exists; language fallback is disabled')
    entry = item['locales'][locale]
    base = Path(root).resolve() / 'cases' / item['folder']
    return item, locale, entry, base, within(base, entry['file'])


def semantic(scenario):
    return {key: scenario[key] for key in FIELDS}


def to_scenario(data, base, root=ROOT):
    references = []
    seen = set()
    for reference in data['references']:
        path = within(base, reference['file'])
        if path.suffix.lower() != '.pdf' or path.read_bytes()[:5] != b'%PDF-':
            raise ValueError(f'Reference must be a PDF: {reference["file"]}')
        if reference['document_id'] in seen:
            raise ValueError('Duplicate reference document_id')
        seen.add(reference['document_id'])
        references.append({'document_id': reference['document_id'], 'title': reference['title'],
                           'path': str(path.relative_to(Path(root).resolve()))})
    for section in ('comparison', 'additional_information', 'knowledge'):
        ids = [row['id'] for row in data[section]]
        if len(ids) != len(set(ids)):
            raise ValueError(f'Duplicate {section} ID')
    if sorted(option['id'] for option in data['options']) != ['A', 'B']:
        raise ValueError('Exactly one A and one B option are required')
    attributes = [row['attribute'] for row in data['comparison']]
    if len(attributes) != len(set(attributes)):
        raise ValueError('Duplicate comparison attribute')
    return {
        **{key: data[key] for key in ('case_id', 'scenario_id', 'title', 'template', 'background', 'common_facts', 'task', 'options')},
        'comparison': [{'attribute': row['attribute'], **row['values']} for row in data['comparison']],
        'additional_information': [{key: row[key] for key in ('kind', 'title', 'text')} for row in data['additional_information']],
        'references': references,
        'knowledge': [{key: row[key] for key in ('title', 'text')} for row in data['knowledge']],
    }


def read_case(case_id, root=ROOT, locale=None):
    item, locale, entry, base, path = locate(case_id, root, locale)
    data = validate(read_yaml(path), 'case.schema.json', root)
    if data['case_id'] != item['case_id'] or data['scenario_id'] != item['scenario_id'] or data['locale'] != locale:
        raise ValueError(f'Case identity or locale differs from catalog: {path}')
    scenario = to_scenario(data, base, root)
    return data, scenario, entry, path


def load_case(case_id, root=ROOT, locale=None):
    root = Path(root).resolve()
    data, scenario, entry, path = read_case(case_id, root, locale)
    if entry['legacy_mode'] == 'verify':
        from materials import load_legacy_case
        legacy = data.get('legacy_source')
        if not legacy or legacy['file'] != 'material.md':
            raise ValueError(f'{path}: verified cases need legacy_source for material.md')
        original = load_legacy_case(case_id, root)
        if semantic(original) != semantic(scenario):
            changed = [key for key in FIELDS if original[key] != scenario[key]]
            raise ValueError(f'{data["case_id"]}: YAML/Markdown differ in {changed}. '
                             'Use tools/cases.py sync --case ID --from yaml|markdown; no file was overwritten.')
        if original['revision'] != legacy['sha256'] or digest(semantic(original)) != legacy['payload_sha256']:
            raise ValueError(f'{data["case_id"]}: legacy alignment metadata is stale; explicitly sync from markdown.')
    content = {key: value for key, value in data.items() if key != 'legacy_source'}
    assets = {ref['document_id']: hashlib.sha256((root / ref['path']).read_bytes()).hexdigest() for ref in scenario['references']}
    return {**scenario, 'locale': data['locale'], 'source_file': str(path.relative_to(root)),
            'revision': digest({'content': content, 'documents': assets})}


def from_legacy(scenario, base, root=ROOT, locale='zh-CN'):
    base = Path(base).resolve()
    return {
        'schema_version': '2.0', 'case_id': scenario['case_id'], 'scenario_id': scenario['scenario_id'],
        'locale': locale, 'title': scenario['title'], 'template': scenario['template'],
        'background': scenario['background'], 'common_facts': scenario['common_facts'], 'options': scenario['options'],
        'comparison': [{'id': f'attribute-{i + 1:02d}', 'attribute': row['attribute'],
                        'values': {'A': row['A'], 'B': row['B']}} for i, row in enumerate(scenario['comparison'])],
        'additional_information': [{'id': f'information-{i + 1:02d}', **row} for i, row in enumerate(scenario['additional_information'])],
        'references': [{'document_id': ref['document_id'], 'title': ref['title'],
                        'file': str((Path(root) / ref['path']).resolve().relative_to(base))} for ref in scenario['references']],
        'task': scenario['task'],
        'knowledge': [{'id': f'term-{i + 1:02d}', **row} for i, row in enumerate(scenario['knowledge'])],
        'legacy_source': {'file': 'material.md', 'sha256': scenario['revision'],
                          'payload_sha256': digest(semantic(scenario))},
    }


def render_markdown(data):
    # The retained parser cannot express pipes/newlines in comparison cells.
    # Refuse rather than escaping or dropping content and changing meaning.
    for row in data['comparison']:
        if any('|' in value or '\n' in value for value in [row['attribute'], *row['values'].values()]):
            raise ValueError('Legacy Markdown comparison cells cannot contain pipes or newlines')
    if any('\n' in option['label'] for option in data['options']):
        raise ValueError('Legacy option labels cannot contain newlines')
    import json
    meta = {key: data[key] for key in ('case_id', 'scenario_id', 'template')}
    meta = {'schema_version': '1.0', **meta}
    blocks = [f'<!-- material-meta: {json.dumps(meta, ensure_ascii=False, separators=(",", ":"))} -->',
              f'# {data["title"]}', '## 1. 场景信息', '<!-- block: background -->', '### 决策情境', data['background'],
              '<!-- block: common_facts -->', '### 共同条件', '\n\n'.join(data['common_facts']),
              '<!-- block: comparison -->', '### 方案资料', '| 属性 | 方案A | 方案B |\n|---|---|---|\n' + '\n'.join(
                  f'| {row["attribute"]} | {row["values"]["A"]} | {row["values"]["B"]} |' for row in data['comparison']),
              '<!-- block: additional_information -->', '\n\n'.join(
                  f'<!-- information: {row["kind"]} -->\n#### {row["title"]}\n\n{row["text"]}' for row in data['additional_information']),
              '<!-- block: references -->', '### 参考文件', '\n\n'.join(f'[{ref["title"]}]({ref["file"]})' for ref in data['references']),
              '<!-- block: task -->', '### 决策任务', data['task'], '## 2. 背景知识', '<!-- block: knowledge -->',
              '\n\n'.join(f'### {row["title"]}\n\n{row["text"]}' for row in data['knowledge']),
              '## 3. 决策选项', '<!-- block: options -->', '\n'.join(f'- {option["id"]}：{option["label"]}' for option in data['options'])]
    return '\n\n'.join(blocks) + '\n'
