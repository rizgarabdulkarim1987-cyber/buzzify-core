import { Plus, SearchX, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OfflineNotice } from "@/app/pharmacy/_ui/OfflineNotice";
import { loadPages, pagesOf } from "@/app/pharmacy/_ui/load-pages";
import { CustomerRow } from "@/app/pharmacy/_ui/CustomerRow";
import { CustomerSearch } from "@/app/pharmacy/_ui/CustomerSearch";
import { WriteBlocked } from "@/app/pharmacy/_ui/WriteBlocked";
import { list } from "@/server/pharmacy/queries/customers";
import { query } from "@/server/studio/framework/invoke";
import { getStudioTranslator } from "@/studio/messages";
import { requestStudioLocale } from "@/studio/request-locale";
import { buttonClasses } from "@/studio/ui/Button";
import { EmptyState } from "@/studio/ui/EmptyState";
import { PageHeader } from "@/studio/ui/PageHeader";
import { customersGate } from "./gate";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: getStudioTranslator(await requestStudioLocale())(
      "pharmacy.customers.title",
    ),
  };
}

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
const STATES = ["live", "archived", "all"] as const;

/**
 * Customers of the business, by name. Each row says what the account holds in words and figures (balance, limit, room left) in the
 * customer's own currency; nothing is summed across currencies. Rows are cards, not a table, so the list reads at 375 px; it is read
 * 50 at a time and "Load more" adds the next 50.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [raw, g] = await Promise.all([
    searchParams,
    customersGate("pharmacy.customers.title"),
  ]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const state = STATES.find((s) => s === one(raw.state)) ?? "live";
  const owing = one(raw.owing) === "1";
  const pages = pagesOf(one(raw.pages));
  const page = await loadPages(
    (cursor) =>
      query(list, {
        ...access.placeInput,
        active: state === "live" ? true : state === "archived" ? false : "all",
        ...(owing ? { owingOnly: true } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    pages,
  );
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({
      state: state === "live" ? undefined : state,
      owing: owing ? "1" : undefined,
      pages: pages > 1 ? String(pages) : undefined,
      ...over,
    }))
      if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/customers${text ? `?${text}` : ""}`;
  };
  const filtered = owing || state !== "live";
  const canNew = g.mayManage && g.writable.ok;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        title={t("pharmacy.customers.title")}
        description={t("pharmacy.customers.intro")}
        actions={
          canNew ? (
            <Link
              href="/pharmacy/customers/new"
              className={buttonClasses("primary", "lg", "min-h-11")}
              data-testid="customer-new"
            >
              <Plus aria-hidden />
              {t("pharmacy.customers.new")}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.mayManage && !g.writable.ok && (
          <WriteBlocked writable={g.writable} scope="sales" />
        )}
        <OfflineNotice messageKey="pharmacy.reports.offline" />
        <CustomerSearch
          state={state}
          owing={owing}
          filters={
            <nav
              aria-label={t("pharmacy.customers.filter")}
              className="flex flex-wrap gap-2"
            >
              {STATES.map((s) => (
                <Link
                  key={s}
                  href={href({
                    state: s === "live" ? undefined : s,
                    pages: undefined,
                  })}
                  aria-current={s === state ? "page" : undefined}
                  data-testid={`customers-state-${s}`}
                  className={buttonClasses(
                    s === state ? "primary" : "secondary",
                    "lg",
                    "min-h-11",
                  )}
                >
                  {t(`pharmacy.customers.state.${s}`)}
                </Link>
              ))}
              <Link
                href={href({
                  owing: owing ? undefined : "1",
                  pages: undefined,
                })}
                aria-current={owing ? "page" : undefined}
                data-testid="customers-owing"
                className={buttonClasses(
                  owing ? "primary" : "secondary",
                  "lg",
                  "min-h-11",
                )}
              >
                {t("pharmacy.customers.owingOnly")}
              </Link>
            </nav>
          }
        >
          {page.items.length === 0 ? (
            <div data-testid="customers-empty">
              <EmptyState
                icon={filtered ? <SearchX /> : <UsersRound />}
                title={t(
                  filtered
                    ? "pharmacy.customers.emptyFiltered"
                    : "pharmacy.customers.empty",
                )}
                body={t(
                  filtered
                    ? "pharmacy.customers.emptyFilteredBody"
                    : "pharmacy.customers.emptyBody",
                )}
              />
            </div>
          ) : (
            <ul
              aria-label={t("pharmacy.customers.title")}
              className="flex flex-col border-t border-line"
              data-testid="customers-list"
            >
              {page.items.map((c) => (
                <CustomerRow key={c.id} c={c} t={t} />
              ))}
            </ul>
          )}
          {page.nextCursor && (
            <nav aria-label={t("pharmacy.customers.title")}>
              <Link
                href={href({ pages: String(pages + 1) })}
                rel="next"
                className={buttonClasses("secondary", "lg", "min-h-11")}
                data-testid="customers-more"
              >
                {t("pharmacy.purchasing.loadMore")}
              </Link>
            </nav>
          )}
        </CustomerSearch>
      </div>
    </>
  );
}
