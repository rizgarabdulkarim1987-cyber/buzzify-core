import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { peopleNames, peopleNamesInput } from '@/server/pharmacy/people';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/** The names of the pharmacy's own people for the ids on its shift, sale and return screens (a name, never an email). */
export const names = defineQuery({
  name: 'ph.people.names',
  permission: null,
  ph: 'catalog.view',
  input: peopleNamesInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return peopleNames(scoped, ph, input);
  },
});
