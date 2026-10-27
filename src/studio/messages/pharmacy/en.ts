import type { Messages } from '@/lib/i18n';

/** The pharmacy's screens. Spread into the Studio catalog by `../en.ts`; later tasks add their keys here. */
const pharmacy: Messages = {
  'pharmacy.support.banner': 'Support mode',
  'pharmacy.support.until': 'Buzzify support can read this pharmacy until {time}',
  // Refusals of a support grant (src/studio/errors.ts)
  'error.text.supportGrantee': 'Name a member of Buzzify support',
  'error.text.supportNoScope': 'Choose at least one kind of access',
  'error.text.supportUnknownScope': 'Choose from the listed kinds of access',
  'error.text.supportReason': 'Give a reason of at least 10 characters',
  'error.text.supportTooLong': 'Grant access for at most 72 hours',
  'error.text.supportTooShort': 'Grant access for at least one hour',
  'error.text.supportSensitive': 'Confirm that support may see prescriptions or patients',
  'error.text.supportConsentRef': 'Enter a reference of at least 10 characters',
};

export default pharmacy;
