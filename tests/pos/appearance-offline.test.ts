import { describe, expect, it } from 'vitest';
import { restoreAppearance, storeAppearance } from '@/app/pos/_ui/sync/appearance-cache';

/** A Storage stand-in: just the three calls the cache makes. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

describe('appearance cache', () => {
  it('returns what was stored for that person', () => {
    const s = fakeStorage();
    storeAppearance('u1', { '--s-bg': '#121212' }, 'round', s);
    expect(restoreAppearance('u1', s)).toEqual({ vars: { '--s-bg': '#121212' }, shape: 'round' });
  });

  it('gives nothing for another person, and the last person’s look when no one is named', () => {
    const s = fakeStorage();
    storeAppearance('u1', { '--s-bg': '#121212' }, 'square', s);
    expect(restoreAppearance('u2', s)).toBeNull();
    expect(restoreAppearance(null, s)).toEqual({ vars: { '--s-bg': '#121212' }, shape: 'square' });
  });

  it('forgets the look of a person who went back to the default', () => {
    const s = fakeStorage();
    storeAppearance('u1', { '--s-bg': '#121212' }, 'round', s);
    storeAppearance('u1', {}, null, s);
    expect(restoreAppearance('u1', s)).toBeNull();
  });

  it('survives damaged storage and storage that throws', () => {
    expect(restoreAppearance('u1', fakeStorage({ 'pos-appearance:u1': '{nope' }))).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => storeAppearance('u1', { '--s-bg': '#000000' }, 'round', broken)).not.toThrow();
    expect(restoreAppearance('u1', broken)).toBeNull();
  });

  it('keeps only custom properties of the Studio, nothing a stored value could use to inject styles', () => {
    const s = fakeStorage();
    storeAppearance('u1', { '--s-bg': '#121212', 'background-image': 'url(x)', '--other': 'y' }, 'round', s);
    expect(restoreAppearance('u1', s)?.vars).toEqual({ '--s-bg': '#121212' });
  });
});
