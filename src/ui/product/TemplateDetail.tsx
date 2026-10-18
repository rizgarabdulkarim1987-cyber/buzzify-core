'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { stageTone } from '@/lib/stage';
import type { DetailKind, OptionStyle } from '@/lib/templates/types';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { CloseIcon, HeartIcon, MinusIcon, PlusIcon } from '@/ui/Icons';
import { RollingMoney } from '@/ui/RollingMoney';
import { ProductStage } from '@/ui/stage/ProductStage';
import { useSuggestions } from '@/ui/useSuggestions';
import { OptionChoices } from './OptionChoices';
import { PairingList } from './PairingList';
import { Surface } from './Surface';
import { UpgradeOffers } from './UpgradeOffers';
import { useProductChoice, type ProductChoice } from './useProductChoice';

/**
 * A product opened from a template menu (spec 5, detail kinds): in a sheet, a drawer, a full page or a card, or walked
 * through one choice at a time (`steps`). Prices on screen mirror the server's; the cart always uses its quote. With
 * ordering off there is nothing to add: the details, sizes and options are shown for reading.
 */

export interface TemplateDetailProps {
  product: MenuProductView;
  kind: DetailKind;
  optionStyle: OptionStyle;
  canOrder: boolean;
  initialVariantId: string | null;
  favorite: boolean;
  onFavorite: () => void;
  /** Called once the surface has closed. */
  onClose: () => void;
  /** Opens another product in place (an upgrade to another dish, or a pairing that needs choices). */
  onSwitch: (productId: string) => void;
}

function Media({ product, kind, selectedIds }: { product: MenuProductView; kind: DetailKind; selectedIds: string[] }) {
  const staged = stageTone(product.media) !== null;
  const ratio = kind === 'page' ? 'aspect-[4/3] md:aspect-[16/9]' : kind === 'drawer' ? 'aspect-[4/3]' : 'aspect-[16/10]';
  if (staged) {
    return <ProductStage product={product} selectedIds={selectedIds} variant="sheet" testId="sheet-stage" posterSlug={`${product.slug}-detail`} className={`${ratio} w-full`} />;
  }
  return <ProductVisual media={product.media} name={product.name} slug={`${product.slug}-detail`} priority placeholder sizes="(min-width: 768px) 640px, 100vw" className={`${ratio} w-full`} />;
}

function Facts({ product }: { product: MenuProductView }) {
  const { t, locale, tenant } = useApp();
  return (
    <>
      {product.ingredients.length > 0 && (
        <section className="mt-8">
          <h3 className="tpl-display text-lg">{t('product.ingredients')}</h3>
          <p className="mt-1 text-(--muted)">{product.ingredients.join(', ')}</p>
        </section>
      )}
      {product.allergens.length > 0 && (
        <p className="mt-4 text-sm text-(--muted)">
          {t('product.allergens')}: {product.allergens.map((key) => t(`allergen.${key}`)).join(', ')}
        </p>
      )}
      {(product.dietary || product.calories !== undefined) && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-(--muted)" aria-label={t('menu.dietary.label')}>
          {product.dietary?.map((tag) => (
            <li key={tag}>{t(`menu.dietary.${tag}`)}</li>
          ))}
          {product.calories !== undefined && <li className="tabular-nums">{t('menu.calories', { count: formatCount(product.calories, locale, tenant.numeralSystem) })}</li>}
        </ul>
      )}
    </>
  );
}

/** Sizes, then each option group, in the template's option style. */
function Choices({ product, choice, style, only }: { product: MenuProductView; choice: ProductChoice; style: OptionStyle; only?: number }) {
  const { t } = useApp();
  const blocks: ReactNode[] = [];
  if (product.variants.length > 1) {
    const base = product.variants.find((variant) => variant.isDefault)?.priceDelta ?? 0;
    blocks.push(
      <OptionChoices
        key="sizes"
        style={style}
        title={t('product.size')}
        min={1}
        max={1}
        selected={choice.effectiveVariant ? [choice.effectiveVariant] : []}
        items={product.variants.map((variant) => ({ id: variant.id, name: variant.name, priceDelta: variant.priceDelta - base }))}
        onToggle={choice.chooseVariant}
      />,
    );
  }
  for (const group of product.groups) {
    blocks.push(
      <OptionChoices
        key={group.id}
        style={style}
        title={group.name}
        min={group.minSelect}
        max={group.maxSelect}
        selected={choice.selected}
        items={group.options.map((option) => ({ id: option.id, name: option.name, effect: option.effect, priceDelta: option.priceDelta, disabled: !option.isAvailable }))}
        onToggle={(id) => choice.toggle(group.id, id)}
      />,
    );
  }
  return <>{only === undefined ? blocks : blocks[only]}</>;
}

function Suggestions({ product, choice, onSwitch }: { product: MenuProductView; choice: ProductChoice; onSwitch: (id: string) => void }) {
  const { cart, dismissed, dismiss, addLine, announce, t } = useApp();
  const body = useMemo(
    () => ({ context: 'product' as const, product: { productId: product.id, variantId: choice.variantId, optionIds: choice.selected }, cart, dismissedIds: dismissed }),
    [product.id, choice.variantId, choice.selected, cart, dismissed],
  );
  const { data } = useSuggestions(choice.orderable ? body : null);
  return (
    <>
      <UpgradeOffers
        productId={product.id}
        offers={data?.upgrades ?? []}
        onAccept={(offer) => {
          const other = choice.accept(offer);
          if (other) onSwitch(other);
        }}
      />
      <PairingList
        offers={data?.pairings ?? []}
        onAdd={(offer) => {
          addLine({ productId: offer.productId, variantId: null, optionIds: [], quantity: 1 });
          track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
          announce(t('cart.added', { name: offer.name }));
        }}
        onChoose={(offer) => {
          track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
          onSwitch(offer.productId);
        }}
        onDismiss={(offer) => dismiss(offer.suggestionId)}
      />
    </>
  );
}

function AddBar({ product, choice, onAdded, label }: { product: MenuProductView; choice: ProductChoice; onAdded: () => void; label?: string }) {
  const { t, addLine, announce } = useApp();
  const add = () => {
    if (!choice.canAdd) return;
    addLine({ productId: product.id, variantId: choice.variantId, optionIds: choice.selected, quantity: choice.quantity });
    track('ADD_TO_CART', { productId: product.id, payload: { source: 'template-detail', options: choice.selected.length } });
    announce(t('cart.added', { name: product.name }));
    onAdded();
  };
  return (
    <div className="tpl-add-bar">
      {!choice.canAdd && choice.orderable && <p className="mb-3 text-sm text-(--accent-ink)">{t('product.makeChoices')}</p>}
      <div className="flex items-center gap-3">
        <div className="tpl-stepper" role="group" aria-label={t('product.quantity')}>
          <button type="button" aria-label={t('product.decrease')} onClick={() => choice.setQuantity((q) => Math.max(1, q - 1))} className="grid size-11 place-items-center">
            <MinusIcon />
          </button>
          <output className="min-w-6 text-center tabular-nums" aria-live="polite">
            {choice.quantity}
          </output>
          <button type="button" aria-label={t('product.increase')} onClick={() => choice.setQuantity((q) => Math.min(20, q + 1))} className="grid size-11 place-items-center">
            <PlusIcon />
          </button>
        </div>
        <button type="button" disabled={!choice.canAdd} onClick={add} className="tpl-button tpl-button-wide flex-1 justify-between">
          <span>{label ?? t('product.add')}</span>
          <RollingMoney value={choice.unit * choice.quantity} className="tabular-nums" />
        </button>
      </div>
    </div>
  );
}

function Header({ product, titleId, favorite, onFavorite }: { product: MenuProductView; titleId: string; favorite: boolean; onFavorite: () => void }) {
  const { t, money } = useApp();
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="tpl-detail-title tpl-display min-w-0">
          {product.name}
        </h2>
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={t(favorite ? 'tpl.removeFavorite' : 'tpl.addFavorite', { name: product.name })}
          onClick={onFavorite}
          className={`tpl-icon-button mt-1 shrink-0 ${favorite ? 'text-(--accent-ink)' : 'text-(--muted)'}`}
        >
          <HeartIcon filled={favorite} />
        </button>
      </div>
      {product.badges && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {product.badges.map((badge) => (
            <span key={badge} className="tpl-badge">
              {t(`menu.badge.${badge}`)}
            </span>
          ))}
        </p>
      )}
      {product.description && <p className="mt-2 max-w-prose leading-relaxed text-(--muted)">{product.description}</p>}
      <p className="mt-3 text-lg tabular-nums text-(--accent-ink)">{money(product.displayPrice)}</p>
      {product.orderState !== 'OK' && <p className="mt-2 text-(--accent-ink)">{t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable')}</p>}
    </>
  );
}

function CloseButton({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  const { t } = useApp();
  return (
    <button type="button" onClick={onClose} aria-label={t('product.close')} className={`tpl-icon-button tpl-float absolute end-3 top-3 z-[3] ${className}`}>
      <CloseIcon />
    </button>
  );
}

function Detail({ props, close }: { props: TemplateDetailProps; close: () => void }) {
  const { product, kind, optionStyle, canOrder, initialVariantId, favorite, onFavorite, onSwitch } = props;
  const choice = useProductChoice(product, initialVariantId);
  const titleId = `tpl-title-${product.slug}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative">
          <Media product={product} kind={kind} selectedIds={choice.selected} />
          <CloseButton onClose={close} />
        </div>
        <div className="tpl-detail-body">
          <Header product={product} titleId={titleId} favorite={favorite} onFavorite={onFavorite} />
          <Choices product={product} choice={choice} style={optionStyle} />
          {canOrder && choice.orderable && <Suggestions product={product} choice={choice} onSwitch={onSwitch} />}
          <Facts product={product} />
        </div>
      </div>
      {canOrder && <AddBar product={product} choice={choice} onAdded={close} />}
    </div>
  );
}

/** One choice at a time: sizes, then each group, then a summary to add from (a sundae builder). */
function Steps({ props, close }: { props: TemplateDetailProps; close: () => void }) {
  const { t, money } = useApp();
  const { product, optionStyle, canOrder, initialVariantId, favorite, onFavorite, onSwitch } = props;
  const choice = useProductChoice(product, initialVariantId);
  const total = (product.variants.length > 1 ? 1 : 0) + product.groups.length;
  const [step, setStep] = useState(0);
  const titleId = `tpl-title-${product.slug}`;
  const onSummary = step >= total;
  const groupIndex = step - (product.variants.length > 1 ? 1 : 0);
  const group = groupIndex >= 0 ? product.groups[groupIndex] : undefined;
  const blocked = group ? choice.missingIn(group) : false;

  const chosenNames = [
    ...(product.variants.length > 1 ? product.variants.filter((variant) => variant.id === choice.effectiveVariant).map((variant) => variant.name) : []),
    ...product.groups.flatMap((g) => g.options.filter((option) => choice.selected.includes(option.id)).map((option) => option.name)),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative">
          <Media product={product} kind="sheet" selectedIds={choice.selected} />
          <CloseButton onClose={close} />
        </div>
        <div className="tpl-detail-body">
          <Header product={product} titleId={titleId} favorite={favorite} onFavorite={onFavorite} />
          {total > 0 && (
            <>
              <ol className="tpl-steps mt-6" aria-label={t('tpl.step', { current: Math.min(step + 1, total + 1), total: total + 1 })}>
                {Array.from({ length: total + 1 }, (_, index) => (
                  <li key={index} data-state={index < step ? 'done' : index === step ? 'current' : 'next'} />
                ))}
              </ol>
              <p className="mt-2 text-sm text-(--muted)" aria-live="polite">
                {t('tpl.step', { current: Math.min(step + 1, total + 1), total: total + 1 })}
              </p>
              {!onSummary && <Choices product={product} choice={choice} style={optionStyle} only={step} />}
              {onSummary && (
                <section className="mt-6">
                  <h3 className="tpl-display text-lg">{t('tpl.summary')}</h3>
                  <p className="mt-1 text-(--muted)">{chosenNames.length > 0 ? chosenNames.join(' · ') : t('tpl.nothingChosen')}</p>
                  <p className="mt-2 tabular-nums text-(--accent-ink)">{money(choice.unit)}</p>
                </section>
              )}
              <div className="mt-6 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="tpl-button tpl-button-ghost disabled:opacity-40">
                  {t('tpl.previous')}
                </button>
                {!onSummary && (
                  <button type="button" onClick={() => setStep((s) => s + 1)} disabled={blocked} className="tpl-button disabled:opacity-40">
                    {t('tpl.next')}
                  </button>
                )}
              </div>
            </>
          )}
          {canOrder && choice.orderable && onSummary && <Suggestions product={product} choice={choice} onSwitch={onSwitch} />}
          <Facts product={product} />
        </div>
      </div>
      {canOrder && (onSummary || total === 0) && <AddBar product={product} choice={choice} onAdded={close} />}
    </div>
  );
}

/** The product in its surface. The surface stays mounted while the product changes in place. */
export function TemplateDetail(props: TemplateDetailProps) {
  return (
    <Surface kind={props.kind} labelledBy={`tpl-title-${props.product.slug}`} onClose={props.onClose}>
      {(close) => (props.kind === 'steps' ? <Steps key={props.product.id} props={props} close={close} /> : <Detail key={props.product.id} props={props} close={close} />)}
    </Surface>
  );
}

export default TemplateDetail;
