"""Isolated HTTP browser-test server; all output remains under backend/runtime."""
import json
from pathlib import Path
import tempfile
from uuid import uuid4
import uvicorn

from backend.app.api import create_app
from backend.app.cli import migrate
from backend.app.content import ContentStore
from backend.app.db import Database
from backend.app.service import Service
from backend.app.settings import ROOT, Settings

runtime = ROOT / 'runtime'
runtime.mkdir(exist_ok=True)
directory = Path(tempfile.mkdtemp(prefix='http-e2e-', dir=runtime))
settings = Settings(f'sqlite:///{directory / "experiment.sqlite3"}', directory / 'artifacts', 'integration-secret-' * 4, '123456')
migrate(settings.database_url)
store = ContentStore(settings.artifact_dir, settings.study_file)
database = Database(settings.database_url)
ref = store.freeze(store.preview(['task-7k3m'], maximum=3))
with database.transaction() as session:
    issued = Service(settings, store).issue(session, str(uuid4()), ref, count=3)
(runtime / 'http-e2e-codes.json').write_text(json.dumps(issued))
(runtime / 'http-e2e-runtime.json').write_text(json.dumps({'database_url': settings.database_url, 'artifact_dir': str(settings.artifact_dir)}))
database.engine.dispose()
uvicorn.run(create_app(settings), host='127.0.0.1', port=8001, access_log=False)
