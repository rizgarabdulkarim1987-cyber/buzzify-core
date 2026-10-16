/**
 * Leaves the page for `url` with a full load, and never resolves: the form that called it stays pending until the
 * browser has left. A full load (not a client-side navigation) because signing in or out changes who the root layout
 * renders for, including the page's language and direction.
 */
export function navigateAway(url: string): Promise<never> {
  window.location.assign(url);
  return new Promise<never>(() => undefined);
}
