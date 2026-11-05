import { describe, expect, it } from 'vitest';
import { nextUnitId, type CartLine, type CartUnit } from '@/app/pharmacy/_ui/sell-logic';

const u = (id: string, priceMinor: string | null): CartUnit => ({ id, label: id, baseQty: 1, priceMinor });
const line = (units: CartUnit[], unitId: string): CartLine => ({ units, unitId }) as CartLine;

describe('nextUnitId', () => {
  const three = [u('tablet', '250'), u('strip', '2000'), u('packet', '9000')];
  it('cycles tablet -> strip -> packet -> tablet', () => {
    expect(nextUnitId(line(three, 'tablet'), 'IQD')).toBe('strip');
    expect(nextUnitId(line(three, 'strip'), 'IQD')).toBe('packet');
    expect(nextUnitId(line(three, 'packet'), 'IQD')).toBe('tablet');
  });
  it('skips a unit without a price', () => {
    const units = [u('tablet', '250'), u('strip', null), u('packet', '9000')];
    expect(nextUnitId(line(units, 'tablet'), 'IQD')).toBe('packet');
    expect(nextUnitId(line(units, 'packet'), 'IQD')).toBe('tablet');
  });
  it('two units: toggles', () => {
    const units = [u('a', '1'), u('b', '2')];
    expect(nextUnitId(line(units, 'a'), 'IQD')).toBe('b');
    expect(nextUnitId(line(units, 'b'), 'IQD')).toBe('a');
  });
  it('null with one unit', () => {
    expect(nextUnitId(line([u('a', '1')], 'a'), 'IQD')).toBeNull();
  });
  it('null when the current unit is the only priced one', () => {
    const units = [u('a', '1'), u('b', null), u('c', null)];
    expect(nextUnitId(line(units, 'a'), 'IQD')).toBeNull();
  });
  it('a held unit with no price still moves to the next priced one', () => {
    const units = [u('a', null), u('b', '2')];
    expect(nextUnitId(line(units, 'a'), 'IQD')).toBe('b');
  });
});
