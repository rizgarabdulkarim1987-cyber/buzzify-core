'use client';

import { ArrowRightLeft, ClipboardList, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { AssistantTool, ProposalInput } from '@/server/domain/pharmacy/assistant-domain';
import type { ToolOutput } from '@/server/pharmacy/assistant/tool-shapes';
import { bpPercent } from './reports-logic';
import { Day, Money, Name, Num, Pct } from './reports-parts';
import { proposalFromRow, rowAction } from './assistant-logic';
import { TOUCH_BTN } from './sell-parts';

/**
 * The plain tool tables of an assistant answer: the source of truth. Each table scrolls inside its own labelled region, never the
 * page. A row offers a proposal only to a role that may use the assistant and the draft the proposal hands over to; a proposal
 * carries ids and quantities and creates nothing until it is accepted (and then only a pre-filled draft opens).
 */

export interface TableCaps {
  ai: boolean;
  transfer: boolean;
  purchase: boolean;
  /** False in read-only mode: the proposal buttons are not drawn at all and a sentence says why. */
  writable: boolean;
}

export interface ProposeArgs {
  proposal: ProposalInput;
  branchId: string;
  rowKey: string;
}

interface Props {
  output: ToolOutput;
  branchName: (id: string) => string;
  caps: TableCaps;
  t: Translate;
  onPropose: (args: ProposeArgs) => void;
  /** Row keys with a proposal in flight or made. */
  proposed: Record<string, 'pending' | 'done'>;
  /** The product of the transfer table (its rows carry a batch, not a product). */
}

const TH = 'whitespace-nowrap px-3 py-2 text-start text-xs font-semibold text-muted';
const TD = 'px-3 py-2 align-top text-sm text-text';

function Scroll({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} data-testid={testId} className="max-w-full overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[34rem] border-collapse">{children}</table>
    </div>
  );
}

const Head = ({ cols }: { cols: string[] }) => (
  <thead className="border-b border-line bg-surface">
    <tr>
      {cols.map((c) => (
        <th key={c} scope="col" className={TH}>
          {c}
        </th>
      ))}
    </tr>
  </thead>
);

const Product = ({ name, strength, form }: { name: string; strength: string; form: string }) => (
  <>
    <Name>{name}</Name>
    <span className="block text-xs text-muted">
      <Name>{[strength, form].filter((p) => p.trim() !== '').join(' · ')}</Name>
    </span>
  </>
);

function Propose({ kind, rowKey, args, caps, t, state, onPropose }: { kind: ProposalInput['kind']; rowKey: string; args: ProposeArgs | null; caps: TableCaps; t: Translate; state: 'pending' | 'done' | undefined; onPropose: (a: ProposeArgs) => void }) {
  if (!args || !caps.writable) return null;
  const Icon = kind === 'TRANSFER' ? ArrowRightLeft : kind === 'REORDER' ? ClipboardList : Undo2;
  return (
    <button type="button" className={TOUCH_BTN} data-testid="row-propose" data-row={rowKey} disabled={state !== undefined} onClick={() => onPropose(args)}>
      <Icon aria-hidden className="size-4" />
      {state === 'done' ? t('pharmacy.assistant.propose.done') : t(`pharmacy.assistant.propose.${kind}`)}
    </button>
  );
}

export function ToolTable({ output, branchName, caps, t, onPropose, proposed }: Props) {
  const label = t(`pharmacy.assistant.tool.${output.tool}`);
  const tool: AssistantTool = output.tool;
  const action = rowAction(tool, caps);
  const propose = (row: Record<string, unknown>, rowKey: string, branchId: string, ctx: { productId?: string } = {}) => {
    const proposal = proposalFromRow(tool, row, ctx);
    return proposal ? { proposal, branchId, rowKey } : null;
  };

  switch (output.tool) {
    case 'batches_expiring':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted" data-testid="expiring-totals">
            {t('pharmacy.assistant.expiring.totals', { expired: output.totals.expired, d30: output.totals.d30, d60: output.totals.d60, d90: output.totals.d90, d180: output.totals.d180 })}
          </p>
          <Scroll label={label} testId="table-batches_expiring">
            <Head cols={[t('pharmacy.assistant.col.product'), t('pharmacy.assistant.col.lot'), t('pharmacy.assistant.col.branch'), t('pharmacy.assistant.col.expiry'), t('pharmacy.assistant.col.days'), t('pharmacy.assistant.col.units'), '']} />
            <tbody>
              {output.rows.map((r) => (
                <tr key={r.batchId} className="border-b border-line last:border-0" data-testid="table-row">
                  <td className={TD}>
                    <Product name={r.tradeName} strength={r.strength} form={r.form} />
                  </td>
                  <td className={TD}>
                    <Name>{r.lot}</Name>
                  </td>
                  <td className={TD}>
                    <Name>{branchName(r.branchId)}</Name>
                  </td>
                  <td className={TD}>
                    <Day day={r.expiryDate} />
                  </td>
                  <td className={TD}>
                    <Num value={r.daysToExpiry} />
                  </td>
                  <td className={TD}>
                    <Num value={r.units} />
                  </td>
                  <td className={TD}>
                    {action && <Propose kind="SUPPLIER_RETURN" rowKey={r.batchId} args={propose(r, r.batchId, r.branchId)} caps={caps} t={t} state={proposed[r.batchId]} onPropose={onPropose} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </Scroll>
          {output.truncated && <p className="text-sm text-muted">{t('pharmacy.assistant.truncated')}</p>}
        </div>
      );
    case 'stock_below_reorder':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t('pharmacy.assistant.reorder.total', { n: output.total })}</p>
          <Scroll label={label} testId="table-stock_below_reorder">
            <Head cols={[t('pharmacy.assistant.col.product'), t('pharmacy.assistant.col.branch'), t('pharmacy.assistant.col.min'), t('pharmacy.assistant.col.sellable'), t('pharmacy.assistant.col.deficit'), t('pharmacy.assistant.col.reorderQty'), '']} />
            <tbody>
              {output.rows.map((r) => {
                const key = `${r.productId}:${r.branchId}`;
                return (
                  <tr key={key} className="border-b border-line last:border-0" data-testid="table-row">
                    <td className={TD}>
                      <Product name={r.tradeName} strength={r.strength} form={r.form} />
                    </td>
                    <td className={TD}>
                      <Name>{branchName(r.branchId)}</Name>
                    </td>
                    <td className={TD}>
                      <Num value={r.minQty} />
                    </td>
                    <td className={TD}>
                      <Num value={r.sellable} />
                    </td>
                    <td className={TD}>
                      <Num value={r.deficit} />
                    </td>
                    <td className={TD}>
                      <Num value={r.reorderQty} />
                    </td>
                    <td className={TD}>{action && <Propose kind="REORDER" rowKey={key} args={propose(r, key, r.branchId)} caps={caps} t={t} state={proposed[key]} onPropose={onPropose} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </Scroll>
          {output.truncated && <p className="text-sm text-muted">{t('pharmacy.assistant.truncated')}</p>}
        </div>
      );
    case 'slow_movers':
      return (
        <div className="flex flex-col gap-2">
          <Scroll label={label} testId="table-slow_movers">
            <Head cols={[t('pharmacy.assistant.col.product'), t('pharmacy.assistant.col.sold'), t('pharmacy.assistant.col.onHand')]} />
            <tbody>
              {output.rows.map((r) => (
                <tr key={r.productId} className="border-b border-line last:border-0" data-testid="table-row">
                  <td className={TD}>
                    <Product name={r.tradeName} strength={r.strength} form={r.form} />
                  </td>
                  <td className={TD}>
                    <Num value={r.soldUnits} />
                  </td>
                  <td className={TD}>
                    <Num value={r.onHandUnits} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Scroll>
          <p className="text-xs text-muted">{t('pharmacy.assistant.slow.note')}</p>
          {output.truncated && <p className="text-sm text-muted">{t('pharmacy.assistant.truncated')}</p>}
        </div>
      );
    case 'transfer_candidates':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text">
            <Name>{output.batch.tradeName}</Name> · <Name>{output.batch.lot}</Name> · <Day day={output.batch.expiryDate} />
          </p>
          {output.notSuggested ? (
            <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text" data-testid="transfer-not-suggested">
              {t(`pharmacy.assistant.transfer.not.${output.notSuggested}`)}
            </p>
          ) : (
            <Scroll label={label} testId="table-transfer_candidates">
              <Head cols={[t('pharmacy.assistant.col.from'), t('pharmacy.assistant.col.to'), t('pharmacy.assistant.col.available'), t('pharmacy.assistant.col.destSellable'), t('pharmacy.assistant.col.destMin'), t('pharmacy.assistant.col.suggested'), '']} />
              <tbody>
                {output.rows.map((r) => {
                  const key = `${r.fromBranchId}>${r.toBranchId}`;
                  return (
                    <tr key={key} className="border-b border-line last:border-0" data-testid="table-row">
                      <td className={TD}>
                        <Name>{branchName(r.fromBranchId)}</Name>
                      </td>
                      <td className={TD}>
                        <Name>{branchName(r.toBranchId)}</Name>
                      </td>
                      <td className={TD}>
                        <Num value={r.availableAtSource} />
                      </td>
                      <td className={TD}>
                        <Num value={r.destSellable} />
                      </td>
                      <td className={TD}>
                        <Num value={r.destMinQty} />
                      </td>
                      <td className={TD}>
                        <Num value={r.suggestedQty} />
                      </td>
                      <td className={TD}>
                        {action && <Propose kind="TRANSFER" rowKey={key} args={propose(r, key, r.fromBranchId, { productId: output.batch.productId })} caps={caps} t={t} state={proposed[key]} onPropose={onPropose} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Scroll>
          )}
        </div>
      );
    case 'unpaid_supplier_invoices':
      return (
        <div className="flex flex-col gap-2">
          {output.totals.length > 0 && (
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text" data-testid="unpaid-totals">
              {output.totals.map((tot) => (
                <li key={tot.currency}>
                  {tot.currency} · {t('pharmacy.assistant.unpaid.count', { n: tot.count })}
                  {tot.balanceMinor !== undefined && (
                    <>
                      {' · '}
                      <Money minor={tot.balanceMinor} currency={tot.currency} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Scroll label={label} testId="table-unpaid_supplier_invoices">
            <Head cols={[t('pharmacy.assistant.col.invoice'), t('pharmacy.assistant.col.supplier'), t('pharmacy.assistant.col.due'), t('pharmacy.assistant.col.overdue'), t('pharmacy.assistant.col.balance')]} />
            <tbody>
              {output.rows.map((r) => (
                <tr key={r.invoiceId} className="border-b border-line last:border-0" data-testid="table-row">
                  <td className={TD}>
                    <Name>{r.number}</Name>
                  </td>
                  <td className={TD}>
                    <Name>{r.supplierName}</Name>
                  </td>
                  <td className={TD}>
                    <Day day={r.dueDate} />
                  </td>
                  <td className={TD}>
                    <Num value={r.daysOverdue} />
                  </td>
                  <td className={TD}>{r.balanceMinor !== undefined ? <Money minor={r.balanceMinor} currency={r.currency} /> : <span className="text-muted">{t('pharmacy.assistant.hidden')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </Scroll>
          {output.truncated && <p className="text-sm text-muted">{t('pharmacy.assistant.truncated')}</p>}
        </div>
      );
    case 'margin_change':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t('pharmacy.assistant.margin.previous', { from: output.previous.from, to: output.previous.to })}</p>
          <Scroll label={label} testId="table-margin_change">
            <Head cols={[t('pharmacy.assistant.col.currency'), t('pharmacy.assistant.col.net'), t('pharmacy.assistant.col.margin'), t('pharmacy.assistant.col.marginRate'), t('pharmacy.assistant.col.prevRate'), t('pharmacy.assistant.col.change')]} />
            <tbody>
              {output.byCurrency.map((r) => (
                <tr key={r.currency} className="border-b border-line last:border-0" data-testid="table-row">
                  <td className={TD}>{r.currency}</td>
                  <td className={TD}>
                    <Money minor={r.netMinor} currency={r.currency} />
                  </td>
                  <td className={TD}>
                    <Money minor={r.marginMinor} currency={r.currency} />
                  </td>
                  <td className={TD}>
                    <Pct bp={r.marginBp} none={t('pharmacy.assistant.none')} />
                  </td>
                  <td className={TD}>
                    <Pct bp={r.previousMarginBp} none={t('pharmacy.assistant.none')} />
                  </td>
                  <td className={TD}>{r.changeBp === null ? <span className="text-muted">{t('pharmacy.assistant.none')}</span> : <bdi dir="ltr">{bpPercent(r.changeBp)}</bdi>}</td>
                </tr>
              ))}
            </tbody>
          </Scroll>
          <p className="text-xs text-muted">{t('pharmacy.assistant.margin.estimated')}</p>
        </div>
      );
  }
}
