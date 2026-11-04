"""Batch summaries grouped by both batch name and immutable arrangement."""
from sqlalchemy import case, func, select

from .admin import AdminReader
from .db import Assignment, Job, Task
from .service import fingerprint, stamp


def batches(session, store, page=1, size=20, query=None):
    task_counts = select(Task.participant_id.label('pid'), func.count().label('total'),
                         func.sum(case((Task.status == 'completed', 1), else_=0)).label('completed'))
    task_counts = task_counts.group_by(Task.participant_id).subquery()
    state = AdminReader.status_expression()
    statement = select(Assignment.batch_id, Assignment.config_ref, func.count().label('participants'),
                       func.min(Assignment.assigned_at).label('first_at'), func.max(Assignment.assigned_at).label('last_at'),
                       func.coalesce(func.sum(task_counts.c.total), 0).label('task_total'),
                       func.coalesce(func.sum(task_counts.c.completed), 0).label('task_completed'),
                       *[func.sum(case((Assignment.condition == value, 1), else_=0)).label(value) for value in ('neutral', 'goal')],
                       *[func.sum(case((state == value, 1), else_=0)).label(value) for value in ('pending', 'in_progress', 'completed', 'cancelled', 'expired')])
    statement = statement.outerjoin(task_counts, task_counts.c.pid == Assignment.participant_id)
    if query:
        statement = statement.where(Assignment.batch_id.contains(query.strip(), autoescape=True))
    statement = statement.group_by(Assignment.batch_id, Assignment.config_ref)
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = session.execute(statement.order_by(func.max(Assignment.assigned_at).desc(), Assignment.config_ref,
                                             Assignment.batch_id).offset((page - 1) * size).limit(size))
    items = []
    for row in rows:
        config = store.get(row.config_ref)
        selected_model = config.get('model_selection')
        allocation_job = session.get(Job, config['allocation']['id']) if config.get('allocation') else None
        groups = [{'condition': value, 'count': getattr(row, value)} for value in ('neutral', 'goal') if getattr(row, value)]
        key = fingerprint({'batchId': row.batch_id, 'configRef': row.config_ref})
        items.append({'key': key, 'batchId': row.batch_id, 'configRef': row.config_ref,
                      'allocationPlanRef': allocation_job.result_ref if allocation_job else None,
                      'participantCount': row.participants, 'groups': groups,
                      'statuses': {value: getattr(row, value) for value in ('pending', 'in_progress', 'completed', 'cancelled', 'expired')},
                      'firstAssignedAt': stamp(row.first_at), 'lastAssignedAt': stamp(row.last_at),
                      'taskTotal': row.task_total, 'tasksCompleted': row.task_completed,
                      'taskNumbers': [task['case_id'].zfill(2) for task in config['tasks']],
                      'runtimeMode': config['runtime_mode'], 'modelLabel': selected_model['label'] if selected_model else '确定性开发回复',
                      'copyPlan': {'sourceKey': key, 'sourceBatch': row.batch_id, 'taskCodes': [task['id'] for task in config['tasks']],
                                   'maxTurns': config['policy']['maximum'], 'groups': groups,
                                   'modelId': selected_model['id'] if selected_model else None}})
    return {'items': items, 'total': total, 'page': page, 'pageSize': size}
