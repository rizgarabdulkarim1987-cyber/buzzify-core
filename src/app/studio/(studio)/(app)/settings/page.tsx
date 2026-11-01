import { redirect } from 'next/navigation';

/** The general platform settings moved to the Platform space; Menu and Cashier settings open on the plans. */
export default function SettingsRedirect() {
  redirect('/studio/settings/plans');
}
