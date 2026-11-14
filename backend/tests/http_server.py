"""Isolated HTTP browser-test server for the empty authoring workspace."""
from pathlib import Path
import tempfile
import uvicorn

from backend.app.api import create_app
from backend.app.cli import migrate
from backend.app.settings import ROOT, Settings

runtime = ROOT / 'runtime'
runtime.mkdir(exist_ok=True)
directory = Path(tempfile.mkdtemp(prefix='http-e2e-', dir=runtime))
settings = Settings(f'sqlite:///{directory / "experiment.sqlite3"}', directory / 'artifacts', 'integration-secret-' * 4, '123456')
migrate(settings.database_url)
uvicorn.run(create_app(settings), host='127.0.0.1', port=8001, access_log=False)
