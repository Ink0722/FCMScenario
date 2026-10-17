import { errors } from '../app/copy';
import type { MaterialBundle } from './types';
import type { ExperimentInstructions } from '../integration/contracts';

export async function loadExperimentInstructions(): Promise<ExperimentInstructions> {
  const response = await fetch(`${import.meta.env.BASE_URL}materials/instructions.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(errors.instructionsLoad);
  const instructions = await response.json();
  if (typeof instructions.welcome !== 'string' || !instructions.welcome.trim() || typeof instructions.revision !== 'string')
    throw new Error(errors.instructionsInvalid);
  return instructions;
}

export async function loadMaterials(signal?: AbortSignal): Promise<MaterialBundle> {
  const base = import.meta.env.BASE_URL;
  const manifestResponse = await fetch(`${base}materials/manifest.json`, { signal, cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(errors.materialsLoad);
  const manifest = await manifestResponse.json();
  if (!/^snapshot-[a-f0-9]{64}\.json$/.test(manifest.snapshot)) throw new Error(errors.materialsMissing);
  const response = await fetch(`${base}materials/${manifest.snapshot}`, { signal });
  if (!response.ok) throw new Error(errors.materialsLoad);
  const bundle = await response.json() as MaterialBundle;
  if (bundle.schema_version !== '1.0' || !bundle.shared || !bundle.scenarios?.length)
    throw new Error(errors.materialsInvalid);
  return bundle;
}
