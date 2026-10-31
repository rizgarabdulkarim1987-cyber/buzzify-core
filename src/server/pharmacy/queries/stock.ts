import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { balancesInput, listBalances, listMovements, movementsInput } from '@/server/pharmacy/stock-reads';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading stock. Balances need `catalog.view` (every pharmacy role; cost keys exist only for `cost.view`), the ledger
 * needs `report.view` (OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, ACCOUNTANT). A support actor reads neither. The
 * place's branch narrows the answer; without one a branch-limited actor still gets only their own branches.
 */

export const balances = defineQuery({
  name: 'ph.stock.balances',
  permission: null,
  ph: 'catalog.view',
  input: balancesInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listBalances(scoped, ph, input);
  },
});

export const movements = defineQuery({
  name: 'ph.stock.movements',
  permission: null,
  ph: 'report.view',
  input: movementsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listMovements(scoped, input);
  },
});
