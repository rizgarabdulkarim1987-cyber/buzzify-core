import type { Messages } from '@/lib/i18n';

/** The pharmacy's screens. Spread into the Studio catalog by `../en.ts`; later tasks add their keys here. */
const pharmacy: Messages = {
  'pharmacy.support.banner': 'Support mode',
  'pharmacy.support.until': 'Buzzify support can read this pharmacy until {time}',
  // The shell: header, picker, home and the state notices
  'pharmacy.shell.label': 'Buzzify Pharmacy',
  'pharmacy.shell.changeBranch': 'Change branch',
  'pharmacy.shell.account': 'Account and language',
  'pharmacy.shell.where': 'Where you work',
  'pharmacy.branch.all': 'All branches',
  'pharmacy.select.title': 'Choose where you work',
  'pharmacy.select.intro': 'Pick the branch you are working in. You can change it at any time from the top of the screen.',
  'pharmacy.select.current': 'Current',
  'pharmacy.home.intro': 'Selling, stock and reports for {place} will open here.',
  'pharmacy.role.OWNER': 'Owner',
  'pharmacy.role.BRANCH_MANAGER': 'Branch manager',
  'pharmacy.role.PHARMACIST_IN_CHARGE': 'Pharmacist in charge',
  'pharmacy.role.PHARMACIST': 'Pharmacist',
  'pharmacy.role.CASHIER': 'Cashier',
  'pharmacy.role.STOCK': 'Stock keeper',
  'pharmacy.role.ACCOUNTANT': 'Accountant',
  'pharmacy.role.support': 'Buzzify support',
  'pharmacy.state.readOnly.title': 'Read only',
  'pharmacy.state.readOnly.body':
    'The subscription has lapsed. Until {date} you can read and export everything; selling, receiving and changes are paused.',
  'pharmacy.state.closed.title': 'This pharmacy is closed',
  'pharmacy.state.closed.restaurantInactive': 'This business is not active. Ask Buzzify to reactivate it.',
  'pharmacy.state.closed.notPharmacy': 'This business is not a pharmacy.',
  'pharmacy.state.closed.planInactive': 'This pharmacy has no subscription. Ask Buzzify to start one.',
  'pharmacy.state.closed.archived': 'The subscription lapsed and the reading period has ended, so the pharmacy is archived.',
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
