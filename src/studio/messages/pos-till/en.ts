import type { Messages } from '@/lib/i18n';

/** The till's screens and refusals (cashier phase 3). Spread into the Studio catalog by `../en.ts`. */
const posTill: Messages = {
  'error.text.posTableInUse': 'A table has an open order',
  'error.text.posTableNumbers': 'Some of these table numbers are already in use',
  'error.text.posTableOccupied': 'The table already has an open order',
  'error.text.posRangeOrder': 'The first number must not exceed the last',
  'error.text.posRangeSize': 'Create at most 200 tables at a time',
};

export default posTill;
