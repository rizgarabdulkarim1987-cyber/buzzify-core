"use client";

import { SearchX } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { listCustomers } from "@/app/pharmacy/_actions/customers";
import type { CustomerView } from "@/server/pharmacy/customers-reads";
import { useLocale, useT } from "@/studio/i18n";
import { settle } from "@/studio/settle";
import { buttonClasses } from "@/studio/ui/Button";
import { EmptyState } from "@/studio/ui/EmptyState";
import { CustomerRow } from "./CustomerRow";
import { phMessage } from "./ph-failure";
import { Note } from "./sell-parts";

/**
 * The customers search. What is typed (a name, a phone) goes in the body of a Server Action, never into the address, the history
 * or a log line. With nothing searched the server-rendered list (`children`, which follows the state and owing filters in the
 * address) is shown; with a search, the results are read here by cursor and "Load more" adds the next page.
 */
export function CustomerSearch({
  state,
  owing,
  filters,
  children,
}: {
  state: "live" | "archived" | "all";
  owing: boolean;
  filters: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [text, setText] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [items, setItems] = useState<CustomerView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  const read = async (q: string, cursor: string | null) => {
    const mine = ++seq.current;
    setBusy(true);
    const result = await settle(() =>
      listCustomers({
        search: q,
        active: state === "live" ? true : state === "archived" ? false : "all",
        ...(owing ? { owingOnly: true } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    );
    if (mine !== seq.current) return;
    setBusy(false);
    if (!result.ok) {
      setProblem(phMessage(t, locale, result.error, "pharmacy.credit"));
      return;
    }
    setProblem(null);
    const data = result.data as {
      items: CustomerView[];
      nextCursor: string | null;
    };
    setItems((old) => (cursor ? [...old, ...data.items] : data.items));
    setNext(data.nextCursor);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = text.trim();
    seq.current += 1;
    setProblem(null);
    setItems([]);
    setNext(null);
    if (q === "") {
      setSearched(null);
      setBusy(false);
      return;
    }
    setSearched(q);
    void read(q, null);
  };

  return (
    <>
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3"
        role="search"
        data-testid="customers-filter"
      >
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm font-medium text-text">
          {t("pharmacy.customers.search")}
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            dir="auto"
            maxLength={100}
            autoComplete="off"
            data-testid="customers-q"
            className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text"
          />
        </label>
        <button
          type="submit"
          className={buttonClasses("primary", "lg", "min-h-11")}
          disabled={busy}
        >
          {t("pharmacy.customers.searchGo")}
        </button>
      </form>
      {filters}
      {searched === null ? (
        children
      ) : (
        <div
          className="flex min-w-0 flex-col gap-4"
          data-testid="customers-search-results"
        >
          {problem && (
            <Note icon={<SearchX aria-hidden />} tone="danger" role="alert">
              {problem}
            </Note>
          )}
          {items.length === 0 && !busy && !problem ? (
            <div data-testid="customers-empty">
              <EmptyState
                icon={<SearchX />}
                title={t("pharmacy.customers.emptyFiltered")}
                body={t("pharmacy.customers.emptyFilteredBody")}
              />
            </div>
          ) : (
            <ul
              aria-label={t("pharmacy.customers.title")}
              className="flex flex-col border-t border-line"
              data-testid="customers-list"
            >
              {items.map((c) => (
                <CustomerRow key={c.id} c={c} t={t} />
              ))}
            </ul>
          )}
          {next && (
            <div>
              <button
                type="button"
                className={buttonClasses("secondary", "lg", "min-h-11")}
                data-testid="customers-more"
                disabled={busy}
                onClick={() => void read(searched, next)}
              >
                {t("pharmacy.purchasing.loadMore")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
