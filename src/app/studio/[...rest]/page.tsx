import { notFound } from 'next/navigation';

/**
 * Any /studio address no page claims. Without it Next would offer it to the public menu's `[tenant]/[locale]` route,
 * which answers with the menu's own 404; this shows the Studio's own not-found page instead. Next prefers a route with
 * fixed segments to a catch-all, so every real Studio page, including those in the `(auth)` and `(app)` groups,
 * still wins.
 */
export default function UnknownStudioPage() {
  notFound();
}
