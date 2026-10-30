import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { balancesInput, listBalances, listPayables, payablesInput, statementInput, supplierStatement } from '@/server/pharmacy/payables-reads';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

export const statement = defineQuery({
  name: 'ph.suppliers.statement',
  permission: null,
  ph: 'purchase.manage',
  input: statementInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return supplierStatement(scoped, ph, input);
  },
});

export const list = defineQuery({
  name: 'ph.payables.list',
  permission: null,
  ph: 'purchase.manage',
  input: payablesInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listPayables(scoped, ph, input);
  },
});

export const balances = defineQuery({
  name: 'ph.suppliers.balances',
  permission: null,
  ph: 'purchase.manage',
  input: balancesInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listBalances(scoped, ph, input);
  },
});
