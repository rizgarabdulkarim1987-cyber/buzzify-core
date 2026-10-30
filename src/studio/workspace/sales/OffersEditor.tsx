'use client';

import { ArrowDown, ArrowUp, Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { deleteOffer, reorderOffers, saveOffer } from '@/app/studio/_actions/sales';
import type { Locale } from '@/lib/locale';
import type { PromotionKind } from '@/server/domain/types';
import { formatDate } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Switch } from '@/studio/ui/Switch';
import type { Names } from '../content/shared';
import { TranslationFields } from '../content/TranslationFields';
import { ALL_DAYS, clock, Locked, minuteOf, PageIntro, RuleList, RuleRow, useNamer, useSave, WeekdayToggles, weekText, type RulesView } from './shared';

type Offer = RulesView['offers'][number];

interface OfferDraft {
  offerId?: string;
  version?: number;
  kind: PromotionKind;
  percent: string;
  productIds: string[];
  categoryIds: string[];
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number;
  title: Names;
  text: Names;
  isActive: boolean;
}

/** Western digits for Arabic-Indic and Persian ones, so a number typed on an Arabic keyboard reads. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

const blank = (): OfferDraft => ({
  kind: 'DISCOUNT',
  percent: '20',
  productIds: [],
  categoryIds: [],
  startsOn: '',
  endsOn: '',
  startTime: '',
  endTime: '',
  daysOfWeek: ALL_DAYS,
  title: {},
  text: {},
  isActive: true,
});

const draftOf = (offer: Offer): OfferDraft => ({
  offerId: offer.id,
  version: offer.version,
  kind: offer.kind,
  percent: offer.percentOff === null ? '' : String(offer.percentOff),
  productIds: offer.productIds,
  categoryIds: offer.categoryIds,
  startsOn: offer.startsOn ?? '',
  endsOn: offer.endsOn ?? '',
  startTime: clock(offer.startMinute),
  endTime: clock(offer.endMinute),
  daysOfWeek: offer.daysOfWeek,
  title: offer.title,
  text: offer.text,
  isActive: offer.isActive,
});

/**
 * The Offers page: today's special or a limited-time dish (a highlight that changes no price), or a percentage off
 * while it is live (a happy hour), on chosen dishes or whole categories, on dates, hours and days of the week.
 */
export function OffersEditor({ menuId, rules, canPrice }: { menuId: string; rules: RulesView; canPrice: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const name = useNamer(rules.defaultLocale);
  const { pending, errors, setErrors, save } = useSave();
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [deleting, setDeleting] = useState<Offer | null>(null);
  const readOnly = !rules.upgrade.allowed.includes('selling.offers');
  const dish = (id: string) => name(rules.products.find((product) => product.id === id)?.names ?? {});
  const category = (id: string) => name(rules.categories.find((entry) => entry.id === id)?.names ?? {});

  const open = (next: OfferDraft) => {
    setErrors({});
    setDraft(next);
  };
  const change = (patch: Partial<OfferDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((entry) => entry !== id));

  const schedule = (offer: Pick<Offer, 'startsOn' | 'endsOn' | 'startMinute' | 'endMinute' | 'daysOfWeek'>) => {
    const date = (value: string) => formatDate(`${value}T12:00:00Z`, locale);
    const dates =
      offer.startsOn && offer.endsOn
        ? t('sales.offers.between', { from: date(offer.startsOn), to: date(offer.endsOn) })
        : offer.startsOn
          ? t('sales.offers.from', { date: date(offer.startsOn) })
          : offer.endsOn
            ? t('sales.offers.until', { date: date(offer.endsOn) })
            : '';
    return [weekText(t, offer), dates].filter(Boolean).join(' · ');
  };
  const targets = (offer: Pick<Offer, 'productIds' | 'categoryIds'>) =>
    [...offer.categoryIds.map((id) => t('sales.offers.allOf', { category: category(id) })), ...offer.productIds.map(dish)].join(', ');

  const submit = () => {
    if (!draft) return;
    const typed = latinDigits(draft.percent.trim());
    const percent = draft.kind === 'DISCOUNT' ? (/^\d{1,2}$/.test(typed) ? Number(typed) : Number.NaN) : null;
    if (percent !== null && Number.isNaN(percent)) {
      setErrors({ percentOff: t('sales.offers.percentRange') });
      return;
    }
    const { offerId, version, kind, productIds, categoryIds, daysOfWeek, title, text, isActive } = draft;
    void save(
      () =>
        saveOffer({
          menuId,
          ...(offerId ? { offerId, version } : {}),
          kind,
          percentOff: percent,
          productIds,
          categoryIds,
          startsOn: draft.startsOn || null,
          endsOn: draft.endsOn || null,
          startMinute: minuteOf(draft.startTime),
          endMinute: minuteOf(draft.endTime),
          daysOfWeek,
          title,
          text,
          isActive,
        }),
      () => setDraft(null),
    );
  };

  const move = (index: number, by: -1 | 1) => {
    const order = rules.offers.map((offer) => offer.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved!);
    void save(() => reorderOffers({ menuId, order }), undefined, t('sales.offers.reordered'));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        title={t('sales.offers.title')}
        body={t('sales.offers.intro')}
        action={
          !readOnly && (
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => open({ ...blank(), kind: canPrice ? 'DISCOUNT' : 'SPECIAL', percent: canPrice ? '20' : '' })}>
              {t('sales.offers.add')}
            </Button>
          )
        }
      />
      <Locked feature="selling.offers" upgrade={rules.upgrade} />

      {rules.offers.length === 0 ? (
        <EmptyState icon={<Tag aria-hidden />} title={t('sales.offers.emptyTitle')} body={t('sales.offers.emptyBody')} />
      ) : (
        <RuleList label={t('sales.offers.title')}>
          {rules.offers.map((offer, index) => (
            <RuleRow
              key={offer.id}
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {name(offer.title)}
                  <StatusBadge tone="ink">{offer.kind === 'DISCOUNT' ? t('sales.offers.percentOff', { percent: offer.percentOff ?? 0 }) : t('sales.offers.kind.SPECIAL')}</StatusBadge>
                </span>
              }
              details={
                <>
                  <span className="block">{targets(offer)}</span>
                  <span className="block">{schedule(offer)}</span>
                </>
              }
              isActive={offer.isActive}
              stateLabel={offer.isActive && offer.ended ? t('sales.offers.ended') : undefined}
              editLabel={t('sales.offers.editOne', { name: name(offer.title) })}
              deleteLabel={t('sales.offers.deleteOne', { name: name(offer.title) })}
              onEdit={() => open(draftOf(offer))}
              onDelete={() => setDeleting(offer)}
              readOnly={readOnly}
              extra={
                !readOnly &&
                rules.offers.length > 1 && (
                  <span className="flex items-center">
                    <IconButton label={t('sales.offers.moveUp', { name: name(offer.title) })} icon={<ArrowUp aria-hidden />} size="sm" disabled={index === 0 || pending} onClick={() => move(index, -1)} />
                    <IconButton
                      label={t('sales.offers.moveDown', { name: name(offer.title) })}
                      icon={<ArrowDown aria-hidden />}
                      size="sm"
                      disabled={index === rules.offers.length - 1 || pending}
                      onClick={() => move(index, 1)}
                    />
                  </span>
                )
              }
            />
          ))}
        </RuleList>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.offerId ? t('sales.offers.editTitle') : t('sales.offers.addTitle')}
        description={t('sales.offers.dialogIntro', { zone: rules.timeZone })}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text">{t('sales.offers.kind')}</legend>
              <div role="radiogroup" aria-label={t('sales.offers.kind')} className="inline-flex w-fit rounded-md border border-line p-0.5">
                {(['DISCOUNT', 'SPECIAL'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === kind}
                    disabled={kind === 'DISCOUNT' && !canPrice}
                    onClick={() => change({ kind, percent: kind === 'DISCOUNT' ? draft.percent || '20' : '' })}
                    className={cx(
                      'h-7 rounded-sm px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                      draft.kind === kind ? 'bg-text text-bg' : 'text-muted hover:text-text',
                    )}
                  >
                    {t(`sales.offers.kind.${kind}`)}
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted">{t(`sales.offers.kindHint.${draft.kind}`)}</p>
              {draft.kind === 'DISCOUNT' && (
                <Field label={t('sales.offers.percent')} hint={t('sales.offers.percentHint')} error={errors.percentOff} className="max-w-xs">
                  <Input value={draft.percent} inputMode="numeric" dir="ltr" onChange={(event) => change({ percent: event.target.value })} className="tabular-nums" />
                </Field>
              )}
            </fieldset>

            <TranslationFields label={t('sales.offers.titleField')} locales={rules.locales as Locale[]} values={draft.title} maxLength={120} onChange={(title) => change({ title })} />
            {errors.title && <p className="-mt-3 text-sm text-danger">{errors.title}</p>}
            <TranslationFields label={t('sales.offers.text')} locales={rules.locales as Locale[]} values={draft.text} maxLength={120} onChange={(text) => change({ text })} />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text">{t('sales.offers.targets')}</legend>
              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-md border border-line bg-surface p-3">
                {rules.categories.map((entry) => {
                  const wholeCategory = draft.categoryIds.includes(entry.id);
                  const inCategory = rules.products.filter((product) => product.categoryId === entry.id);
                  return (
                    <div key={entry.id} className="flex flex-col gap-1.5">
                      <Checkbox
                        label={t('sales.offers.allOf', { category: name(entry.names) })}
                        checked={wholeCategory}
                        onChange={(event) => change({ categoryIds: toggle(draft.categoryIds, entry.id, event.target.checked) })}
                      />
                      <div className="flex flex-col gap-1.5 ps-6">
                        {inCategory.map((product) => (
                          <Checkbox
                            key={product.id}
                            label={name(product.names)}
                            disabled={wholeCategory}
                            checked={wholeCategory || draft.productIds.includes(product.id)}
                            onChange={(event) => change({ productIds: toggle(draft.productIds, product.id, event.target.checked) })}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {errors.productIds && <p className="text-sm text-danger">{errors.productIds}</p>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sales.offers.startsOn')} error={errors.startsOn} optional>
                <Input type="date" value={draft.startsOn} dir="ltr" onChange={(event) => change({ startsOn: event.target.value })} />
              </Field>
              <Field label={t('sales.offers.endsOn')} error={errors.endsOn} optional>
                <Input type="date" value={draft.endsOn} dir="ltr" onChange={(event) => change({ endsOn: event.target.value })} />
              </Field>
              <Field label={t('sales.offers.startTime')} hint={t('sales.offers.timeHint')} error={errors.startMinute} optional>
                <Input type="time" value={draft.startTime} dir="ltr" onChange={(event) => change({ startTime: event.target.value })} />
              </Field>
              <Field label={t('sales.offers.endTime')} error={errors.endMinute} optional>
                <Input type="time" value={draft.endTime} dir="ltr" onChange={(event) => change({ endTime: event.target.value })} />
              </Field>
            </div>

            <WeekdayToggles value={draft.daysOfWeek} onChange={(daysOfWeek) => change({ daysOfWeek })} error={errors.daysOfWeek} />

            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">{t('sales.active')}</span>
              <Switch aria-label={t('sales.active')} checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
            </label>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('sales.offers.deleteTitle')}
        body={deleting ? t('sales.offers.deleteBody', { name: name(deleting.title) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deleting) return true;
          const ok = await save(() => deleteOffer({ menuId, offerId: deleting.id, version: deleting.version }), () => setDeleting(null), t('sales.deleted'));
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
    </div>
  );
}
