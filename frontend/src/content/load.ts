import type { MaterialBundle } from './types';
import type { ExperimentInstructions } from '../integration/contracts';

export async function loadExperimentInstructions(): Promise<ExperimentInstructions> {
  const response = await fetch(`${import.meta.env.BASE_URL}materials/instructions.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('实验说明暂时没能打开，请点击“重新加载”再试一次。');
  const instructions = await response.json();
  if (typeof instructions.welcome !== 'string' || !instructions.welcome.trim() || typeof instructions.revision !== 'string')
    throw new Error('实验说明暂时没有正确显示，请重新加载；如果仍有问题，可以联系研究人员。');
  return instructions;
}

export async function loadMaterials(signal?: AbortSignal): Promise<MaterialBundle> {
  const base = import.meta.env.BASE_URL;
  const manifestResponse = await fetch(`${base}materials/manifest.json`, { signal, cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error('任务材料暂时没能打开，请再试一次；如果仍有问题，可以联系研究人员。');
  const manifest = await manifestResponse.json();
  if (!/^snapshot-[a-f0-9]{64}\.json$/.test(manifest.snapshot)) throw new Error('暂时没能找到这次任务的材料，请联系研究人员协助处理。');
  const response = await fetch(`${base}materials/${manifest.snapshot}`, { signal });
  if (!response.ok) throw new Error('任务材料暂时没能打开，请再试一次；如果仍有问题，可以联系研究人员。');
  const bundle = await response.json() as MaterialBundle;
  if (bundle.schema_version !== '1.0' || !bundle.shared || !bundle.scenarios?.length)
    throw new Error('这次任务的材料暂时无法显示，请联系研究人员协助处理。');
  return bundle;
}
