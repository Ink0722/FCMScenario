import { useEffect, useState } from 'react';
import type { ExperimentGateway, ExperimentInstructions } from '../integration/contracts';

export interface InstructionsResource {
  data: ExperimentInstructions | null;
  loading: boolean;
  error: string;
  reload: () => void;
}
export function useInstructions(gateway: ExperimentGateway): InstructionsResource {
  const [data, setData] = useState<ExperimentInstructions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    gateway.getExperimentInstructions().then(value => {
      if (active) setData(value);
    }).catch(e => {
      if (active) setError(e instanceof Error ? e.message : '实验说明暂时没能打开，请点击“重新加载”再试一次。');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [gateway, attempt]);
  return { data, loading, error, reload: () => setAttempt(value => value + 1) };
}
