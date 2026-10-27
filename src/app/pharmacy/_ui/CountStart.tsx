'use client';

import { CircleAlert, ClipboardPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { openCount } from '@/app/pharmacy/_actions/counts';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { phMessage } from './ph-failure';
import { useOnline } from './use-online';

type Scope = 'BRANCH' | 'CATEGORY' | 'LOCATION';

/**
 * "Start a count": what to count (the whole branch, one category or a shelf), whether the counter may see the expected
 * quantities, and a note. The branch is the one chosen at the top of the screen; the server snapshots the lines and the
 * person goes straight to the counting sheet.
 */
export function CountStart({ branchName, categories }: { branchName: string; categories: { id: string; name: string }[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [scope, setScope] = useState<Scope>('BRANCH');
  const [categoryId, setCategoryId] = useState('');
  const [location, setLocation] = useState('');
  const [blind, setBlind] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    setBusy(true);
    setProblem(null);
    const result = await settle(() =>
      openCount({
        scope,
        ...(scope === 'CATEGORY' ? { categoryId } : {}),
        ...(scope === 'LOCATION' ? { location } : {}),
        blind,
        note,
      }),
    );
    if (!result.ok) {
      setBusy(false);
      setProblem({ message: phMessage(t, locale, result.error, 'pharmacy.counts'), fields: describeFailure(t, locale, result.error).fields });
      return;
    }
    // The button stays disabled while the counting sheet opens: a second press would open a second count.
    router.push(`/pharmacy/stock/counts/${(result.data as { id: string }).id}`);
  };

  return (
    <form data-testid="count-start" onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3 sm:p-4">
      <h2 className="flex items-center gap-2 text-md font-semibold text-text">
        <ClipboardPlus aria-hidden className="size-5 shrink-0" />
        {t('pharmacy.counts.start.title')}
      </h2>
      <p className="text-sm text-muted" dir="auto">
        {t('pharmacy.counts.start.branch', { branch: branchName })}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('pharmacy.counts.start.scope')}>
          <Select
            className="[&_select]:min-h-11"
            value={scope}
            onChange={(event) => setScope(event.target.value as Scope)}
            options={(['BRANCH', 'CATEGORY', 'LOCATION'] as const).map((value) => ({ value, label: t(`pharmacy.counts.scope.${value}`) }))}
          />
        </Field>
        {scope === 'CATEGORY' && (
          <Field label={t('pharmacy.counts.start.category')} {...(problem?.fields.categoryId ? { error: problem.fields.categoryId } : {})}>
            <Select
              className="[&_select]:min-h-11"
              value={categoryId}
              required
              onChange={(event) => setCategoryId(event.target.value)}
              options={[{ value: '', label: t('pharmacy.counts.start.categoryChoose') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </Field>
        )}
        {scope === 'LOCATION' && (
          <Field label={t('pharmacy.counts.start.location')} hint={t('pharmacy.counts.start.locationHint')} {...(problem?.fields.location ? { error: problem.fields.location } : {})}>
            <Input className="min-h-11" dir="auto" maxLength={100} required autoComplete="off" value={location} onChange={(event) => setLocation(event.target.value)} />
          </Field>
        )}
      </div>
      <label className="inline-flex min-h-11 items-start gap-2.5 py-2 text-sm text-text">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={blind} onChange={(event) => setBlind(event.target.checked)} />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{t('pharmacy.counts.start.blind')}</span>
          <span className="text-muted">{t('pharmacy.counts.start.blindHelp')}</span>
        </span>
      </label>
      <Field label={t('pharmacy.counts.start.note')} optional {...(problem?.fields.note ? { error: problem.fields.note } : {})}>
        <Textarea dir="auto" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {problem && (
        <p role="alert" data-testid="count-start-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{problem.message}</span>
        </p>
      )}
      <div>
        <Button type="submit" size="lg" className="min-h-11" disabled={busy || !online}>
          {t('pharmacy.counts.start.submit')}
        </Button>
      </div>
    </form>
  );
}
