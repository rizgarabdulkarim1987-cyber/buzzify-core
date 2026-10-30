import { customerListInput } from '@/server/pharmacy/customers';
import { ageingInput, customerAgeing, customerGetInput, customerStatement, getCustomer, listCustomers, statementInput } from '@/server/pharmacy/customers-reads';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading customers and their credit account (phase 7, R7-5). The framework needs `catalog.view` for the lists a seller uses
 * (the service then requires `customer.manage` or `credit.sell`, and shows the phone and note to `customer.manage` only);
 * statements and ageing need `customer.manage`. A support actor reads none of it.
 */

export const list = defineQuery({
  name: 'ph.customers.list',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: customerListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return listCustomers(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.customers.get',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: customerGetInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return getCustomer(scoped, ph, input.customerId);
  },
});

export const statement = defineQuery({
  name: 'ph.credit.statement',
  permission: null,
  ph: 'customer.manage',
  allowReadOnly: true,
  input: statementInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return customerStatement(scoped, ph, input);
  },
});

export const ageing = defineQuery({
  name: 'ph.credit.ageing',
  permission: null,
  ph: 'customer.manage',
  allowReadOnly: true,
  input: ageingInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return customerAgeing(scoped, ph, input);
  },
});
