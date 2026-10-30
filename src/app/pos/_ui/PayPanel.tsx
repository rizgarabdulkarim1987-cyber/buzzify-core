"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  POS_PAYMENT_METHODS,
  type PosLegMethodKey,
  type PosPaymentMethodKey,
} from "@/server/domain/pos/payment-methods";
import { useSyncOptional } from "./sync/SyncProvider";
import { payPosOrder } from "@/app/studio/_actions/pos";
import {
  cashChange,
  legsReady,
  remaining,
  tipPreset,
  usdBack,
  usdDue,
  usdQuick,
  toLegs,
  type LegAmounts,
} from "@/lib/pos-pay-legs";
import { formatNumber } from "@/lib/pos-format";
import { amountDigits, quickCash } from "@/lib/pos-view";
import { useT } from "@/studio/i18n";
import { Button } from "@/studio/ui/Button";
import { cx } from "@/studio/ui/cx";
import { Dialog } from "@/studio/ui/Dialog";
import { Input } from "@/studio/ui/Input";
import { useMoney } from "./money";
import { usePosCall } from "./use-pos-call";

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  version: number;
  total: number;
  /** The methods the restaurant has switched on (cash is always one). */
  methods?: readonly PosPaymentMethodKey[];
  /** Cash in US dollars: whether it is on and the dinars per dollar. */
  usd?: { enabled: boolean; rate: number };
  /** Pay only these lines (one guest's share of a split bill); `total` is then that share. */
  lineIds?: string[];
}

const TIP_PERCENTS = [5, 10, 15] as const;

/**
 * Payment: one method, or several on one bill (each method's amount, with a "rest" button), an optional tip, the cash handed
 * over and the change it leaves, and the one tap that takes it.
 */
export function PayPanel({
  open,
  onClose,
  orderId,
  version,
  total,
  methods = ["CASH"],
  usd = { enabled: false, rate: 0 },
  lineIds,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={<PayTitle />}
      width="md"
    >
      {open ? (
        <PayBody
          orderId={orderId}
          version={version}
          total={total}
          methods={methods}
          usd={usd}
          lineIds={lineIds}
        />
      ) : null}
    </Dialog>
  );
}

function PayTitle() {
  return <>{useT()("pos.pay.title")}</>;
}

const chip = (on: boolean) =>
  cx(
    "min-h-12 rounded-md border px-4 text-base font-medium",
    on
      ? "border-ink bg-ink text-on-ink"
      : "border-line-strong bg-raised hover:bg-hover",
  );

function PayBody({
  orderId,
  version,
  total,
  methods = ["CASH"],
  usd = { enabled: false, rate: 0 },
  lineIds,
}: Omit<Props, "open" | "onClose">) {
  const t = useT();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const sync = useSyncOptional();
  const online = sync?.online ?? true;
  // Dollars need the server's rate, so like the terminal methods they are offered online only.
  const offered: PosLegMethodKey[] = [
    ...POS_PAYMENT_METHODS.filter((m) => methods.includes(m) && (m === "CASH" || online)),
    ...(usd.enabled && usd.rate > 0 && online ? (["CASH_USD"] as const) : []),
  ];

  const [several, setSeveral] = useState(false);
  const [chosen, setChosen] = useState<PosLegMethodKey>("CASH");
  const [amounts, setAmounts] = useState<LegAmounts>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [handed, setHanded] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [tipText, setTipText] = useState("");
  const [tipChoice, setTipChoice] = useState<string>("CASH");
  const [usdTyped, setUsdTyped] = useState<number | null>(null);

  const method = offered.includes(chosen) ? chosen : "CASH";
  const effective: LegAmounts = several ? amounts : { [method]: String(total) };
  const usedMethods = Object.entries(effective)
    .filter(([, text]) => Number(text) > 0)
    .map(([m]) => m);
  const tip = Number(tipText) || 0;
  // A tip is left in dinars or on a terminal, never in dollars.
  const tipMethods = usedMethods.filter((m) => m !== "CASH_USD");
  const tipMethod = tipMethods.includes(tipChoice)
    ? tipChoice
    : (tipMethods[0] ?? "CASH");
  const usdAmount = Number(effective.CASH_USD) || 0;
  const usdNeeded = usdDue(usdAmount, usd.rate) ?? 0;
  const usdHanded = usdTyped === null ? usdNeeded : usdTyped;
  const usdEnough = usdAmount === 0 || usdHanded >= usdNeeded;
  const usdChange = usdAmount > 0 ? usdBack(usdHanded, usd.rate, usdAmount) : 0;
  const cash = Number(effective.CASH) || 0;
  const cashTip = tipMethod === "CASH" ? tip : 0;
  const cashDue = cash + cashTip;
  const hasCash = cashDue > 0;
  const tendered = handed ?? cashDue;
  const change = cashChange({ cash, cashTip, tendered });
  const enough = !hasCash || change >= 0;
  const left = remaining(total, effective);
  const split = several ? legsReady(total, amounts) : true;
  const ready = split && enough && usdEnough && tip <= total;
  const terminalMethods = usedMethods.filter((m) => m !== "CASH" && m !== "CASH_USD");

  const pay = () =>
    void call(
      () =>
        payPosOrder({
          orderId,
          expectedVersion: version,
          expectedTotal: total,
          // A bill that came to nothing (comped) has no amounts to split: the single-method call records it.
          ...(total === 0
            ? { method: "CASH", amountReceived: 0 }
            : { legs: toLegs(effective, references, tendered, usdAmount > 0 ? { dollars: usdHanded, rate: usd.rate } : undefined) }),
          ...(lineIds ? { lineIds } : {}),
          ...(tip > 0 ? { tip: { amount: tip, method: tipMethod } } : {}),
        }),
      {
        onOk: () => router.push(`/pos/orders/${orderId}/receipt?print=1`),
      },
    );

  return (
    <div className="flex flex-col gap-5">
      <dl className="flex items-baseline justify-between gap-3 text-lg">
        <dt className="text-muted">{t("pos.pay.due")}</dt>
        <dd className="text-2xl font-semibold">{money(total)}</dd>
      </dl>

      {offered.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={several}
            onClick={() => setSeveral((on) => !on)}
            className={chip(several)}
          >
            {several ? t("pos.pay.one") : t("pos.pay.several")}
          </button>
        </div>
      ) : null}

      {several ? (
        <div className="flex flex-col gap-3">
          {offered.map((m) => (
            <div key={m} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-base font-medium">
                  {t(`pos.method.${m}`)}
                </span>
                <Input
                  size="lg"
                  inputMode="numeric"
                  dir="ltr"
                  aria-label={t(`pos.method.${m}`)}
                  value={amounts[m] ?? ""}
                  onChange={(event) =>
                    setAmounts((a) => ({
                      ...a,
                      [m]: amountDigits(event.target.value),
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={remaining(total, { ...amounts, [m]: "" }) <= 0}
                  onClick={() =>
                    setAmounts((a) => ({
                      ...a,
                      [m]: String(remaining(total, { ...a, [m]: "" })),
                    }))
                  }
                  className={cx(chip(false), "disabled:opacity-40")}
                >
                  {t("pos.pay.rest")}
                </button>
              </div>
              {m !== "CASH" && m !== "CASH_USD" && Number(amounts[m]) > 0 ? (
                <Input
                  size="lg"
                  dir="ltr"
                  maxLength={100}
                  aria-label={t("pos.pay.reference")}
                  placeholder={t("pos.pay.reference")}
                  value={references[m] ?? ""}
                  onChange={(event) =>
                    setReferences((r) => ({ ...r, [m]: event.target.value }))
                  }
                />
              ) : null}
            </div>
          ))}
          <dl className="flex items-baseline justify-between gap-3 text-lg" aria-live="polite">
            <dt className="text-muted">
              {left >= 0 ? t("pos.pay.left") : t("pos.pay.over")}
            </dt>
            <dd
              className={cx(
                "text-2xl font-semibold",
                left === 0 ? "text-success" : "text-danger",
              )}
            >
              {money(Math.abs(left))}
            </dd>
          </dl>
        </div>
      ) : offered.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium text-text">
            {t("pos.pay.method")}
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {offered.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setChosen(m)}
                className={chip(method === m)}
              >
                {t(`pos.method.${m}`)}
              </button>
            ))}
          </div>
          {!online ? (
            <p className="text-sm text-muted">{t("pos.pay.terminalOffline")}</p>
          ) : null}
        </fieldset>
      ) : null}

      {!several && method !== "CASH" && method !== "CASH_USD" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("pos.pay.terminalNote")}</p>
          <Input
            size="lg"
            dir="ltr"
            maxLength={100}
            aria-label={t("pos.pay.reference")}
            placeholder={t("pos.pay.reference")}
            value={references[method] ?? ""}
            onChange={(event) =>
              setReferences((r) => ({ ...r, [method]: event.target.value }))
            }
          />
        </div>
      ) : null}
      {several && terminalMethods.length > 0 ? (
        <p className="text-sm text-muted">{t("pos.pay.terminalNote")}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-base font-medium text-text">
          {t("pos.pay.tip")}
        </span>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            aria-pressed={tip === 0}
            onClick={() => setTipText("")}
            className={chip(tip === 0)}
          >
            {t("pos.pay.tipNone")}
          </button>
          {TIP_PERCENTS.map((percent) => {
            const amount = tipPreset(total, percent);
            return (
              <button
                key={percent}
                type="button"
                aria-pressed={tip === amount}
                onClick={() => setTipText(String(amount))}
                className={chip(tip === amount)}
              >
                {percent}%
              </button>
            );
          })}
        </div>
        <Input
          size="lg"
          inputMode="numeric"
          dir="ltr"
          aria-label={t("pos.pay.tip")}
          placeholder={t("pos.pay.tip")}
          value={tipText}
          onChange={(event) => setTipText(amountDigits(event.target.value))}
        />
        {tip > 0 && tipMethods.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{t("pos.pay.tipIn")}</span>
            {tipMethods.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={tipMethod === m}
                onClick={() => setTipChoice(m)}
                className={chip(tipMethod === m)}
              >
                {t(`pos.method.${m}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {usdAmount > 0 ? (
        <div className="flex flex-col gap-2" data-testid="pay-usd">
          <dl className="flex items-baseline justify-between gap-3 text-lg">
            <dt className="text-muted">{t("pos.pay.usdTake")}</dt>
            <dd className="text-2xl font-semibold" dir="ltr">
              {t("pos.usd.amount", { n: formatNumber(usdNeeded) })}
            </dd>
          </dl>
          <span className="text-sm text-muted" dir="ltr">
            {t("pos.pay.usdRate", { rate: money(usd.rate) })}
          </span>
          <span className="text-base font-medium text-text">
            {t("pos.pay.usdHanded")}
          </span>
          <div className="grid grid-cols-3 gap-2">
            {usdQuick(usdNeeded).map((dollars) => (
              <button
                key={dollars}
                type="button"
                onClick={() => setUsdTyped(dollars)}
                aria-pressed={usdHanded === dollars}
                className={chip(usdHanded === dollars)}
              >
                {t("pos.usd.amount", { n: formatNumber(dollars) })}
              </button>
            ))}
          </div>
          <Input
            size="lg"
            inputMode="numeric"
            dir="ltr"
            placeholder={t("pos.pay.usdOther")}
            aria-label={t("pos.pay.usdOther")}
            value={usdTyped === null ? "" : String(usdTyped)}
            onChange={(event) => {
              const digits = amountDigits(event.target.value);
              setUsdTyped(digits === "" ? null : Number(digits));
            }}
          />
          <dl className="flex items-baseline justify-between gap-3 text-lg" aria-live="polite">
            <dt className="text-muted">
              {usdEnough ? t("pos.pay.usdChange") : t("pos.pay.usdShort")}
            </dt>
            <dd className={cx("text-2xl font-semibold", usdEnough ? "text-success" : "text-danger")}>
              {usdEnough ? money(usdChange) : t("pos.usd.amount", { n: formatNumber(usdNeeded - usdHanded) })}
            </dd>
          </dl>
        </div>
      ) : null}

      {hasCash ? (
        <div className="flex flex-col gap-2">
          <span className="text-base font-medium text-text">
            {t("pos.pay.received")}
          </span>
          <div className="grid grid-cols-3 gap-2">
            {quickCash(cashDue).map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => {
                  setHanded(amount);
                  setTyped("");
                }}
                aria-pressed={tendered === amount && typed === ""}
                className={chip(tendered === amount && typed === "")}
              >
                {money(amount)}
              </button>
            ))}
          </div>
          <Input
            size="lg"
            inputMode="numeric"
            dir="ltr"
            placeholder={t("pos.pay.otherAmount")}
            aria-label={t("pos.pay.otherAmount")}
            value={typed}
            onChange={(event) => {
              const digits = amountDigits(event.target.value);
              setTyped(digits);
              setHanded(digits === "" ? null : Number(digits));
            }}
          />
          <dl
            className="flex items-baseline justify-between gap-3 text-lg"
            aria-live="polite"
          >
            <dt className="text-muted">
              {enough ? t("pos.pay.change") : t("pos.pay.short")}
            </dt>
            <dd
              className={cx(
                "text-2xl font-semibold",
                enough ? "text-success" : "text-danger",
              )}
            >
              {money(Math.abs(change))}
            </dd>
          </dl>
        </div>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        className="min-h-12 w-full"
        disabled={!ready || pending}
        pending={pending}
        onClick={pay}
      >
        {t("pos.pay.take")}
      </Button>
    </div>
  );
}
