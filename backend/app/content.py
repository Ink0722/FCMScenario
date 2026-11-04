"""Freeze validated participant content; only private runtime storage holds PDFs."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import os
import sys
import tempfile
from io import BytesIO
from pypdf import PdfReader

from .settings import PROJECT
sys.path.insert(0, str(PROJECT / 'tools'))
from content_io import digest
from materials import load_bundle
from study_content import load_profile, load_shared_copy, load_study


class ContentStore:
    def __init__(self, directory: Path, study_file):
        self.directory = directory
        self.study_file = study_file
        directory.mkdir(parents=True, exist_ok=True)

    def put(self, data: bytes, suffix):
        ref = sha256(data).hexdigest()
        path = self.directory / f'{ref}.{suffix}'
        if not path.exists():
            with tempfile.NamedTemporaryFile(dir=self.directory, delete=False) as file:
                file.write(data)
                temporary = file.name
            os.replace(temporary, path)
        return ref

    def get(self, ref):
        if len(ref) != 64 or any(c not in '0123456789abcdef' for c in ref):
            raise ValueError('Invalid artifact reference')
        data = (self.directory / f'{ref}.json').read_bytes()
        if sha256(data).hexdigest() != ref:
            raise ValueError('Artifact checksum mismatch')
        return json.loads(data)

    def preview(self, task_codes, maximum=20, model=None):
        study = load_study(PROJECT, self.study_file)
        selected = [task for task in study['tasks'] if task['id'] in task_codes]
        if len(selected) != len(task_codes) or not selected or len(set(task_codes)) != len(task_codes):
            raise ValueError('Select a nonempty, unique list of configured tasks')
        if any(task['probe_enabled'] for task in selected):
            raise ValueError('Intermediate measurements are disabled in the HTTP runtime')
        minimum = study['policy']['min_turns_before_end']
        if minimum != 3 or maximum < minimum or maximum > 100:
            raise ValueError('Minimum is 3; maximum must be between 3 and 100')
        case_ids = list(dict.fromkeys(task['case_id'] for task in selected))
        bundle = load_bundle(PROJECT, case_ids=case_ids, locale=study['case_locale'], case_locales=study.get('case_locales'))
        documents = {}
        for scenario in bundle['scenarios']:
            scenario.pop('source_file', None)
            for reference in scenario['references']:
                path = (PROJECT / reference.pop('path')).resolve()
                if PROJECT / 'cases' not in path.parents:
                    raise ValueError('Document escapes cases directory')
                ref = self.put(path.read_bytes(), 'pdf')
                documents[reference['document_id']] = ref
                reference.update(url=f'documents/{reference["document_id"]}', revision=ref)
        profile = load_profile(study, PROJECT)
        bundle['shared'] = load_shared_copy(study, PROJECT)
        payload = {'schema_version': 1, 'runtime_mode': 'deterministic', 'study_id': study['study_id'],
                   'tasks': selected, 'bundle': bundle, 'profile': profile, 'documents': documents,
                   'policy': {'minimum': minimum, 'maximum': maximum},
                   'model_ref': 'deterministic-integration-v1',
                   'target_rule': 'development-only-uniform-not-for-research',
                   'ui_version': '0.7.0', 'ui_locale': 'en'}
        payload['model_selection'] = model
        if model is not None:
            payload['runtime_mode'] = 'agent'
            payload['model_ref'] = f'configured:{model["configRef"]}'
            from .advisor_config import descriptor
            runtime = descriptor()
            payload['advisor'] = {'protocol': runtime['protocol'], 'runtimeRef': self.freeze(runtime),
                                  'scope': 'local-materials-pilot'}
        # No research conclusions or target rules are inferred from author notes.
        return payload

    def freeze(self, payload):
        return self.put(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode(), 'json')

    def material_text(self, ref):
        """Verified derived artifact, shared by reading, searching and local QA."""
        if len(ref) != 64 or any(c not in '0123456789abcdef' for c in ref):
            raise ValueError('Invalid document reference')
        raw = (self.directory / f'{ref}.pdf').read_bytes()
        if sha256(raw).hexdigest() != ref:
            raise ValueError('Document checksum mismatch')
        extractor = 'pypdf-6.21.1-layout-v1'
        pointer = self.directory / f'{ref}.{extractor}.cache'
        try:
            cached = self.get(pointer.read_text().strip())
            if cached.get('revision') == ref and cached.get('extractor') == extractor:
                return cached
        except (OSError, ValueError, KeyError):
            pass
        reader = PdfReader(BytesIO(raw))
        pages = []
        for number, page in enumerate(reader.pages, 1):
            content = page.extract_text(extraction_mode='layout', layout_mode_space_vertically=False) or ''
            if not content.strip():
                content = page.extract_text() or ''
            pages.append({'page': number, 'text': content, 'textAvailable': bool(content.strip()),
                          'textSha256': sha256(content.encode()).hexdigest()})
        result = {'revision': ref, 'extractor': extractor, 'pages': pages, 'ocr': False}
        derived = self.freeze(result)
        with tempfile.NamedTemporaryFile(dir=self.directory, mode='w', delete=False) as file:
            file.write(derived + '\n')
            temporary = file.name
        os.replace(temporary, pointer)
        return result

    @staticmethod
    def instrument(profile):
        return f'{profile["id"]}@{digest(profile)}'

    @staticmethod
    def scenario(config, task):
        return deepcopy(next(item for item in config['bundle']['scenarios'] if item['scenario_id'] == task.scenario_id))
