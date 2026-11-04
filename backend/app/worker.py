"""Durable deterministic and optional local-material Advisor worker."""
from copy import deepcopy
import argparse
import time
from threading import Event, Thread
from uuid import uuid4
from sqlalchemy import select

from .content import ContentStore
from .db import Assignment, Database, Job, Task, now
from .service import Service, stamp
from .settings import Settings
from .operations import HEARTBEAT_SECONDS, heartbeat


def tick(database, service):
    with database.transaction() as session:
        # Assignment -> job -> task is also the API's lock order.
        candidate = session.execute(select(Job.job_id, Job.scope_ref).where(Job.kind == 'deterministic_turn', Job.status.in_(['queued','running'])).order_by(Job.created_at)).first()
        if candidate is None:
            return False
        assignment = session.scalar(select(Assignment).where(Assignment.participant_id == candidate.scope_ref['participant_id']).with_for_update())
        job = session.scalar(select(Job).where(Job.job_id == candidate.job_id).with_for_update())
        if job.status not in ('queued','running'):
            return True
        task = session.get(Task, job.scope_ref['task_id'])
        data = deepcopy(task.task_data)
        task.task_data = data
        attempt = next(a for a in data['attempts'] if a['attempt_id'] == job.scope_ref['attempt_id'])
        turn = next(t for t in attempt['turns'] if t['turn_id'] == job.scope_ref['turn_id'])
        if assignment.status == 'cancelled' or attempt['status'] != 'in_progress' or task.runtime_state.get('current_attempt_id') != attempt['attempt_id'] or task.runtime_state.get('active_turn_id') != turn['turn_id']:
            job.status, job.finished_at = 'cancelled', now()
            return True
        step = job.progress['step']
        if step == 0:
            turn['status'], job.status, job.started_at = 'running', 'running', now()
        else:
            response = 'This is a deterministic integration reply, not financial advice from a live model. The scenario and reference documents remain available on the left. You can ask another question or finish after three completed exchanges.'
            message = next((m for m in turn['messages'] if m['role'] == 'assistant'), None)
            if message is None:
                message = {'id': f'assistant-{turn["turn_id"]}', 'role': 'assistant', 'text': '', 'timestamp': stamp(), 'status': 'partial', 'citations': []}
                turn['messages'].append(message)
            message['text'] = response if step >= 2 else response[:len(response)//2]
            if step >= 2:
                message['status'], turn['status'], turn['finished_at'] = 'complete', 'completed', stamp()
                task.runtime_state = {**task.runtime_state, 'active_turn_id': None}
                job.status, job.finished_at = 'succeeded', now()
                config = service.config(assignment)
                if sum(t['status'] == 'completed' for t in attempt['turns']) >= config['policy']['maximum']:
                    attempt.update(phase='post', dialogue_ended_at=stamp(), dialogue_end_reason='max_turns')
        job.progress = {'step': step + 1, 'updatedAt': stamp()}
        service.touch(task)
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    settings = Settings.from_env()
    database = Database(settings.database_url)
    service = Service(settings, ContentStore(settings.artifact_dir, settings.study_file))
    from .advisor import AdvisorRuntime
    from .environment import EnvironmentSettings
    advisor = AdvisorRuntime(database, service, EnvironmentSettings(settings))
    worker_id = str(uuid4())
    processed_at = None
    stopped = Event()
    def keep_alive():
        while not stopped.wait(HEARTBEAT_SECONDS):
            heartbeat(database, worker_id, processed_at=processed_at)
    heartbeat(database, worker_id)
    beat_thread = Thread(target=keep_alive, daemon=True)
    beat_thread.start()
    try:
        while True:
            if tick(database, service) or advisor.tick():
                processed_at = now()
            if args.once:
                return
            time.sleep(0.25)
    finally:
        stopped.set()
        beat_thread.join(timeout=10)
        heartbeat(database, worker_id, processed_at=processed_at, stopped=True)


if __name__ == '__main__':
    main()
