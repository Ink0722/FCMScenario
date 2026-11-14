from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.api import create_app
from backend.app.cli import migrate
from backend.app.settings import Settings


def test_empty_authoring_study_starts_and_reports_no_tasks(tmp_path):
    settings = Settings(
        f"sqlite:///{tmp_path / 'test.sqlite3'}",
        Path(tmp_path / 'artifacts'),
        's' * 48,
        '123456',
    )
    migrate(settings.database_url)
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get('/api/v1/health').json()['status'] == 'ok'
        response = client.get('/api/v1/admin/catalog', headers={'Authorization': 'Bearer 123456'})
        assert response.status_code == 200
        payload = response.json()
        assert payload['tasks'] == []
        assert payload.get('enabledCases', 0) == 0
    app.state.database.engine.dispose()
