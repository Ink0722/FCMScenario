"""Explicit case synchronization; normal builds never overwrite authoring files."""
from pathlib import Path
import argparse
import copy
import hashlib
import sys
from case_content import (FIELDS, ROOT, from_legacy, load_case, load_catalog, locate,
                          read_case, render_markdown, semantic, to_scenario)
from content_io import digest, validate, write_yaml
from materials import load_legacy_case


def synchronize(case_id, source, root=ROOT, locale=None, force=False):
    data, scenario, entry, path = read_case(case_id, root, locale)
    if entry['legacy_mode'] != 'verify':
        raise ValueError('This locale has no legacy pair to synchronize')
    original = load_legacy_case(case_id, root)
    alignment = data.get('legacy_source')
    if not alignment:
        raise ValueError('Missing last-aligned legacy metadata')
    if source == 'markdown':
        if digest(semantic(scenario)) != alignment['payload_sha256'] and not force:
            raise ValueError('YAML also changed since the last alignment. Review both files; '
                             '--force explicitly discards the YAML changes.')
        updated = from_legacy(original, path.parent, root, locale=data['locale'])
        # Reordering unchanged rows should not change their stable IDs.
        for section, key in [('comparison', 'attribute'), ('knowledge', 'title'), ('additional_information', 'title')]:
            from collections import defaultdict, deque
            old_ids = defaultdict(deque)
            for row in data[section]:
                old_ids[row[key]].append(row['id'])
            used = {row['id'] for row in data[section]}
            for row in updated[section]:
                if old_ids[row[key]]:
                    row['id'] = old_ids[row[key]].popleft()
                else:
                    prefix = section.replace('_', '-')
                    n = 1
                    while f'{prefix}-{n:02d}' in used:
                        n += 1
                    row['id'] = f'{prefix}-{n:02d}'
                    used.add(row['id'])
        validate(updated, 'case.schema.json', root)
        to_scenario(updated, path.parent, root)
        write_yaml(path, updated)
    else:
        if original['revision'] != alignment['sha256'] and not force:
            raise ValueError('Markdown also changed since the last alignment. Review both files; '
                             '--force explicitly discards the Markdown changes.')
        rendered = render_markdown(data)
        reparsed = load_legacy_case(case_id, root, text_override=rendered)
        if semantic(reparsed) != semantic(scenario):
            changed = [key for key in FIELDS if reparsed[key] != scenario[key]]
            raise ValueError(f'Legacy round-trip would change {changed}; no files were written')
        updated = copy.deepcopy(data)
        updated['legacy_source'] = {'file': 'material.md', 'sha256': hashlib.sha256(rendered.encode()).hexdigest(),
                                    'payload_sha256': digest(semantic(reparsed))}
        validate(updated, 'case.schema.json', root)
        legacy_path = path.parent / 'material.md'
        before = legacy_path.read_bytes()
        try:
            legacy_path.write_bytes(rendered.encode('utf-8'))
            write_yaml(path, updated)
        except Exception:
            legacy_path.write_bytes(before)
            raise
    load_case(case_id, root, data['locale'])
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    check = commands.add_parser('check', help='Check every registered locale and retained Markdown pair')
    check.add_argument('--case')
    sync = commands.add_parser('sync', help='Explicitly choose which edited format to keep')
    sync.add_argument('--case', required=True)
    sync.add_argument('--locale')
    sync.add_argument('--from', dest='source', required=True, choices=['yaml', 'markdown'])
    sync.add_argument('--force', action='store_true', help='Explicitly overwrite conflicting edits after review')
    export = commands.add_parser('export', help='Print the normalized input a frontend or backend can consume')
    export.add_argument('--case', required=True)
    export.add_argument('--locale')
    args = parser.parse_args()
    if args.command == 'sync':
        print('Aligned:', synchronize(args.case, args.source, locale=args.locale, force=args.force))
    elif args.command == 'export':
        import json
        print(json.dumps(load_case(args.case, locale=args.locale), ensure_ascii=False, indent=2))
    else:
        count = 0
        for item in load_catalog()['cases']:
            if args.case and item['case_id'] != str(int(args.case)).zfill(2):
                continue
            for locale in item['locales']:
                load_case(item['case_id'], locale=locale)
                count += 1
        if not count:
            raise ValueError('No case matched')
        print(f'{count} structured locales checked; retained Markdown pairs agree.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(f'Content error: {error}', file=sys.stderr)
        sys.exit(1)
