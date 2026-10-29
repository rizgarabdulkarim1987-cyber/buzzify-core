import { CircleAlert, ShieldAlert, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { TransferActions } from '@/app/pharmacy/_ui/TransferActions';
import { actionFor, detailControls } from '@/app/pharmacy/_ui/transfers-logic';
import { Route, TransferStatusChip, TurnChip } from '@/app/pharmacy/_ui/transfers-parts';
import { formatNumber } from '@/lib/pos-format';
import { formatExpiry, utcToday } from '@/server/domain/pharmacy/expiry';
import { get } from '@/server/pharmacy/queries/transfers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../../catalog/access';
import { transfersGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.transfers.title') };
}

/**
 * One transfer: header and state, the request lines against what was sent per batch (lot, expiry), what is still in transit,
 * after the receipt the differences per line, and the actions its state and the person's branch allow. History is dates only.
 * A person with neither end gets the not-found page (the scoped read finds nothing).
 */
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, transfersGate('pharmacy.transfers.title', { href: '/pharmacy/stock/transfers', labelKey: 'pharmacy.transfers.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale, reach } = g;
  const tr = await query(get, { ...access.placeInput, transferId: id });
  const controls = detailControls(tr, {
    reach,
    writable: g.writable.ok,
    placeBranchId: access.place.branchId,
    perms: { override: roleMay(access.actor, 'batch.override'), reportView: roleMay(access.actor, 'report.view') },
  });
  const turn = actionFor(tr, reach);
  const closed = tr.status === 'RECEIVED' || tr.status === 'PARTIAL';
  const sentOf = (lineId: string) => tr.sentLines.filter((s) => s.requestLineId === lineId);
  const totals = tr.sentLines.reduce(
    (sum, s) => ({ sent: sum.sent + s.sentQty, received: sum.received + s.receivedQty, damaged: sum.damaged + s.damagedQty, lost: sum.lost + s.lostQty, transit: sum.transit + s.inTransitQty }),
    { sent: 0, received: 0, damaged: 0, lost: 0, transit: 0 },
  );
  const date = (iso: string | null) => (iso ? <bdi dir="ltr">{phDate(iso, locale)}</bdi> : null);
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={tr.number ? t('pharmacy.transfers.viewTitle', { number: tr.number }) : t('pharmacy.transfers.title')} />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8" data-testid="transfer-view">
        {g.writeNotice}
        <OfflineNotice />
        {turn && (
          <p role="status" data-testid="transfer-turn" className="flex items-start gap-2.5 rounded-md border border-ink bg-raised px-3 py-2.5 text-sm font-medium text-text">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t(`pharmacy.transfers.turn.${turn}.body`, { from: tr.fromBranchName, to: tr.toBranchName })}</span>
          </p>
        )}
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.receive.col.status')}</dt>
            <dd data-testid="transfer-status" className="flex flex-wrap items-center gap-1.5">
              <TransferStatusChip status={tr.status} t={t} />
              {turn && <TurnChip action={turn} t={t} />}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.transfers.route')}</dt>
            <dd className="min-w-0 text-text">
              <Route from={tr.fromBranchName} to={tr.toBranchName} />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.transfers.requestedOn')}</dt>
            <dd className="text-text">{date(tr.requestedAt)}</dd>
          </div>
          {tr.sentAt && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted">{t('pharmacy.transfers.sentOn')}</dt>
              <dd className="text-text">{date(tr.sentAt)}</dd>
            </div>
          )}
          {tr.receivedAt && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted">{t('pharmacy.transfers.receivedOn')}</dt>
              <dd className="text-text">{date(tr.receivedAt)}</dd>
            </div>
          )}
          {tr.cancelledAt && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted">{t('pharmacy.transfers.cancelledOn')}</dt>
              <dd className="text-text">{date(tr.cancelledAt)}</dd>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.receive.col.lines')}</dt>
            <dd className="text-text tabular-nums">{formatNumber(tr.lineCount)}</dd>
          </div>
          {tr.note && (
            <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
              <dt className="text-muted">{t('pharmacy.transfers.editor.note')}</dt>
              <dd dir="auto" className="min-w-0 whitespace-pre-line break-words text-text [overflow-wrap:anywhere]">
                {tr.note}
              </dd>
            </div>
          )}
        </dl>

        {tr.status === 'SENT' && (
          <p data-testid="transfer-in-transit" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Truck aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.transfers.inTransit', { qty: formatNumber(totals.transit), from: tr.fromBranchName, to: tr.toBranchName })}</span>
          </p>
        )}

        <TransferActions
          userId={access.actor.userId}
          restaurantId={access.placeInput.restaurantId}
          transfer={{ id: tr.id, version: tr.version, status: tr.status, fromBranchId: tr.fromBranchId, toBranchId: tr.toBranchId, fromBranchName: tr.fromBranchName, toBranchName: tr.toBranchName }}
          controls={controls}
          perms={{ override: roleMay(access.actor, 'batch.override'), reportView: roleMay(access.actor, 'report.view') }}
          today={utcToday()}
          requestRows={tr.requestLines.map((l) => ({ lineId: l.lineId, productId: l.productId, productName: l.productName, requestedQty: l.requestedQty }))}
          sentRows={tr.sentLines.map((s) => ({ lineId: s.lineId, productName: s.productName, lot: s.lot, expiryDate: s.expiryDate, expiryPrecision: s.expiryPrecision, batchStatus: s.batchStatus, sentQty: s.sentQty }))}
          placeBranchName={access.place.branchName}
        />

        <section aria-labelledby="tr-lines-h" className="flex min-w-0 flex-col gap-2">
          <h2 id="tr-lines-h" className="text-md font-semibold text-text">
            {t('pharmacy.transfers.lines')}
          </h2>
          <ol className="flex flex-col border-t border-line" data-testid="transfer-lines">
            {tr.requestLines.map((l) => {
              const sent = sentOf(l.lineId);
              return (
                <li key={l.lineId} data-testid="transfer-line-view" className="flex min-w-0 flex-col gap-2 border-b border-line py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                      {l.productName}
                    </p>
                    <p className="text-sm text-text tabular-nums">
                      {t('pharmacy.transfers.lineFigures', { requested: formatNumber(l.requestedQty), sent: formatNumber(l.sentQty) })}
                    </p>
                  </div>
                  {sent.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {sent.map((s) => (
                        <li key={s.lineId} data-testid="transfer-sent-line" className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 rounded-sm bg-surface px-3 py-2 text-sm text-text sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
                          <span>
                            <span className="text-muted">{t('pharmacy.transfers.col.lot')}: </span>
                            <bdi dir="ltr" className="tabular-nums">
                              {s.lot}
                            </bdi>
                          </span>
                          <span>
                            <span className="text-muted">{t('pharmacy.transfers.col.expiry')}: </span>
                            <bdi dir="ltr" className="tabular-nums">
                              {formatExpiry(s)}
                            </bdi>
                          </span>
                          <span className="tabular-nums">
                            <span className="text-muted">{t('pharmacy.transfers.col.sent')}: </span>
                            {formatNumber(s.sentQty)}
                          </span>
                          <span className="col-span-2 tabular-nums sm:col-span-1">
                            {tr.status === 'SENT' ? (
                              <>
                                <span className="text-muted">{t('pharmacy.transfers.col.inTransit')}: </span>
                                {formatNumber(s.inTransitQty)}
                              </>
                            ) : closed ? (
                              <>
                                <span className="text-muted">{t('pharmacy.transfers.col.outcome')}: </span>
                                {t('pharmacy.transfers.outcome', {
                                  received: formatNumber(s.receivedQty),
                                  damaged: formatNumber(s.damagedQty),
                                  lost: formatNumber(s.lostQty),
                                })}
                              </>
                            ) : null}
                            {closed && s.quarantine && (
                              <span data-testid="transfer-quarantined" className="mt-1 flex items-start gap-1.5 text-xs font-medium">
                                <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                                {t('pharmacy.transfers.quarantined')}
                              </span>
                            )}
                            {closed && s.lostQty > 0 && s.lostReason && <span className="block text-xs text-muted">{t(`pharmacy.transfers.receive.lostReason.${s.lostReason}`)}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {closed && (
          <section aria-labelledby="tr-diff-h" data-testid="transfer-differences" className="flex min-w-0 flex-col gap-2">
            <h2 id="tr-diff-h" className="text-md font-semibold text-text">
              {t('pharmacy.transfers.differences')}
            </h2>
            <p className="text-sm text-text tabular-nums" data-testid="transfer-diff-totals">
              {t('pharmacy.transfers.differencesTotals', { sent: formatNumber(totals.sent), received: formatNumber(totals.received), damaged: formatNumber(totals.damaged), lost: formatNumber(totals.lost) })}
            </p>
            {tr.status === 'PARTIAL' && (
              <ul className="flex flex-col gap-1">
                {tr.sentLines
                  .filter((s) => s.receivedQty !== s.sentQty)
                  .map((s) => (
                    <li key={s.lineId} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 text-sm text-text">
                      <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                      <span dir="auto" className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {s.productName}
                      </span>
                      <span className="tabular-nums">{t('pharmacy.transfers.diffLine', { missing: formatNumber(s.sentQty - s.receivedQty), damaged: formatNumber(s.damagedQty), lost: formatNumber(s.lostQty) })}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
