/** How many products of a category the setup page renders before the manager asks for the rest. */
export const CATEGORY_PREVIEW = 30;

/** The rows to render now and how many wait behind the "show all" button. */
export function previewOf<T>(rows: readonly T[], expanded: boolean): { shown: readonly T[]; hidden: number } {
  if (expanded || rows.length <= CATEGORY_PREVIEW) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, CATEGORY_PREVIEW), hidden: rows.length - CATEGORY_PREVIEW };
}
