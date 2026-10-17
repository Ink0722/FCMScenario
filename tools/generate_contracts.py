"""Generate neutral TypeScript DTOs from the JSON Schema contract."""
from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def ts_type(schema):
    if '$ref' in schema:
        value = schema['$ref']
        if not value.startswith('#/$defs/'):
            raise ValueError('Contract code generation only supports local definition references')
        return value.rsplit('/', 1)[1]
    if 'const' in schema:
        return json.dumps(schema['const'])
    if 'enum' in schema:
        return ' | '.join(json.dumps(value) for value in schema['enum'])
    if 'anyOf' in schema:
        return ' | '.join(ts_type(option) for option in schema['anyOf'])
    kind = schema.get('type')
    if kind == 'array':
        return f'Array<{ts_type(schema["items"])}>'
    if kind == 'object':
        required = schema.get('required', [])
        fields = []
        for key, value in schema.get('properties', {}).items():
            name = key if re.fullmatch(r'[A-Za-z_$][\w$]*', key) else json.dumps(key)
            fields.append(f'{name}{"" if key in required else "?"}: {ts_type(value)}')
        extra = schema.get('additionalProperties', False)
        if isinstance(extra, dict):
            fields.append(f'[key: string]: {ts_type(extra)}')
        return '{ ' + '; '.join(fields) + ' }'
    if kind in ('integer', 'number'):
        return 'number'
    if kind in ('string', 'boolean', 'null'):
        return kind
    raise ValueError(f'Unsupported contract type: {schema}')


def generate(root=ROOT, check=False):
    root = Path(root)
    schema = json.loads((root / 'contracts/schemas/runtime.schema.json').read_text())
    content = '// Generated from contracts/schemas/runtime.schema.json. Do not edit.\n\n'
    content += '\n'.join(f'export type {name} = {ts_type(value)};\n' for name, value in schema['$defs'].items())
    target = root / 'contracts/generated/types.ts'
    if check:
        if not target.is_file() or target.read_text() != content:
            raise ValueError('DTO types are stale: run python3 tools/generate_contracts.py')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    print(generate(check=args.check))
