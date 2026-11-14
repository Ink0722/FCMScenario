"""Initialize the local environment and export integration codes."""
import argparse
import json
import os
from pathlib import Path
import secrets
from uuid import uuid4

from alembic import command
from alembic.config import Config

from .content import ContentStore
from .db import Database
from .service import Service
from .settings import ROOT, Settings


def migrate(url):
    config = Config(str(ROOT / 'alembic.ini'))
    config.set_main_option('sqlalchemy.url', url.replace('%', '%%'))
    command.upgrade(config, 'head')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('init')
    sub.add_parser('configure-openai', help='Add the preset GPT connection without a key; preserve all existing settings and usage.')
    issue = sub.add_parser('issue')
    issue.add_argument('--tasks', nargs='+', required=True, help='Task IDs from the active study configuration')
    issue.add_argument('--count', type=int, default=1)
    issue.add_argument('--max-turns', type=int, default=20)
    issue.add_argument('--condition', choices=['neutral', 'goal'], default='neutral')
    issue.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'init':
        runtime = ROOT / 'runtime'
        runtime.mkdir(parents=True, exist_ok=True)
        path = runtime / 'dev-secrets.json'
        if not path.exists():
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as file:
                json.dump({'secret_key': secrets.token_urlsafe(48), 'admin_token': '123456'}, file)
        settings = Settings.from_env()
        migrate(settings.database_url)
        print('Database migrated. Development secrets are in backend/runtime/dev-secrets.json.')
        return
    if args.command == 'configure-openai':
        from .environment import EnvironmentSettings
        from .model_runtime import DEFAULT_MODEL, supported
        settings = Settings.from_env()
        environment = EnvironmentSettings(settings)
        database = Database(settings.database_url)
        with database.transaction() as session:
            saved = environment.private(session)
            existing = next((m for m in saved['models'] if supported(m)), None)
            if existing:
                print('The preset GPT connection already exists; no settings or credentials were changed.')
                return
            if any(m['id'] == DEFAULT_MODEL['id'] for m in saved['models']):
                raise RuntimeError('The preset model ID is already used by another connection.')
            if len(saved['models']) >= 50:
                raise RuntimeError('Remove an unused model before adding the preset (50-model limit).')
            payload = {key: saved[key] for key in ('revision', 'environmentName', 'notes')}
            payload['models'] = [{**{k: m[k] for k in ('id', 'label', 'baseUrl', 'modelName')},
                                  'apiKey': None, 'clearApiKey': False} for m in saved['models']]
            payload['models'].append({**DEFAULT_MODEL, 'apiKey': None, 'clearApiKey': False})
            environment.save(session, str(uuid4()), payload)
        print('GPT-5.4 mini preset saved. Add its API Key in the researcher Settings page. Cumulative application budget: USD 1.')
        return
    if not 1 <= args.count <= 1000:
        parser.error('--count must be between 1 and 1000')
    # Reserve the output first so an existing export cannot be overwritten.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        settings = Settings.from_env()
        store = ContentStore(settings.artifact_dir, settings.study_file)
        config = store.freeze(store.preview(args.tasks, args.max_turns))
        database = Database(settings.database_url)
        with database.transaction() as session:
            result = Service(settings, store).issue(session, str(uuid4()), config, args.count, condition=args.condition)
        json.dump(result, file, ensure_ascii=False, indent=2)
    print(f'Development codes exported to {args.output}; they remain available in the researcher console.')


if __name__ == '__main__':
    main()
