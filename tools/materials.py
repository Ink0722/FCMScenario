"""Read structured participant cases, checking their retained Markdown pairs.

Authoring sources are YAML and explicitly synchronized legacy Markdown; JSON is
a generated runtime snapshot. See docs/content-maintenance.md for editing.
"""
from pathlib import Path
from urllib.parse import unquote
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent.parent
BLOCKS = ('background', 'common_facts', 'comparison', 'additional_information',
          'references', 'task', 'knowledge', 'options')
SHARED_BLOCKS = ('welcome', 'choice_prompt', 'confidence_prompt', 'confidence_scale',
                 'pre_prompt', 'probe_prompt', 'post_prompt')
VERSION = '1.0'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def metadata(text, kind):
    matches = re.findall(r'^<!-- ' + kind + r'-meta: (.+) -->$', text, re.M)
    require(len(matches) == 1, f'Exactly one {kind}-meta record is required')
    data = json.loads(matches[0])
    require(data.get('schema_version') == VERSION, 'Unsupported material schema_version')
    return data


def blocks(text, required):
    matches = list(re.finditer(r'^<!-- block: ([a-z_]+) -->\s*$', text, re.M))
    names = [m[1] for m in matches]
    require(names == list(required), f'Block order must be {required}; received {names}')
    result = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        value = text[m.end():end].strip()
        # Remove outer numbered section labels from data; retain financial subheadings.
        value = re.sub(r'^## [^\n]+\n?', '', value, flags=re.M).strip()
        if m[1] not in ('knowledge', 'options'):
            value = re.sub(r'^#{2,3} [^\n]+\n?', '', value, count=1).strip()
        result[m[1]] = value
    return result


def paragraphs(text):
    return [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]


def comparison(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    require(len(lines) >= 3, 'Comparison requires a header, separator and at least one row')
    require(lines[0] == '| 属性 | 方案A | 方案B |', 'Comparison columns must be 属性 / 方案A / 方案B')
    require(re.fullmatch(r'\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|', lines[1]),
            'Invalid comparison separator')
    rows = []
    for line in lines[2:]:
        require(line.startswith('|') and line.endswith('|'), 'Unexpected text in comparison block')
        cells = [c.strip() for c in line[1:-1].split('|')]
        require(len(cells) == 3 and all(cells), f'Comparison must contain three nonempty cells: {line}')
        require(cells[1] != cells[2], f'Shared fact must be in common_facts: {cells[0]}')
        rows.append({'attribute': cells[0], 'A': cells[1], 'B': cells[2]})
    require(len({r['attribute'] for r in rows}) == len(rows), 'Duplicate comparison attribute')
    return rows


def additional_information(text):
    if not text:
        return []
    matches = list(re.finditer(r'^<!-- information: ([a-z_]+) -->\s*$', text, re.M))
    require(matches and not text[:matches[0].start()].strip(), 'Each supplement needs an information marker')
    result = []
    for i, m in enumerate(matches):
        require(m[1] in ('terms', 'survey', 'history'), 'Unknown supplement kind')
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section = text[m.end():end].strip()
        heading = re.match(r'^#### ([^\n]+)\n(.*)', section, re.S)
        require(heading and heading[2].strip(), 'Supplement needs a heading and content')
        result.append({'kind': m[1], 'title': heading[1], 'text': heading[2].strip()})
    return result


def knowledge(text):
    matches = list(re.finditer(r'^### ([^\n]+)\n', text, re.M))
    require(matches and not text[:matches[0].start()].strip(), 'Knowledge needs term headings')
    result = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[m.end():end].strip()
        require(content, f'Empty knowledge term: {m[1]}')
        result.append({'title': m[1], 'text': content})
    return result


def load_shared(root=ROOT):
    path = root / 'shared/instructions.md'
    text = path.read_text(encoding='utf-8')
    meta = metadata(text, 'shared')
    require(meta.get('confidence_min') == 0 and meta.get('confidence_max') == 100
            and meta.get('confidence_step') == 1, 'Confidence must use integers 0–100')
    require(meta.get('confidence_default', 'missing') is None, 'Confidence must have no default')
    require(meta.get('choice_required') is True and meta.get('confidence_required') is True,
            'Choice and confidence must both be required')
    copy = blocks(text, SHARED_BLOCKS)
    require(all(copy.values()), 'Shared copy contains an empty block')
    return {**meta, **copy, 'source_file': str(path.relative_to(root)),
            'revision': hashlib.sha256(path.read_bytes()).hexdigest()}


def load_legacy_case(case_id, root=ROOT, text_override=None):
    root = Path(root).resolve()
    index = json.loads((root / 'research/case_index.json').read_text(encoding='utf-8'))
    number = f'{int(case_id):02d}'
    row = next((r for r in index if r['number'] == number), None)
    require(row is not None, f'Unknown case: {number}')
    path = root / 'cases' / row['folder'] / 'material.md'
    text = path.read_text(encoding='utf-8') if text_override is None else text_override
    meta = metadata(text, 'material')
    require(meta.get('case_id') == number and meta.get('scenario_id') == row['scenario_id'],
            'Material identity differs from case_index.json')
    require(meta.get('template') in ('table', 'cards'), 'Template must be table or cards')
    titles = re.findall(r'^# ([^\n]+)$', text, re.M)
    require(len(titles) == 1, 'Material must have exactly one title')
    require('公共信息' not in text and '主要理由' not in text and '- [ ]' not in text,
            'Shared instructions and answer controls must not be embedded in material')
    data = blocks(text, BLOCKS)
    for key in ('background', 'common_facts', 'comparison', 'references', 'task', 'knowledge', 'options'):
        require(data[key], f'Empty required block: {key}')
    options = []
    for line in data['options'].splitlines():
        match = re.fullmatch(r'- ([AB])：([^\n]+)', line)
        require(match is not None, 'Options must use - A：label / - B：label')
        options.append({'id': match[1], 'label': match[2].strip()})
    require([o['id'] for o in options] == ['A', 'B'] and all(o['label'] for o in options),
            'Exactly two options in A/B order are required')
    manifests = json.loads((root / 'research' / number / 'pdf_documents.json').read_text())
    allowed = {d['pdf']: d['document_id'] for d in manifests['documents']}
    references = []
    for line in paragraphs(data['references']):
        match = re.fullmatch(r'\[([^\]]+)\]\(([^)]+)\)', line)
        require(match is not None, 'Reference must be one local PDF Markdown link')
        name = unquote(match[2]); asset = path.parent / name
        require(name in allowed and asset.is_file(), 'Reference must point to a current case PDF')
        references.append({'document_id': allowed[name], 'title': match[1],
                           'path': str(asset.relative_to(root))})
    require(len(references) == len(allowed) and len({r['document_id'] for r in references}) == len(allowed),
            'Every current reference PDF must appear exactly once')
    scenario = {**meta, 'title': titles[0], 'background': data['background'],
                'common_facts': paragraphs(data['common_facts']),
                'comparison': comparison(data['comparison']),
                'additional_information': additional_information(data['additional_information']),
                'references': references, 'task': data['task'],
                'knowledge': knowledge(data['knowledge']), 'options': options}
    scenario['source_file'] = str(path.relative_to(root))
    scenario['revision'] = hashlib.sha256(path.read_bytes() if text_override is None else text.encode('utf-8')).hexdigest()
    return scenario


def load_case(case_id, root=ROOT, locale=None):
    from case_content import load_case as structured_case
    return structured_case(case_id, root, locale)


def load_bundle(root=ROOT, case_id=None, locale=None, case_ids=None):
    from case_content import load_catalog
    root = Path(root).resolve()
    require(case_id is None or case_ids is None, 'Choose case_id or case_ids, not both')
    ids = case_ids if case_ids is not None else [case_id] if case_id is not None else [r['case_id'] for r in load_catalog(root)['cases']]
    return {'schema_version': VERSION, 'shared': load_shared(root),
            'scenarios': [load_case(i, root, locale) for i in ids]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--case', help='Export one case, e.g. 01')
    parser.add_argument('--locale', help='Exact case language; no silent language fallback')
    parser.add_argument('--check', action='store_true', help='Validate without exporting data')
    parser.add_argument('--output', type=Path, help='Derived JSON output; only paths under build/ are accepted')
    args = parser.parse_args()
    bundle = load_bundle(args.root, args.case, args.locale)
    if args.check:
        require(args.output is None, '--check does not write output')
        print(f"{len(bundle['scenarios'])} materials, "
              f"{sum(len(s['references']) for s in bundle['scenarios'])} PDF references verified; "
              'shared instructions and A/B + confidence schema valid.')
    else:
        text = json.dumps(bundle, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            dest = args.output.resolve(); build = args.root.resolve() / 'build'
            require(build in dest.parents, 'Derived output must be under build/; edit the case YAML and sync its retained Markdown')
            dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(text, encoding='utf-8')
            print(dest)
        else:
            print(text, end='')


if __name__ == '__main__':
    # Preserve the existing python3 CLI when a project environment is installed.
    import os, sys
    local = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if local.is_file() and Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        os.execv(str(local), [str(local), *sys.argv])
    main()
