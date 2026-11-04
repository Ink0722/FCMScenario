import { useEffect, useState } from 'react';
import { api, errorText } from './api';
import type { BudgetCheck } from './types';

export function BudgetSummary({ value }: { value?: BudgetCheck }) {
  if (!value?.applies) return null;
  return <div className={value.canIssue ? 'admin-info' : 'admin-error'} role="status">
    <strong>发放额度预检</strong><p>可用 ${value.remainingUsd.toFixed(6)} · 最低 {value.minimumTurns} 轮参考费用 ${value.estimatedMinimumUsd.toFixed(6)} · {value.taskCount} 项个人任务</p>
    <p>{value.message}</p><small>{value.basis}</small>
  </div>;
}
export function BudgetEstimate({ modelId, taskCount, onResult }: {
  modelId: string; taskCount: number; onResult: (value?: BudgetCheck) => void;
}) {
  const [value, setValue] = useState<BudgetCheck>(); const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setValue(undefined); setError(''); onResult(undefined);
    if (!modelId) return;
    const timer = setTimeout(() => {
      api<BudgetCheck>('/model-budget/estimate', { modelId, taskCount }).then(result => {
        if (current) { setValue(result); onResult(result); }
      }).catch(reason => { if (current) setError(errorText(reason)); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [modelId, taskCount]);
  return <>{value && <BudgetSummary value={value} />}{error && <p role="alert">额度预检暂不可用：{error}</p>}</>;
}
