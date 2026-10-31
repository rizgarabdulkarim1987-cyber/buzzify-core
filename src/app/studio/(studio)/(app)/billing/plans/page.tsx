import { redirect } from 'next/navigation';

/** The pharmacy plans moved into the Pharmacy space's own settings. */
export default function AppPlansRedirect() {
  redirect('/studio/pharmacy/settings');
}
