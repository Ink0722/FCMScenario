from alembic import context
from backend.app.db import Base, Database
from backend.app.settings import Settings

config = context.config
url = config.get_main_option('sqlalchemy.url') or Settings.from_env().database_url
if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    database = Database(url)
    with database.engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
