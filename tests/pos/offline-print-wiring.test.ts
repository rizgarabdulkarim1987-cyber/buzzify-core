import { describe, expect, it } from 'vitest';
import { offlinePrintTargets } from '@/app/pos/_ui/print/offline-print';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';
import type { PrinterView } from '@/server/pos/printers';

const printer = (over: Partial<PrinterView> = {}): PrinterView => ({
  id: 'p', name: 'Front', role: 'RECEIPT', transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2, isDefault: true, sectionId: null, sortOrder: 0, ...over,
});
const snap = (printers?: PrinterView[]) => ({ printers }) as Pick<SyncSnapshot, 'printers'>;

describe('offlinePrintTargets', () => {
  it('prints nothing for an old stored snapshot without printers', () => {
    expect(offlinePrintTargets(snap(undefined))).toEqual({ receipt: null, hasDrawer: false });
  });

  it('prints nothing when the restaurant has no receipt printer', () => {
    expect(offlinePrintTargets(snap([printer({ role: 'KITCHEN', sectionId: 's1' })]))).toEqual({ receipt: null, hasDrawer: false });
  });

  it('takes the default receipt printer and knows whether it holds the drawer', () => {
    const front = printer();
    expect(offlinePrintTargets(snap([printer({ id: 'x', isDefault: false, drawerPin: null }), front]))).toEqual({ receipt: front, hasDrawer: true });
    expect(offlinePrintTargets(snap([printer({ drawerPin: null })])).hasDrawer).toBe(false);
  });
});
