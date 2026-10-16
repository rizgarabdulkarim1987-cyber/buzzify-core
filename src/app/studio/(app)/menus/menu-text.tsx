import type { Translate } from '@/lib/i18n';
import { isLocale } from '@/lib/locale';
import type { MenuStatus } from '@/server/domain/menu-status';
import type { PublishIssue } from '@/server/domain/publish-rules';
import type { SlugAvailability } from '@/server/studio/services/menus';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';

const TONES: Record<MenuStatus, StatusTone> = { PUBLISHED: 'success', SUSPENDED: 'danger', DRAFT: 'neutral', ARCHIVED: 'neutral' };

/** A menu's status as a badge: the word, with a colour that repeats it. */
export function MenuStatusBadge({ status, t }: { status: MenuStatus; t: Translate }) {
  return <StatusBadge tone={TONES[status]}>{t(`status.${status.toLowerCase()}`)}</StatusBadge>;
}

/** A language's name in the interface language. */
export const languageName = (t: Translate, code: string) => (isLocale(code) ? t(`menus.language.${code}`) : code);

/**
 * One thing that blocks or warns about a publish, in the person's language. The entity is named by its slug (the one
 * name every item has, whatever the language); a message for the entity's kind is used when there is one.
 */
export function issueText(t: Translate, issue: PublishIssue): string {
  const params = { name: issue.entity?.slug ?? '', language: issue.locale ? languageName(t, issue.locale) : '' };
  const specific = issue.entity ? `menus.issue.${issue.code}.${issue.entity.type}` : null;
  if (specific && t(specific) !== specific) return t(specific, params);
  return t(`menus.issue.${issue.code}`, params);
}

/** What the address field says about an address: available, or why it cannot be had. */
export function slugStatusText(t: Translate, status: SlugAvailability): string {
  switch (status) {
    case 'ok':
      return t('menus.slug.available');
    case 'taken':
      return t('error.text.slugTaken');
    case 'RESERVED':
      return t('error.text.slugReserved');
    case 'TOO_SHORT':
      return t('error.text.slugTooShort');
    case 'TOO_LONG':
      return t('error.text.slugTooLong');
    case 'BAD_CHARACTERS':
      return t('error.text.slugCharacters');
  }
}
