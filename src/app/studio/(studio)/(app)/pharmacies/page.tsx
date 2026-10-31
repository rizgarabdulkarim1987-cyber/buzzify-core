import { redirect } from 'next/navigation';

/** The old address of the Pharmacy list: a Super Admin's Pharmacy now lives in its own space. */
export default function PharmaciesRedirect() {
  redirect('/studio/pharmacy');
}
