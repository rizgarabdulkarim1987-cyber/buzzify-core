import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { rxReview as reviewOf } from '@/server/pharmacy/staff-doctor';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * `ph.doctor.rxReview` (plan Task 9): the business's active OTC products that name a prescription-only ingredient
 * (`RX_ONLY_INGREDIENTS`), so the owner can correct their `rxLevel` in the product form before switching the Doctor on. Needs
 * `staff.manage` and, in the service, `catalog.manage` (the person who can correct the product). Products are the business's,
 * read through the scoped client: never another business's. Readable while the pharmacy is read-only.
 */
export const rxReview = defineQuery({
  name: 'ph.doctor.rxReview',
  permission: null,
  ph: 'staff.manage',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx) {
    const { ph, scoped } = pharmacyOf(ctx);
    return reviewOf(scoped, ph);
  },
});
