import type { Messages } from '@/lib/i18n';

/** The link to Buzzify Retail: the sign-in handoff's pages. Spread into the Studio catalog by `../en.ts`; later tasks add their keys here. */
const retail: Messages = {
  'retail.choose.title': 'Choose a shop',
  'retail.choose.intro': 'You own more than one Buzzify Retail shop. Pick the one to open.',
  'retail.choose.empty': 'You do not own a Buzzify Retail shop.',
  'retail.choose.preparing': 'Being prepared',
  'retail.handoff.preparing.title': 'Your shop is being prepared',
  'retail.handoff.preparing.body': 'Buzzify Retail is still setting up your shop. Try again in a few minutes.',
  'retail.handoff.refused.title': 'You cannot sign in to Buzzify Retail yet',
  'retail.handoff.refused.body':
    'This account cannot sign in to Buzzify Retail right now. If your email address was changed, set a new password from the Studio sign-in page to confirm it, then try again from Buzzify Retail.',
  'retail.handoff.back': 'Back to the Studio',
};

export default retail;
