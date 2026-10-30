import type { IntroContact, IntroContactKind } from '@/server/data/intro';

/** The restaurant's own contacts: a row of small links, only the ones it filled in. */
export function ContactIcons({ contacts, labels }: { contacts: IntroContact[]; labels: Record<IntroContactKind, string> }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {contacts.map((contact) => (
        <li key={contact.kind}>
          <a
            href={contact.href}
            {...(contact.href.startsWith('https://') ? { target: '_blank' } : {})}
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-full border border-white/50 bg-black/25 px-4 text-sm text-white backdrop-blur-sm transition-colors duration-150 [@media(hover:hover)]:hover:bg-white/25"
          >
            {labels[contact.kind]}
          </a>
        </li>
      ))}
    </ul>
  );
}
