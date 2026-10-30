import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSTATION, MAX_WORKSTATIONS, printSettings, readPrintSettings, settingsOfWorkstation, withWorkstation, workstationSettings } from '@/server/domain/pharmacy/print-settings';

describe('print settings shape', () => {
  it('accepts the defaults', () => {
    expect(workstationSettings.safeParse(DEFAULT_WORKSTATION).success).toBe(true);
  });

  it('rejects unknown keys at every level', () => {
    expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, silent: true }).success).toBe(false);
    expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, marginMm: { ...DEFAULT_WORKSTATION.marginMm, middle: 1 } }).success).toBe(false);
    expect(printSettings.safeParse({ workstations: {}, drawer: true }).success).toBe(false);
  });

  it('bounds the margins to whole millimetres from 0 to 40', () => {
    for (const bad of [-1, 41, 2.5, Number.NaN, Infinity, '5' as unknown as number]) {
      expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, marginMm: { ...DEFAULT_WORKSTATION.marginMm, top: bad } }).success, String(bad)).toBe(false);
    }
    for (const good of [0, 1, 40]) expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, marginMm: { ...DEFAULT_WORKSTATION.marginMm, left: good } }).success).toBe(true);
  });

  it('allows only the listed paper and label sizes', () => {
    expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, paper: 'A3' }).success).toBe(false);
    expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, labelSize: '70x40' }).success).toBe(false);
    for (const labelSize of ['40x25', '50x30', '58'] as const) expect(workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, labelSize }).success).toBe(true);
  });

  it('names a workstation in 1 to 40 characters and keeps at most 20', () => {
    expect(() => withWorkstation({ workstations: {} }, '   ', DEFAULT_WORKSTATION)).toThrow();
    expect(() => withWorkstation({ workstations: {} }, 'x'.repeat(41), DEFAULT_WORKSTATION)).toThrow();
    let all = { workstations: {} } as ReturnType<typeof readPrintSettings>;
    for (let i = 0; i < MAX_WORKSTATIONS; i++) all = withWorkstation(all, `WS ${i}`, DEFAULT_WORKSTATION);
    expect(Object.keys(all.workstations)).toHaveLength(MAX_WORKSTATIONS);
    expect(() => withWorkstation(all, 'one more', DEFAULT_WORKSTATION)).toThrow();
    // Changing an existing one is not "one more".
    expect(Object.keys(withWorkstation(all, 'WS 3', { ...DEFAULT_WORKSTATION, paper: 'A5' }).workstations)).toHaveLength(MAX_WORKSTATIONS);
  });

  it('reads a bad stored value as none, and a workstation without settings as the defaults', () => {
    expect(readPrintSettings(null)).toEqual({ workstations: {} });
    expect(readPrintSettings({ workstations: { A: { paper: 'huge' } } })).toEqual({ workstations: {} });
    expect(readPrintSettings('x')).toEqual({ workstations: {} });
    const saved = withWorkstation({ workstations: {} }, ' Counter 1 ', { ...DEFAULT_WORKSTATION, labelSize: '58' });
    expect(settingsOfWorkstation(saved, 'Counter 1').labelSize).toBe('58');
    expect(settingsOfWorkstation(saved, 'Counter 2')).toEqual(DEFAULT_WORKSTATION);
  });

  it('a workstation named like a built-in property gets the defaults, not the object prototype', () => {
    const none = { workstations: {} };
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(settingsOfWorkstation(none, name), name).toEqual(DEFAULT_WORKSTATION);
  });
});
