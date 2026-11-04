/** The hosts the links are built on (from `hostEnv()`): a name without a scheme for the Studio and the pharmacy, an origin for public menus. */
export interface LinkHosts {
  studioHost: string | null;
  pharmacyHost: string | null;
  publicOrigin: string;
}

export type CustomerLinkKind = 'signIn' | 'cashier' | 'pharmacy' | 'menu';

/** One address to send to a new customer. `label` names the menu of a menu link, otherwise null. */
export interface CustomerLink {
  kind: CustomerLinkKind;
  label: string | null;
  url: string;
}

export interface CustomerLinksInput {
  sector: string;
  hasCashier: boolean;
  menus: ReadonlyArray<{ name: string; slug: string }>;
  hosts: LinkHosts;
}

/**
 * The addresses a new customer needs, in the order to send them: where to sign in, then the product they have. A
 * pharmacy gets the pharmacy page only; a restaurant gets the till when it subscribes to the Cashier, and one link per
 * menu. The super admin's own host is never among them. Empty while no Studio host is configured (development).
 */
export function customerLinks({ sector, hasCashier, menus, hosts }: CustomerLinksInput): CustomerLink[] {
  const studio = hosts.studioHost ? `https://${hosts.studioHost}` : null;
  if (!studio) return [];
  if (sector === 'PHARMACY') {
    const pharmacy = hosts.pharmacyHost ? `https://${hosts.pharmacyHost}` : studio;
    return [{ kind: 'pharmacy', label: null, url: `${pharmacy}/pharmacy` }];
  }
  const origin = hosts.publicOrigin.replace(/\/+$/, '');
  return [
    { kind: 'signIn', label: null, url: `${studio}/studio/sign-in` },
    ...(hasCashier ? [{ kind: 'cashier' as const, label: null, url: `${studio}/pos` }] : []),
    ...menus.map((menu) => ({ kind: 'menu' as const, label: menu.name, url: `${origin}/${encodeURIComponent(menu.slug)}` })),
  ];
}

const HEADINGS: Record<CustomerLinkKind, string> = {
  signIn: 'لوحة التحكم (المنيو):',
  cashier: 'الكاشير:',
  pharmacy: 'رابط الصيدلية:',
  menu: 'رابط المنيو للزبائن (للـ QR):',
};

/**
 * The message to paste to the customer: the links and the email to sign in with. It carries no password: the customer
 * sets theirs from the invitation email or "Forgot your password?". Empty when there are no links.
 */
export function customerMessage(links: readonly CustomerLink[], email: string): string {
  if (links.length === 0) return '';
  const blocks = links.map((link) => `${link.kind === 'menu' && link.label ? `${HEADINGS.menu} (${link.label})` : HEADINGS[link.kind]}\n${link.url}`);
  return [
    'أهلاً بك في Buzzify 👋',
    ...blocks,
    `الدخول بالإيميل: ${email}\nكلمة السر تسويها من رابط الدعوة اللي وصلك بالإيميل، أو اضغط Forgot your password? بصفحة الدخول.`,
  ].join('\n\n');
}
