import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { getInvoice, invoiceListInput, invoiceVariance, listInvoiceable, listInvoices } from '@/server/pharmacy/supplier-invoices';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading supplier invoices (`purchase.manage`, R4-9). Invoices belong to the business, so any branch of it sees them all.
 * Money appears only for a role with `cost.view`. A support actor reads none.
 */

const invoiceId = z.string().min(1).max(64);

export const list = defineQuery({
  name: 'ph.invoices.list',
  permission: null,
  ph: 'purchase.manage',
  input: invoiceListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listInvoices(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.invoices.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ invoiceId }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getInvoice(scoped, ph, input.invoiceId);
  },
});

export const variance = defineQuery({
  name: 'ph.invoices.variance',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ invoiceId }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return invoiceVariance(scoped, ph, input.invoiceId);
  },
});

export const invoiceable = defineQuery({
  name: 'ph.invoices.invoiceable',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ supplierId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listInvoiceable(scoped, ph, ph.restaurantId, input.supplierId);
  },
});
