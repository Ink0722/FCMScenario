from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, create_engine, event, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


J = JSON().with_variant(JSONB(), 'postgresql')


class Participant(Base):
    __tablename__ = 'participants'
    participant_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    profile: Mapped[dict] = mapped_column(J, default=dict)


class Assignment(Base):
    __tablename__ = 'participant_tasks'
    participant_id: Mapped[str] = mapped_column(ForeignKey('participants.participant_id'), primary_key=True)
    test_code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    test_code_ciphertext: Mapped[str] = mapped_column(Text, nullable=True)
    access_version: Mapped[int] = mapped_column(BigInteger, default=0)
    study_id: Mapped[str] = mapped_column(Text)
    batch_id: Mapped[str] = mapped_column(Text, nullable=True)
    config_ref: Mapped[str] = mapped_column(String(64), index=True)
    condition: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default='pending')
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        CheckConstraint("condition in ('neutral','goal')"),
        CheckConstraint("status in ('pending','in_progress','completed','cancelled')"),
    )


class Task(Base):
    __tablename__ = 'tasks'
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey('participant_tasks.participant_id'), index=True)
    task_code: Mapped[str] = mapped_column(Text)
    scenario_id: Mapped[str] = mapped_column(Text)
    model_ref: Mapped[str] = mapped_column(Text)
    target_option_id: Mapped[str] = mapped_column(String(1))
    option_order: Mapped[list] = mapped_column(J)
    status: Mapped[str] = mapped_column(String(16), default='pending')
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    task_data: Mapped[dict] = mapped_column(J, default=dict)
    runtime_state: Mapped[dict] = mapped_column(J, default=dict)
    revision: Mapped[int] = mapped_column(BigInteger, default=0)
    __table_args__ = (
        UniqueConstraint('participant_id', 'task_code'),
        CheckConstraint("status in ('pending','in_progress','completed','cancelled')"),
        CheckConstraint("target_option_id in ('A','B')"),
        CheckConstraint('revision >= 0'),
        Index('uq_participant_active_task', 'participant_id', unique=True,
              sqlite_where=text("status = 'in_progress'"), postgresql_where=text("status = 'in_progress'")),
    )


class AuditLog(Base):
    __tablename__ = 'admin_audit_logs'
    audit_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    actor_id: Mapped[str] = mapped_column(Text, default='researcher')
    action: Mapped[str] = mapped_column(Text)
    target_ref: Mapped[dict] = mapped_column(J)
    change_summary: Mapped[dict] = mapped_column(J)
    reason: Mapped[str] = mapped_column(Text, nullable=True)
    request_id: Mapped[str] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text, default='succeeded')


class Job(Base):
    __tablename__ = 'system_jobs'
    job_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(Text)
    scope_ref: Mapped[dict] = mapped_column(J)
    actor_id: Mapped[str] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(String(32), default='queued', index=True)
    progress: Mapped[dict] = mapped_column(J, default=dict)
    result_ref: Mapped[str] = mapped_column(Text, nullable=True)
    error: Mapped[dict] = mapped_column(J, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)


class Database:
    def __init__(self, url):
        self.engine = create_engine(url, connect_args={'check_same_thread': False, 'timeout': 15} if url.startswith('sqlite') else {}, pool_pre_ping=True)
        if self.engine.dialect.name == 'sqlite':
            @event.listens_for(self.engine, 'connect')
            def sqlite_settings(connection, _):
                connection.isolation_level = None
                connection.execute('PRAGMA foreign_keys=ON')
                connection.execute('PRAGMA busy_timeout=15000')

    @contextmanager
    def transaction(self, *, read_only=False):
        with Session(self.engine, expire_on_commit=False) as session:
            try:
                if self.engine.dialect.name == 'sqlite':
                    session.execute(text('BEGIN' if read_only else 'BEGIN IMMEDIATE'))
                elif read_only:
                    session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
                yield session
                session.commit()
            except BaseException:
                session.rollback()
                raise
