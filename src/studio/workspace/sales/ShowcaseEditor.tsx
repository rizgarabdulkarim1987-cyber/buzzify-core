'use client';

import { ArrowDown, ArrowUp, CalendarDays, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { deleteOccasion, deleteShowcaseCard, reorderShowcaseCards, saveOccasion, saveShowcaseCard } from '@/app/studio/_actions/sales';
import type { Locale } from '@/lib/locale';
import { formatPriceInput, parsePriceInput } from '@/lib/money-input';
import { localDate } from '@/server/domain/offers';
import { SHOWCASE_KINDS, SHOWCASE_SLOTS, type ShowcaseKind, type ShowcaseSlot } from '@/server/domain/showcase';
import type { SalesRules, ShowcaseHiddenReason } from '@/server/studio/services/sales';
import { formatDate } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import { formatMoney, PRICE_PROBLEM_KEYS, type Names } from '../content/shared';
import { TranslationFields } from '../content/TranslationFields';
import { ALL_DAYS, clock, minuteOf, PageIntro, RuleList, RuleRow, useNamer, useSave, WeekdayToggles, weekText } from './shared';

type Occasion = SalesRules['occasions'][number];
type Card = SalesRules['showcase'][number];
type Offer = SalesRules['offers'][number];

/** Why a card is not showing: the server's reasons, plus an offer whose first day is still ahead (read here). */
export type CardHidden = ShowcaseHiddenReason | 'OFFER_NOT_STARTED';

/**
 * What keeps a card from guests now. The server's reason wins; an offer card whose offer starts after `today` (the
 * menu's local date) is also held back, which the server's reasons leave out.
 */
export function cardHidden(card: Pick<Card, 'kind' | 'promotionId' | 'hiddenReason'>, offers: readonly Pick<Offer, 'id' | 'startsOn'>[], today: string): CardHidden | null {
  if (card.hiddenReason) return card.hiddenReason;
  if (card.kind !== 'OFFER') return null;
  const offer = offers.find((entry) => entry.id === card.promotionId);
  return offer?.startsOn && offer.startsOn > today ? 'OFFER_NOT_STARTED' : null;
}

/** Where an occasion stands on `today`: switched off, before its first day, on its dates, or past its last. */
export function occasionStatus(occasion: Pick<Occasion, 'isActive' | 'startsOn' | 'endsOn'>, today: string): 'off' | 'upcoming' | 'live' | 'ended' {
  if (!occasion.isActive) return 'off';
  if (today < occasion.startsOn) return 'upcoming';
  if (today > occasion.endsOn) return 'ended';
  return 'live';
}

interface OccasionDraft {
  occasionId?: string;
  version?: number;
  names: Names;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
}

interface CardDraft {
  cardId?: string;
  version?: number;
  slot: ShowcaseSlot;
  kind: ShowcaseKind;
  occasionId: string;
  promotionId: string;
  bundleId: string;
  price: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number;
  title: Names;
  text: Names;
  isActive: boolean;
}

/** The card as the server takes it back, for a save that changes only its switch. */
const cardInput = (card: Card) => ({
  cardId: card.id,
  version: card.version,
  slot: card.slot,
  kind: card.kind,
  occasionId: card.occasionId,
  promotionId: card.promotionId,
  bundleId: card.bundleId,
  price: card.price,
  startMinute: card.startMinute,
  endMinute: card.endMinute,
  daysOfWeek: card.daysOfWeek,
  title: card.title,
  text: card.text,
  isActive: card.isActive,
});

/**
 * The Showcase page: cards in two strips on the guest menu, above and below the search (a special offer, a set or a
 * package for N, or an open buffet), each of which may hang on a dated occasion such as Eid.
 */
/** `canEdit`: the person holds `content.edit`, which every showcase action needs; without it the page only lists. */
export function ShowcaseEditor({ menuId, rules, canEdit }: { menuId: string; rules: SalesRules; canEdit: boolean }) {
  const readOnly = !canEdit;
  const t = useT();
  const { locale } = useLocale();
  const name = useNamer(rules.defaultLocale);
  const { pending, errors, setErrors, save } = useSave();
  const [occasionDraft, setOccasionDraft] = useState<OccasionDraft | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null);
  const [deletingOccasion, setDeletingOccasion] = useState<Occasion | null>(null);
  const [deletingCard, setDeletingCard] = useState<Card | null>(null);
  const today = localDate(new Date(), rules.timeZone);
  const date = (value: string) => formatDate(`${value}T12:00:00Z`, locale);
  const money = (minor: number) => formatMoney(minor, rules.currency, locale);
  const locales = rules.locales as Locale[];

  const offerState = (offer: Offer): string | null =>
    !offer.isActive ? 'off' : offer.ended ? 'ended' : offer.startsOn && offer.startsOn > today ? 'notStarted' : null;
  const offerLabel = (offer: Offer) => {
    const state = offerState(offer);
    return state ? t('sales.showcase.marked', { name: name(offer.title), state: t(`sales.showcase.mark.${state}`) }) : name(offer.title);
  };
  const setLabel = (set: SalesRules['sets'][number]) => {
    const label = set.people ? `${name(set.names)} · ${t('sales.sets.forPeople', { n: set.people })}` : name(set.names);
    return set.isActive ? label : t('sales.showcase.marked', { name: label, state: t('sales.showcase.mark.off') });
  };

  const cardName = (card: Card) => {
    const own = name(card.title);
    if (own) return own;
    if (card.kind === 'OFFER') {
      const offer = rules.offers.find((entry) => entry.id === card.promotionId);
      return offer ? name(offer.title) : t('sales.showcase.missing');
    }
    const set = rules.sets.find((entry) => entry.id === card.bundleId);
    return set ? name(set.names) : t('sales.showcase.missing');
  };
  const cardDetails = (card: Card) => {
    const occasion = rules.occasions.find((entry) => entry.id === card.occasionId);
    const set = card.kind === 'SET' ? rules.sets.find((entry) => entry.id === card.bundleId) : undefined;
    const kindDetail =
      card.kind === 'BUFFET'
        ? [card.price === null ? '' : t('sales.showcase.perPerson', { price: money(card.price) }), weekText(t, card)].filter(Boolean).join(' · ')
        : set?.people
          ? t('sales.sets.forPeople', { n: set.people })
          : '';
    return [occasion ? t('sales.showcase.during', { name: name(occasion.names) }) : '', kindDetail].filter(Boolean).join(' · ');
  };

  const openOccasion = (next: OccasionDraft) => {
    setErrors({});
    setOccasionDraft(next);
  };
  const changeOccasion = (patch: Partial<OccasionDraft>) => setOccasionDraft((current) => (current ? { ...current, ...patch } : current));
  const openCard = (next: CardDraft) => {
    setErrors({});
    setCardDraft(next);
  };
  const changeCard = (patch: Partial<CardDraft>) => setCardDraft((current) => (current ? { ...current, ...patch } : current));
  const blankCard = (slot: ShowcaseSlot): CardDraft => ({
    slot,
    kind: 'OFFER',
    occasionId: '',
    promotionId: '',
    bundleId: '',
    price: '',
    startTime: '',
    endTime: '',
    daysOfWeek: ALL_DAYS,
    title: {},
    text: {},
    isActive: true,
  });
  const draftOf = (card: Card): CardDraft => ({
    cardId: card.id,
    version: card.version,
    slot: card.slot,
    kind: card.kind,
    occasionId: card.occasionId ?? '',
    promotionId: card.promotionId ?? '',
    bundleId: card.bundleId ?? '',
    price: card.price === null ? '' : formatPriceInput(card.price, rules.currency),
    startTime: clock(card.startMinute),
    endTime: clock(card.endMinute),
    daysOfWeek: card.daysOfWeek,
    title: card.title,
    text: card.text,
    isActive: card.isActive,
  });

  const submitOccasion = () => {
    if (!occasionDraft) return;
    const { occasionId, version, names, startsOn, endsOn, isActive } = occasionDraft;
    void save(
      () => saveOccasion({ menuId, ...(occasionId ? { occasionId, version } : {}), names, startsOn, endsOn, isActive }),
      () => setOccasionDraft(null),
    );
  };

  const submitCard = () => {
    if (!cardDraft) return;
    const buffet = cardDraft.kind === 'BUFFET';
    let price: number | null = null;
    if (buffet) {
      const parsed = parsePriceInput(cardDraft.price, rules.currency);
      if (!parsed.ok) {
        setErrors({ price: t(PRICE_PROBLEM_KEYS[parsed.reason]) });
        return;
      }
      price = parsed.minor;
    }
    const { cardId, version, slot, kind, title, text, isActive } = cardDraft;
    void save(
      () =>
        saveShowcaseCard({
          menuId,
          ...(cardId ? { cardId, version } : {}),
          slot,
          kind,
          occasionId: cardDraft.occasionId || null,
          promotionId: kind === 'OFFER' ? cardDraft.promotionId || null : null,
          bundleId: kind === 'SET' ? cardDraft.bundleId || null : null,
          price,
          startMinute: buffet ? minuteOf(cardDraft.startTime) : null,
          endMinute: buffet ? minuteOf(cardDraft.endTime) : null,
          daysOfWeek: buffet ? cardDraft.daysOfWeek : ALL_DAYS,
          title,
          text,
          isActive,
        }),
      () => setCardDraft(null),
    );
  };

  const move = (cards: Card[], index: number, by: -1 | 1) => {
    const order = cards.map((card) => card.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved!);
    void save(() => reorderShowcaseCards({ menuId, slot: cards[0]!.slot, order }), undefined, t('sales.showcase.reordered'));
  };

  return (
    <div className="flex flex-col gap-8">
      <PageIntro title={t('sales.showcase.title')} body={t('sales.showcase.intro')} />

      <Section
        title={t('sales.showcase.occasions')}
        hint={t('sales.showcase.occasionsHint')}
        action={
          !readOnly && (
            <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => openOccasion({ names: {}, startsOn: today, endsOn: today, isActive: true })}>
              {t('sales.showcase.addOccasion')}
            </Button>
          )
        }
      >
        {rules.occasions.length === 0 ? (
          <EmptyState icon={<CalendarDays aria-hidden />} title={t('sales.showcase.occasionsEmpty')} />
        ) : (
          <RuleList label={t('sales.showcase.occasions')}>
            {rules.occasions.map((occasion) => {
              const status = occasionStatus(occasion, today);
              return (
                <RuleRow
                  key={occasion.id}
                  title={name(occasion.names)}
                  details={t('sales.showcase.occasion.dates', { from: date(occasion.startsOn), to: date(occasion.endsOn) })}
                  isActive={occasion.isActive}
                  stateLabel={status === 'off' ? undefined : t(`sales.showcase.status.${status}`)}
                  stateTone={status === 'live' ? 'success' : 'neutral'}
                  editLabel={t('sales.showcase.occasion.editOne', { name: name(occasion.names) })}
                  deleteLabel={t('sales.showcase.occasion.deleteOne', { name: name(occasion.names) })}
                  onEdit={() =>
                    openOccasion({ occasionId: occasion.id, version: occasion.version, names: occasion.names, startsOn: occasion.startsOn, endsOn: occasion.endsOn, isActive: occasion.isActive })
                  }
                  onDelete={() => setDeletingOccasion(occasion)}
                  readOnly={readOnly}
                />
              );
            })}
          </RuleList>
        )}
      </Section>

      {SHOWCASE_SLOTS.map((slot) => {
        const cards = rules.showcase.filter((card) => card.slot === slot).sort((x, y) => x.sortOrder - y.sortOrder);
        const slotLabel = t(`sales.showcase.slot.${slot}`);
        return (
          <Section
            key={slot}
            title={slotLabel}
            hint={t(`sales.showcase.slotHint.${slot}`)}
            action={
              !readOnly && (
                <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} aria-label={t('sales.showcase.addCardTo', { slot: slotLabel })} onClick={() => openCard(blankCard(slot))}>
                  {t('sales.showcase.addCard')}
                </Button>
              )
            }
          >
            {cards.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('sales.showcase.slotEmpty')}</p>
            ) : (
              <RuleList label={slotLabel}>
                {cards.map((card, index) => {
                  const label = cardName(card);
                  const hidden = cardHidden(card, rules.offers, today);
                  return (
                    <RuleRow
                      key={card.id}
                      title={
                        <span className="inline-flex max-w-full flex-wrap items-center gap-2">
                          {/* A long unbroken title (a URL, a word with no spaces) wraps instead of widening the page. */}
                          <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                          <span className="text-xs font-normal text-muted">{t(`sales.showcase.kind.${card.kind}`)}</span>
                        </span>
                      }
                      details={cardDetails(card)}
                      isActive={card.isActive}
                      stateLabel={card.isActive && hidden ? t(`sales.showcase.hidden.${hidden}`) : undefined}
                      editLabel={t('sales.showcase.editOne', { name: label })}
                      deleteLabel={t('sales.showcase.deleteOne', { name: label })}
                      onEdit={() => openCard(draftOf(card))}
                      onDelete={() => setDeletingCard(card)}
                      readOnly={readOnly}
                      extra={
                        <span className="flex items-center gap-1">
                          <Switch
                            aria-label={t('sales.showcase.showOne', { name: label })}
                            checked={card.isActive}
                            disabled={pending || readOnly}
                            onCheckedChange={(isActive) => void save(() => saveShowcaseCard({ menuId, ...cardInput(card), isActive }), undefined, undefined, { inline: false })}
                          />
                          {!readOnly && cards.length > 1 && (
                            <span className="flex items-center">
                              <IconButton
                                label={t('sales.showcase.moveUp', { name: label })}
                                icon={<ArrowUp aria-hidden />}
                                size="sm"
                                disabled={index === 0 || pending}
                                onClick={() => move(cards, index, -1)}
                              />
                              <IconButton
                                label={t('sales.showcase.moveDown', { name: label })}
                                icon={<ArrowDown aria-hidden />}
                                size="sm"
                                disabled={index === cards.length - 1 || pending}
                                onClick={() => move(cards, index, 1)}
                              />
                            </span>
                          )}
                        </span>
                      }
                    />
                  );
                })}
              </RuleList>
            )}
          </Section>
        );
      })}

      <Dialog
        open={occasionDraft !== null}
        onOpenChange={(next) => !next && setOccasionDraft(null)}
        title={occasionDraft?.occasionId ? t('sales.showcase.occasion.editTitle') : t('sales.showcase.occasion.addTitle')}
        description={t('sales.showcase.occasion.dialogIntro', { zone: rules.timeZone })}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOccasionDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submitOccasion} disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {occasionDraft && (
          <div className="flex flex-col gap-4">
            <TranslationFields label={t('sales.showcase.occasion.name')} locales={locales} values={occasionDraft.names} maxLength={120} onChange={(names) => changeOccasion({ names })} />
            {errors.names && <p className="-mt-2 text-sm text-danger">{errors.names}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sales.showcase.occasion.startsOn')} error={errors.startsOn}>
                <Input type="date" value={occasionDraft.startsOn} dir="ltr" onChange={(event) => changeOccasion({ startsOn: event.target.value })} />
              </Field>
              <Field label={t('sales.showcase.occasion.endsOn')} error={errors.endsOn}>
                <Input type="date" value={occasionDraft.endsOn} dir="ltr" onChange={(event) => changeOccasion({ endsOn: event.target.value })} />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">{t('sales.active')}</span>
              <Switch aria-label={t('sales.active')} checked={occasionDraft.isActive} onCheckedChange={(isActive) => changeOccasion({ isActive })} />
            </label>
          </div>
        )}
      </Dialog>

      <Dialog
        open={cardDraft !== null}
        onOpenChange={(next) => !next && setCardDraft(null)}
        title={cardDraft?.cardId ? t('sales.showcase.editTitle') : t('sales.showcase.addTitle')}
        description={t('sales.showcase.dialogIntro', { zone: rules.timeZone })}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCardDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submitCard} disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {cardDraft && (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text">{t('sales.showcase.kind')}</legend>
              <div role="radiogroup" aria-label={t('sales.showcase.kind')} className="inline-flex w-fit flex-wrap rounded-md border border-line p-0.5">
                {SHOWCASE_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={cardDraft.kind === kind}
                    onClick={() => changeCard({ kind })}
                    className={cx('h-7 rounded-sm px-3 text-sm transition-colors', cardDraft.kind === kind ? 'bg-text text-bg' : 'text-muted hover:text-text')}
                  >
                    {t(`sales.showcase.kind.${kind}`)}
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted">{t(`sales.showcase.kindHint.${cardDraft.kind}`)}</p>
            </fieldset>

            {cardDraft.kind === 'OFFER' && (
              <Field label={t('sales.showcase.offer')} hint={rules.offers.length === 0 ? t('sales.showcase.noOffers') : undefined} error={errors.promotionId}>
                <Select
                  options={[{ value: '', label: t('sales.showcase.chooseOffer'), disabled: true }, ...rules.offers.map((offer) => ({ value: offer.id, label: offerLabel(offer) }))]}
                  value={cardDraft.promotionId}
                  onChange={(event) => changeCard({ promotionId: event.target.value })}
                />
              </Field>
            )}
            {cardDraft.kind === 'SET' && (
              <Field label={t('sales.showcase.set')} hint={rules.sets.length === 0 ? t('sales.showcase.noSets') : undefined} error={errors.bundleId}>
                <Select
                  options={[{ value: '', label: t('sales.showcase.chooseSet'), disabled: true }, ...rules.sets.map((set) => ({ value: set.id, label: setLabel(set) }))]}
                  value={cardDraft.bundleId}
                  onChange={(event) => changeCard({ bundleId: event.target.value })}
                />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sales.showcase.slot')} error={errors.slot}>
                <Select
                  options={SHOWCASE_SLOTS.map((slot) => ({ value: slot, label: t(`sales.showcase.slot.${slot}`) }))}
                  value={cardDraft.slot}
                  onChange={(event) => changeCard({ slot: event.target.value as ShowcaseSlot })}
                />
              </Field>
              <Field label={t('sales.showcase.occasion')} error={errors.occasionId} optional>
                <Select
                  options={[{ value: '', label: t('sales.showcase.noOccasion') }, ...rules.occasions.map((occasion) => ({ value: occasion.id, label: name(occasion.names) }))]}
                  value={cardDraft.occasionId}
                  onChange={(event) => changeCard({ occasionId: event.target.value })}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-1.5">
              <TranslationFields label={t('sales.showcase.titleField')} locales={locales} values={cardDraft.title} maxLength={120} onChange={(title) => changeCard({ title })} />
              {errors.title ? (
                <p className="text-sm text-danger">{errors.title}</p>
              ) : (
                cardDraft.kind !== 'BUFFET' && <p className="text-sm text-muted">{t('sales.showcase.titleOptional')}</p>
              )}
            </div>
            <TranslationFields label={t('sales.showcase.text')} locales={locales} values={cardDraft.text} maxLength={120} onChange={(text) => changeCard({ text })} />

            {cardDraft.kind === 'BUFFET' && (
              <>
                <Field label={t('sales.showcase.price')} hint={rules.currency} error={errors.price} className="sm:max-w-xs">
                  <Input value={cardDraft.price} inputMode="decimal" dir="ltr" onChange={(event) => changeCard({ price: event.target.value })} className="tabular-nums" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('sales.offers.startTime')} hint={t('sales.offers.timeHint')} error={errors.startMinute} optional>
                    <Input type="time" value={cardDraft.startTime} dir="ltr" onChange={(event) => changeCard({ startTime: event.target.value })} />
                  </Field>
                  <Field label={t('sales.offers.endTime')} error={errors.endMinute} optional>
                    <Input type="time" value={cardDraft.endTime} dir="ltr" onChange={(event) => changeCard({ endTime: event.target.value })} />
                  </Field>
                </div>
                <WeekdayToggles value={cardDraft.daysOfWeek} onChange={(daysOfWeek) => changeCard({ daysOfWeek })} error={errors.daysOfWeek} />
              </>
            )}

            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">{t('sales.active')}</span>
              <Switch aria-label={t('sales.active')} checked={cardDraft.isActive} onCheckedChange={(isActive) => changeCard({ isActive })} />
            </label>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={deletingOccasion !== null}
        onOpenChange={(next) => !next && setDeletingOccasion(null)}
        title={t('sales.showcase.occasion.deleteTitle')}
        body={deletingOccasion ? t('sales.showcase.occasion.deleteBody', { name: name(deletingOccasion.names) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deletingOccasion) return true;
          const ok = await save(
            () => deleteOccasion({ menuId, occasionId: deletingOccasion.id, version: deletingOccasion.version }),
            () => setDeletingOccasion(null),
            t('sales.deleted'),
          );
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
      <ConfirmDialog
        open={deletingCard !== null}
        onOpenChange={(next) => !next && setDeletingCard(null)}
        title={t('sales.showcase.deleteTitle')}
        body={deletingCard ? t('sales.showcase.deleteBody', { name: cardName(deletingCard) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deletingCard) return true;
          const ok = await save(() => deleteShowcaseCard({ menuId, cardId: deletingCard.id, version: deletingCard.version }), () => setDeletingCard(null), t('sales.deleted'));
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
    </div>
  );
}

/** One part of the page: its heading, what it is for, its add button, and its list. */
function Section({ title, hint, action, children }: { title: string; hint: string; action: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex max-w-[65ch] flex-col gap-0.5">
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="text-sm text-muted">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
