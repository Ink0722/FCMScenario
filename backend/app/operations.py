"""Worker presence and queue visibility, separate from HTTP liveness."""
from datetime import timedelta

from sqlalchemy import select

from .db import Job, now
from .service import aware, stamp

HEARTBEAT_SECONDS = 5
STALE_SECONDS = 30


def heartbeat(database, worker_id, *, processed_at=None, stopped=False):
    with database.transaction() as session:
        key = f'worker-heartbeat:{worker_id}'
        row = session.scalar(select(Job).where(Job.idempotency_key == key).with_for_update())
        if row is None:
            row = Job(kind='worker_heartbeat', scope_ref={}, actor_id='system', idempotency_key=key,
                      status='running', progress={})
            session.add(row)
        row.progress = {**row.progress, 'lastSeenAt': stamp(), **({'lastProcessedAt': stamp(processed_at)} if processed_at else {})}
        row.lease_expires_at = now() if stopped else now() + timedelta(seconds=STALE_SECONDS)
        row.status = 'stopped' if stopped else 'running'
        if stopped:
            row.finished_at = now()


def worker_status(session):
    workers = list(session.scalars(select(Job).where(Job.kind == 'worker_heartbeat')))
    active = [row for row in workers if row.status == 'running' and row.lease_expires_at and aware(row.lease_expires_at) > now()]
    jobs = list(session.scalars(select(Job).where(Job.kind.in_(['deterministic_turn', 'advisor_turn', 'advisor_validation']), Job.status.in_(['queued', 'running']))))
    oldest = min((aware(row.created_at) for row in jobs), default=None)
    age = max(0, round((now() - oldest).total_seconds())) if oldest else 0
    running = [row for row in jobs if row.status == 'running']
    def stalled(row):
        if row.kind in ('advisor_turn', 'advisor_validation'):
            return not row.lease_expires_at or aware(row.lease_expires_at) <= now()
        progress_at = row.progress.get('updatedAt')
        from datetime import datetime
        last_progress = datetime.fromisoformat(progress_at.replace('Z', '+00:00')) if progress_at else aware(row.started_at or row.created_at)
        return (now() - last_progress).total_seconds() > STALE_SECONDS
    blocked = bool(jobs) and (not active or any(stalled(row) for row in running)
                             or (not running and age > STALE_SECONDS))
    return {'status': 'online' if active else 'offline', 'activeWorkers': len(active),
            'lastSeenAt': max((row.progress['lastSeenAt'] for row in workers), default=None),
            'lastProcessedAt': max((row.progress['lastProcessedAt'] for row in workers if row.progress.get('lastProcessedAt')), default=None),
            'queued': sum(row.status == 'queued' for row in jobs), 'running': sum(row.status == 'running' for row in jobs),
            'oldestPendingSeconds': age, 'queueStalled': blocked}
