from dataclasses import dataclass
from pathlib import Path
import json
import os

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent


@dataclass(frozen=True)
class Settings:
    database_url: str
    artifact_dir: Path
    secret_key: str
    admin_token: str
    token_seconds: int = 3600
    study_file: str = 'studies/local-development.yaml'

    @classmethod
    def from_env(cls):
        runtime = ROOT / 'runtime'
        secrets_file = runtime / 'dev-secrets.json'
        secrets = json.loads(secrets_file.read_text()) if secrets_file.is_file() else {}
        secret = os.environ.get('FCM_SECRET_KEY', secrets.get('secret_key', ''))
        admin = os.environ.get('FCM_ADMIN_TOKEN', secrets.get('admin_token', ''))
        if len(secret) < 32 or len(admin) < 6:
            raise RuntimeError('Configure FCM_SECRET_KEY/FCM_ADMIN_TOKEN or run python -m backend.app.cli init.')
        return cls(os.environ.get('FCM_DATABASE_URL', f'sqlite:///{runtime / "development.sqlite3"}'),
                   Path(os.environ.get('FCM_ARTIFACT_DIR', str(runtime / 'artifacts'))),
                   secret, admin, study_file=os.environ.get('FCM_STUDY_FILE', cls.study_file))
