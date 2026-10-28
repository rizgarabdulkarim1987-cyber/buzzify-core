"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  CircleCheck,
  DoorClosed,
  Hourglass,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  cashPaidIn,
  cashPaidOut,
  closeShift,
} from "@/app/pharmacy/_actions/shifts";
import type { ShiftTotals, ShiftView } from "@/server/pharmacy/shifts-reads";
import type { StudioFailure } from "@/server/studio/framework/result";
import { useLocale, useT } from "@/studio/i18n";
import { settle } from "@/studio/settle";
import { Dialog } from "@/studio/ui/Dialog";
import { Field } from "@/studio/ui/Field";
import { Money } from "./money-parts";
import { phMessage } from "./ph-failure";
import { OpenShiftPanel } from "./OpenShiftPanel";
import { ShiftFigures } from "./ShiftFigures";
import {
  FIELD,
  FieldInput,
  Note,
  TOUCH_BTN,
  TOUCH_PRIMARY,
} from "./sell-parts";
import {
  formatMinor,
  outcomeUnknown,
  parseMoney,
  type Currency,
  type KeyedAttempt,
} from "./sell-logic";
import {
  cashAttempt,
  closeOutcome,
  closePlan,
  formatUtc,
  paidOutHint,
} from "./shifts-logic";

const available = (minor: bigint | string, currency: Currency) =>
  `${formatMinor(BigInt(minor), currency)} ${currency}`;

/** The refusal in words; INSUFFICIENT_CASH names the cash that is there, in this shift's currency. */
function useFailureText(currency: Currency) {
  const t = useT();
  const { locale } = useLocale();
  return (error: StudioFailure) => {
    if (
      error.fields?.phCode === "INSUFFICIENT_CASH" &&
      error.fields.available
    ) {
      return t("pharmacy.shifts.fail.INSUFFICIENT_CASH", {
        available: available(error.fields.available, currency),
      });
    }
    return phMessage(t, locale, error, "pharmacy.shifts");
  };
}

/**
 * The person's own shift: opened at, the cash identity live from the server, sales by method, returns, and the three
 * things to do with it (paid in, paid out, close). No shift: the same opening panel the sale screen uses. Every figure
 * is the server's; after any action the page is read again.
 */
export function ShiftPanel({
  shift,
  totals,
  currencies,
  defaultCurrency,
  asOf,
  names,
}: {
  shift: ShiftView | null;
  totals: ShiftTotals | null;
  /** When the server read the figures (ISO). */
  asOf: string;
  currencies: Currency[];
  defaultCurrency: Currency;
  /** Names by user id for the figures (the person's own name). */
  names?: Record<string, string>;
}) {
  const t = useT();
  const router = useRouter();
  const [dialog, setDialog] = useState<"in" | "out" | "close" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The paid in/out attempt lives here, not in the dialog: closing the dialog after a lost answer must not forget the
  // key, or typing the same movement again would be recorded twice.
  const [cashKey, setCashKey] = useState<KeyedAttempt | null>(null);

  if (!shift || !totals) {
    return (
      <OpenShiftPanel
        currencies={currencies}
        defaultCurrency={defaultCurrency}
        onOpened={() => router.refresh()}
      />
    );
  }
  const expected = BigInt(totals.expectedMinor);
  return (
    <section
      aria-labelledby="my-shift"
      data-testid="shift-card"
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="my-shift" className="text-lg font-semibold text-text">
          {t("pharmacy.shifts.mine")}
        </h2>
        <button
          type="button"
          className={TOUCH_BTN}
          data-testid="shift-refresh"
          onClick={() => router.refresh()}
        >
          <RefreshCw aria-hidden className="size-4" />
          {t("pharmacy.shifts.refresh")}
        </button>
      </div>
      <p className="text-md text-text" data-testid="expected-live">
        {t("pharmacy.shifts.expectedNow")}:{" "}
        <strong className="font-semibold">
          <Money minor={totals.expectedMinor} currency={shift.currency} />
        </strong>
      </p>
      {notice && (
        <Note
          icon={<CircleCheck aria-hidden />}
          tone="success"
          role="status"
          testId="shift-notice"
        >
          {notice}
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={TOUCH_BTN}
          data-testid="paid-in-open"
          onClick={() => setDialog("in")}
        >
          <ArrowDownToLine aria-hidden className="size-4" />
          {t("pharmacy.shifts.paidIn")}
        </button>
        <button
          type="button"
          className={TOUCH_BTN}
          data-testid="paid-out-open"
          onClick={() => setDialog("out")}
        >
          <ArrowUpFromLine aria-hidden className="size-4" />
          {t("pharmacy.shifts.paidOut")}
        </button>
        <button
          type="button"
          className={TOUCH_PRIMARY}
          data-testid="close-open"
          onClick={() => setDialog("close")}
        >
          <DoorClosed aria-hidden className="size-4" />
          {t("pharmacy.shifts.close")}
        </button>
        <Link href="/pharmacy/sell" className={TOUCH_BTN}>
          {t("pharmacy.nav.sell")}
        </Link>
      </div>
      <ShiftFigures shift={shift} totals={totals} t={t} names={names ?? {}} />
      {(dialog === "in" || dialog === "out") && (
        <CashDialog
          kind={dialog}
          attempt={cashKey}
          onAttempt={setCashKey}
          currency={shift.currency}
          expectedMinor={expected}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setNotice(text);
            router.refresh();
          }}
        />
      )}
      <CloseDialog
        open={dialog === "close"}
        shift={shift}
        expectedMinor={expected}
        asOf={asOf}
        closingForOther={false}
        onClose={() => setDialog(null)}
        onClosed={() => {
          setDialog(null);
          router.refresh();
        }}
      />
    </section>
  );
}

// Paid in / paid out ---------------------------------------------------------------------------------------------------

export function CashDialog({
  kind,
  attempt,
  onAttempt,
  currency,
  expectedMinor,
  onClose,
  onDone,
}: {
  kind: "in" | "out";
  /** Kept by the parent so it outlives this dialog while the outcome of a send is unknown. */
  attempt: KeyedAttempt | null;
  onAttempt: (next: KeyedAttempt | null) => void;
  currency: Currency;
  expectedMinor: bigint;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const t = useT();
  const failure = useFailureText(currency);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = amount.trim() === "" ? null : parseMoney(amount, currency);
  const invalidAmount =
    amount.trim() !== "" && (parsed === null || parsed <= 0n);
  const hint = kind === "out" ? paidOutHint(parsed, expectedMinor) : null;
  const ready = parsed !== null && parsed > 0n && reason.trim().length >= 3;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy || parsed === null) return;
    setBusy(true);
    setProblem(null);
    const next = cashAttempt(attempt, kind, parsed, reason);
    onAttempt(next);
    const clientKey = next.key;
    const call = kind === "in" ? cashPaidIn : cashPaidOut;
    const result = await settle(() =>
      call({
        amountMinor: parsed.toString(),
        reason: reason.trim(),
        clientKey,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) onAttempt(null);
      setProblem(
        outcomeUnknown(result.error)
          ? t("pharmacy.shifts.cash.unknown")
          : failure(result.error),
      );
      return;
    }
    onAttempt(null);
    onDone(
      t(
        kind === "in"
          ? "pharmacy.shifts.paidIn.done"
          : "pharmacy.shifts.paidOut.done",
      ),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !busy && onClose()}
      width="md"
      title={t(
        kind === "out"
          ? "pharmacy.shifts.paidOut.title"
          : "pharmacy.shifts.paidIn.title",
      )}
      description={t("pharmacy.shifts.cash.intro")}
      footer={
        <>
          <button
            type="button"
            className={TOUCH_BTN}
            onClick={onClose}
            disabled={busy}
          >
            {t("pharmacy.shifts.cancel")}
          </button>
          <button
            type="submit"
            form="cash-form"
            data-testid="cash-confirm"
            className={TOUCH_PRIMARY}
            disabled={!ready || busy}
          >
            {busy ? (
              <Hourglass aria-hidden className="size-4" />
            ) : (
              <CircleCheck aria-hidden className="size-4" />
            )}
            {busy
              ? t("pharmacy.sell.pay.saving")
              : t("pharmacy.shifts.cash.confirm")}
          </button>
        </>
      }
    >
      <form
        id="cash-form"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <Field
          label={t("pharmacy.shifts.cash.amount", { currency })}
          error={
            invalidAmount ? t("pharmacy.sell.pay.invalidAmount") : undefined
          }
        >
          <FieldInput
            className={FIELD}
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={amount}
            data-testid="cash-amount"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        {hint && (
          <p className="text-sm text-muted" data-testid="cash-available">
            {t("pharmacy.shifts.cash.available")}:{" "}
            <Money minor={hint.availableMinor} currency={currency} />
          </p>
        )}
        {hint?.over && (
          <Note
            icon={<TriangleAlert aria-hidden />}
            tone="danger"
            role="status"
            testId="cash-over"
          >
            {t("pharmacy.shifts.fail.INSUFFICIENT_CASH", {
              available: available(hint.availableMinor, currency),
            })}
          </Note>
        )}
        <Field
          label={t("pharmacy.shifts.reason")}
          hint={t("pharmacy.shifts.reasonHint")}
        >
          <FieldInput
            className={FIELD}
            dir="auto"
            autoComplete="off"
            maxLength={200}
            value={reason}
            data-testid="cash-reason"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {problem && (
          <Note
            icon={<CircleAlert aria-hidden />}
            tone="danger"
            role="alert"
            testId="cash-problem"
          >
            {problem}
          </Note>
        )}
      </form>
    </Dialog>
  );
}

// Close ----------------------------------------------------------------------------------------------------------------

/**
 * Counting the drawer and closing. The preview is counted minus the SERVER's expected cash; a difference needs a reason.
 * A cashier whose difference is over the pharmacy's limit is told to ask a manager (NEEDS_APPROVAL): the dialog then
 * says so. A manager closing someone else's shift always gives a reason.
 */
export function CloseDialog({
  open,
  shift,
  expectedMinor,
  asOf,
  closingForOther,
  onClose,
  onClosed,
}: {
  open: boolean;
  shift: ShiftView;
  expectedMinor: bigint;
  /** When the server read the expected cash (ISO): the figure is as of then, and the person may read it again. */
  asOf: string;
  closingForOther: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const t = useT();
  const failure = useFailureText(shift.currency);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsManager, setNeedsManager] = useState(false);
  // Closing has no idempotency key: after a lost answer a later ALREADY_CLOSED is most likely the earlier attempt.
  const [lostBefore, setLostBefore] = useState(false);
  const [closedProbably, setClosedProbably] = useState(false);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const value =
    counted.trim() === "" ? null : parseMoney(counted, shift.currency);
  const plan = closePlan(expectedMinor, value, closingForOther);
  const invalid = counted.trim() !== "" && value === null;
  const ready =
    plan !== null &&
    (!plan.needsReason || reason.trim().length >= 3) &&
    !needsManager &&
    !closedProbably;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy || value === null || !plan) return;
    setBusy(true);
    setProblem(null);
    const result = await settle(() =>
      closeShift({
        shiftId: shift.id,
        countedMinor: value.toString(),
        ...(plan.needsReason ? { reason: reason.trim() } : {}),
      }),
    );
    setBusy(false);
    if (!result.ok) {
      const outcome = closeOutcome(result.error, lostBefore);
      if (outcome === "unknown") setLostBefore(true);
      if (outcome === "needs-approval") setNeedsManager(true);
      else if (outcome === "closed-probably") setClosedProbably(true);
      else
        setProblem(
          outcome === "unknown"
            ? t("pharmacy.shifts.close.unknown")
            : failure(result.error),
        );
      return;
    }
    onClosed();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      width="md"
      title={t(
        closingForOther
          ? "pharmacy.shifts.close.titleOther"
          : "pharmacy.shifts.close.title",
      )}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-testid="close-expected">
            {t("pharmacy.shifts.expected")}:{" "}
            <strong className="text-text">
              <Money minor={expectedMinor} currency={shift.currency} />
            </strong>
          </span>
          <span data-testid="close-as-of">
            {t("pharmacy.shifts.close.asOf", { time: formatUtc(asOf) })}
          </span>
        </span>
      }
      footer={
        <>
          <button
            type="button"
            className={TOUCH_BTN}
            onClick={onClose}
            disabled={busy}
          >
            {t("pharmacy.shifts.cancel")}
          </button>
          <button
            type="submit"
            form="close-form"
            data-testid="close-confirm"
            className={TOUCH_PRIMARY}
            disabled={!ready || busy}
          >
            {busy ? (
              <Hourglass aria-hidden className="size-4" />
            ) : (
              <DoorClosed aria-hidden className="size-4" />
            )}
            {busy
              ? t("pharmacy.sell.pay.saving")
              : t("pharmacy.shifts.close.confirm")}
          </button>
        </>
      }
    >
      <form
        id="close-form"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <div>
          <button
            type="button"
            className={TOUCH_BTN}
            data-testid="close-refresh"
            disabled={refreshing || busy}
            onClick={() => startRefresh(() => router.refresh())}
          >
            <RefreshCw aria-hidden className="size-4" />
            {t("pharmacy.shifts.close.refresh")}
          </button>
        </div>
        <Field
          label={t("pharmacy.shifts.close.counted", {
            currency: shift.currency,
          })}
          hint={t("pharmacy.shifts.close.countedHint")}
          error={invalid ? t("pharmacy.sell.pay.invalidAmount") : undefined}
        >
          <FieldInput
            className={FIELD}
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={counted}
            data-testid="close-counted"
            onChange={(event) => {
              setCounted(event.target.value);
              setNeedsManager(false);
            }}
          />
        </Field>
        {plan && (
          <p
            data-testid="close-variance"
            role="status"
            className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md border border-line bg-surface px-3 py-2.5 text-md font-semibold text-text"
          >
            <span className="flex items-center gap-2">
              {plan.kind === "match" ? (
                <CircleCheck aria-hidden className="size-4" />
              ) : (
                <TriangleAlert aria-hidden className="size-4" />
              )}
              {t(`pharmacy.shifts.variance.${plan.kind}`)}
            </span>
            {plan.kind !== "match" && (
              <span>
                <Money
                  minor={plan.varianceMinor}
                  currency={shift.currency}
                  signed
                />
              </span>
            )}
          </p>
        )}
        {plan?.needsReason && (
          <Field
            label={t("pharmacy.shifts.reason")}
            hint={t("pharmacy.shifts.close.reasonHint")}
          >
            <FieldInput
              className={FIELD}
              dir="auto"
              autoComplete="off"
              maxLength={200}
              value={reason}
              data-testid="close-reason-input"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
        {needsManager && (
          <Note
            icon={<TriangleAlert aria-hidden />}
            tone="danger"
            role="alert"
            testId="needs-approval"
          >
            {t("pharmacy.shifts.fail.NEEDS_APPROVAL")}
          </Note>
        )}
        {closedProbably && (
          <Note
            icon={<CircleCheck aria-hidden />}
            tone="info"
            role="status"
            testId="close-probably"
          >
            <span>
              {t("pharmacy.shifts.close.probably")}{" "}
              <Link
                href={`/pharmacy/shifts/${shift.id}`}
                className="font-medium underline underline-offset-2"
                data-testid="close-open-report"
              >
                {t("pharmacy.shifts.openReport")}
              </Link>
            </span>
          </Note>
        )}
        {problem && (
          <Note
            icon={<CircleAlert aria-hidden />}
            tone="danger"
            role="alert"
            testId="close-problem"
          >
            {problem}
          </Note>
        )}
      </form>
    </Dialog>
  );
}
