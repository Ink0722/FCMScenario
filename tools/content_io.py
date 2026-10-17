"""Strict, local-only structured content IO. No network schema resolution."""
from pathlib import Path
import hashlib
import json
import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str):
            raise ValueError(f'Mapping keys must be strings at line {key_node.start_mark.line + 1}')
        if key in mapping:
            raise ValueError(f'Duplicate YAML key {key!r} at line {key_node.start_mark.line + 1}')
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def read_yaml(path):
    path = Path(path)
    try:
        data = yaml.load(path.read_text(encoding='utf-8'), Loader=UniqueKeyLoader)
    except (yaml.YAMLError, ValueError) as error:
        raise ValueError(f'{path}: {error}') from error
    return data


def validate(data, schema_name, root=ROOT, definition=None):
    schema = json.loads((Path(root) / 'contracts/schemas' / schema_name).read_text())
    if definition:
        schema = {**schema, '$ref': f'#/$defs/{definition}'}
    Draft202012Validator.check_schema(schema)
    errors = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda error: str(list(error.path)))
    if errors:
        details = '; '.join(f'{".".join(map(str, error.path)) or "root"}: {error.message}' for error in errors[:5])
        raise ValueError(f'{schema_name}: {details}')
    return data


def within(base, relative, must_exist=True):
    base = Path(base).resolve()
    relative = Path(relative)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError(f'Only relative paths within {base} are allowed: {relative}')
    path = (base / relative).resolve()
    if base not in path.parents:
        raise ValueError(f'Path escapes its content directory: {relative}')
    if must_exist and not path.is_file():
        raise ValueError(f'Content file not found: {path}')
    return path


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class ContentDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


def multiline(dumper, value):
    return dumper.represent_scalar('tag:yaml.org,2002:str', value, style='|' if '\n' in value else None)


ContentDumper.add_representer(str, multiline)


def write_yaml(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(yaml.dump(data, Dumper=ContentDumper, allow_unicode=True, sort_keys=False, width=110), encoding='utf-8')
