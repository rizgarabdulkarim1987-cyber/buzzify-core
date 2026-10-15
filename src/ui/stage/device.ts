import { qualifiesFor3D, type StageEnvironment } from '@/lib/stage';
import { syncStagePreference } from './preference';

/** Reads what this browser says about itself and whether WebGL can start at all. */
export function probeEnvironment(): StageEnvironment {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const forced = syncStagePreference();
  let webgl = false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webgl = context !== null;
    // Give the probe context back so it does not count against the page's limit.
    (context as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return {
    webgl,
    saveData: nav.connection?.saveData === true,
    deviceMemory: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    forced,
  };
}

/** Whether this device should load a 3D stage. */
export function deviceQualifies(): boolean {
  return qualifiesFor3D(probeEnvironment());
}
