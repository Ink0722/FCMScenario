"""Resolve model citation text only against material pages actually delivered."""
import json
import re


def resolve_citations(text, history, config, task):
    scenario = next(s for s in config['bundle']['scenarios'] if s['scenario_id'] == task['scenario_id'])
    references = {r['document_id']: r for r in scenario['references']}
    evidence = set()
    for item in history:
        if item.get('type') != 'function_call_output':
            continue
        try:
            result = json.loads(item.get('output', ''))
        except (ValueError, TypeError):
            continue
        if not isinstance(result, dict) or result.get('scope') != 'frozen-public-material':
            continue
        document = result.get('document_id')
        if document not in references or result.get('revision') != references[document]['revision']:
            continue
        evidence.update((document, p['page']) for p in result.get('pages', []) if p.get('text', '').strip() and type(p.get('page')) is int)
    found, rejected = {}, []
    # Explicit IDs and page labels; never infer a page from an unrelated number.
    for match in re.finditer(r'(?P<doc>\d{2}-\d{2})\s*[,，:：]?\s*(?:p(?:age)?s?\.?\s*|第\s*)(?P<page>\d{1,4})', text, re.IGNORECASE):
        document, page = match['doc'], int(match['page'])
        if (document, page) not in evidence:
            rejected.append({'documentId': document, 'page': page, 'reason': 'page_not_delivered'})
            continue
        ref = references[document]
        found[document, page] = {'documentId': document, 'page': page, 'revision': ref['revision'],
                                 'title': f'{ref["title"]} · p. {page}', 'url': f'documents/{document}#page={page}'}
    return list(found.values()), rejected
