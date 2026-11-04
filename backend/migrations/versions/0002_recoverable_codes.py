"""Retain researcher-readable codes without changing existing access or research records."""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('participant_tasks', sa.Column('test_code_ciphertext', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('participant_tasks', 'test_code_ciphertext')
