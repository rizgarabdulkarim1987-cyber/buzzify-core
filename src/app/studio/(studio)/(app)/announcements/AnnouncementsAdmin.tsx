'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { archiveAnnouncement, createAnnouncement, updateAnnouncement } from '@/app/studio/_actions/announcements';
import { BODY_MAX, TITLE_MAX, type AnnouncementRow } from '@/lib/announcements';
import { LOCALE_NAMES, LOCALES } from '@/lib/locale';
import { describeFailure } from '@/studio/errors';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Textarea } from '@/studio/ui/Textarea';

interface Draft {
  id: string | null;
  titles: Record<string, string>;
  bodies: Record<string, string>;
  /** `datetime-local` values: the person's own clock, no zone. */
  startsAt: string;
  endsAt: string;
}

const EMPTY: Draft = { id: null, titles: {}, bodies: {}, startsAt: '', endsAt: '' };

/** An ISO time as the value of a `datetime-local` input, in the person's own time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const toIso = (local: string): string | undefined => (local ? new Date(local).toISOString() : undefined);

/**
 * The Buzzify team's announcements: the live and scheduled ones, a form to write one in up to three languages, and
 * archiving. A new announcement appears on every till within a minute.
 */
export function AnnouncementsAdmin({ rows }: { rows: AnnouncementRow[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState<AnnouncementRow | null>(null);
  const [pending, start] = useTransition();

  const open = (row?: AnnouncementRow) => {
    setErrors({});
    setDraft(
      row
        ? { id: row.id, titles: row.titles, bodies: row.bodies, startsAt: toLocalInput(row.startsAt), endsAt: toLocalInput(row.endsAt) }
        : EMPTY,
    );
  };

  const save = () => {
    if (!draft) return;
    const input = { titles: draft.titles, bodies: draft.bodies, startsAt: toIso(draft.startsAt), endsAt: toIso(draft.endsAt) ?? null };
    start(async () => {
      const result = draft.id ? await updateAnnouncement({ id: draft.id, ...input }) : await createAnnouncement(input);
      if (result.ok) {
        toast.success(t('announcements.saved'));
        setDraft(null);
        router.refresh();
      } else {
        const failure = describeFailure(t, locale, result.error);
        setErrors(failure.fields ?? {});
        toast.error(failure.message);
      }
    });
  };

  const title = (row: AnnouncementRow) => row.titles[locale] || Object.values(row.titles)[0] || '';
  const tone = (status: AnnouncementRow['status']) => (status === 'live' ? 'success' : 'neutral');

  return (
    <div className="flex flex-col gap-6">
      {!draft && (
        <div>
          <Button variant="primary" onClick={() => open()}>
            {t('announcements.add')}
          </Button>
        </div>
      )}

      {draft && (
        <form
          className="flex flex-col gap-5 rounded-lg border border-line p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <p className="text-sm text-muted">{t('announcements.languages')}</p>
          {errors.titles && <p className="text-sm text-danger">{errors.titles}</p>}
          {LOCALES.map((code) => (
            <fieldset key={code} className="flex flex-col gap-3">
              <legend className="text-sm font-medium text-text">{LOCALE_NAMES[code]}</legend>
              <Field label={t('announcements.field.title')} hideLabel>
                <Input
                  dir={code === 'en' ? 'ltr' : 'rtl'}
                  lang={code}
                  placeholder={t('announcements.field.title')}
                  maxLength={TITLE_MAX}
                  value={draft.titles[code] ?? ''}
                  onChange={(event) => setDraft({ ...draft, titles: { ...draft.titles, [code]: event.target.value } })}
                />
              </Field>
              <Field label={t('announcements.field.body')} hideLabel>
                <Textarea
                  dir={code === 'en' ? 'ltr' : 'rtl'}
                  lang={code}
                  placeholder={t('announcements.field.body')}
                  maxLength={BODY_MAX}
                  value={draft.bodies[code] ?? ''}
                  onChange={(event) => setDraft({ ...draft, bodies: { ...draft.bodies, [code]: event.target.value } })}
                />
              </Field>
            </fieldset>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('announcements.field.starts')}>
              <Input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
            </Field>
            <Field label={t('announcements.field.ends')} hint={t('announcements.field.endsHint')} error={errors.endsAt}>
              <Input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" pending={pending}>
              {t('announcements.save')}
            </Button>
            <Button onClick={() => setDraft(null)} disabled={pending}>
              {t('announcements.cancel')}
            </Button>
          </div>
        </form>
      )}

      {rows.length === 0 && !draft ? (
        <EmptyState title={t('announcements.empty')} body={t('announcements.emptyBody')} />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-base font-medium text-text">{title(row)}</span>
                <span className="text-sm text-muted">
                  {formatDateTime(row.startsAt, locale)}
                  {row.endsAt ? ` – ${formatDateTime(row.endsAt, locale)}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={tone(row.status)}>{t(`announcements.status.${row.status}`)}</StatusBadge>
                <Button size="sm" onClick={() => open(row)}>
                  {t('announcements.edit')}
                </Button>
                <Button size="sm" onClick={() => setArchiving(row)}>
                  {t('announcements.archive')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(next) => !next && setArchiving(null)}
        title={t('announcements.archiveTitle')}
        body={t('announcements.archiveBody')}
        confirmLabel={t('announcements.archive')}
        onConfirm={async () => {
          if (!archiving) return true;
          const result = await archiveAnnouncement({ id: archiving.id });
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          toast.success(t('announcements.archived'));
          setArchiving(null);
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
