"""Five experiment and operational tables; no provider runtime yet."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    j = sa.JSON().with_variant(postgresql.JSONB(), 'postgresql')
    op.create_table('participants', sa.Column('participant_id', sa.String(36), primary_key=True), sa.Column('profile', j, nullable=False))
    op.create_table('participant_tasks',
        sa.Column('participant_id', sa.String(36), sa.ForeignKey('participants.participant_id'), primary_key=True),
        sa.Column('test_code_hash', sa.String(64), nullable=False, unique=True), sa.Column('access_version', sa.BigInteger(), nullable=False),
        sa.Column('study_id', sa.Text(), nullable=False), sa.Column('batch_id', sa.Text()), sa.Column('config_ref', sa.String(64), nullable=False),
        sa.Column('condition', sa.String(16), nullable=False), sa.Column('status', sa.String(16), nullable=False),
        *[sa.Column(name, sa.DateTime(timezone=True), nullable=name != 'assigned_at') for name in ['assigned_at','started_at','completed_at','expires_at']],
        sa.CheckConstraint("condition in ('neutral','goal')"), sa.CheckConstraint("status in ('pending','in_progress','completed','cancelled')"))
    op.create_index('ix_participant_tasks_config_ref', 'participant_tasks', ['config_ref'])
    op.create_table('tasks',
        sa.Column('task_id', sa.String(36), primary_key=True), sa.Column('participant_id', sa.String(36), sa.ForeignKey('participant_tasks.participant_id'), nullable=False),
        *[sa.Column(name, sa.Text(), nullable=False) for name in ['task_code','scenario_id','model_ref']],
        sa.Column('target_option_id', sa.String(1), nullable=False), sa.Column('option_order', j, nullable=False),
        sa.Column('status', sa.String(16), nullable=False), sa.Column('started_at', sa.DateTime(timezone=True)), sa.Column('completed_at', sa.DateTime(timezone=True)),
        sa.Column('task_data', j, nullable=False), sa.Column('runtime_state', j, nullable=False), sa.Column('revision', sa.BigInteger(), nullable=False),
        sa.UniqueConstraint('participant_id','task_code'), sa.CheckConstraint("status in ('pending','in_progress','completed','cancelled')"),
        sa.CheckConstraint("target_option_id in ('A','B')"), sa.CheckConstraint('revision >= 0'))
    op.create_index('ix_tasks_participant_id', 'tasks', ['participant_id'])
    op.create_index('uq_participant_active_task','tasks',['participant_id'],unique=True,
                    sqlite_where=sa.text("status = 'in_progress'"),postgresql_where=sa.text("status = 'in_progress'"))
    op.create_table('admin_audit_logs',
        sa.Column('audit_id',sa.String(36),primary_key=True),sa.Column('occurred_at',sa.DateTime(timezone=True),nullable=False),
        *[sa.Column(name,sa.Text(),nullable=False) for name in ['actor_id','action']],
        sa.Column('target_ref',j,nullable=False),sa.Column('change_summary',j,nullable=False),sa.Column('reason',sa.Text()),
        sa.Column('request_id',sa.Text(),nullable=False),sa.Column('outcome',sa.Text(),nullable=False))
    op.create_table('system_jobs',sa.Column('job_id',sa.String(36),primary_key=True),
        sa.Column('kind',sa.Text(),nullable=False),sa.Column('scope_ref',j,nullable=False),sa.Column('actor_id',sa.Text(),nullable=False),
        sa.Column('idempotency_key',sa.Text(),nullable=False,unique=True),sa.Column('status',sa.String(32),nullable=False),
        sa.Column('progress',j,nullable=False),sa.Column('result_ref',sa.Text()),sa.Column('error',j),
        *[sa.Column(name,sa.DateTime(timezone=True),nullable=name != 'created_at') for name in ['created_at','started_at','finished_at','lease_expires_at']])
    op.create_index('ix_system_jobs_status','system_jobs',['status'])


def downgrade():
    for table in ['system_jobs','admin_audit_logs','tasks','participant_tasks','participants']:
        op.drop_table(table)
