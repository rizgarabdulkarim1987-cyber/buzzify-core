const KEY = 'atelier:stage';

export type StagePreference = 'on' | 'off';

/**
 * The visitor's own choice about the 3D stage. `?stage=on` and `?stage=off` are remembered on this
 * device, `?stage=auto` forgets the choice. Storage can be unavailable (private windows, blocked
 * site data), in which case only the URL counts.
 *
 * This is called when the app mounts, not when a stage probes the device: by then a tap may already
 * have replaced the URL and dropped the query.
 */
export function syncStagePreference(): StagePreference | undefined {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(window.location.search).get('stage');
  } catch {
    return undefined;
  }
  const fromUrl = asked === 'on' || asked === 'off' ? asked : undefined;
  try {
    if (fromUrl) window.localStorage.setItem(KEY, fromUrl);
    else if (asked === 'auto') window.localStorage.removeItem(KEY);
    const stored = window.localStorage.getItem(KEY);
    return stored === 'on' || stored === 'off' ? stored : undefined;
  } catch {
    return fromUrl;
  }
}
