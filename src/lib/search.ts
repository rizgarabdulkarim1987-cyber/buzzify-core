const MARKS = /[̀-ًͯ-ٰٟـ]/g;

export function normalizeSearch(input: string): string {
  return input
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/[ةە]/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `searchKey` must already be normalized with `normalizeSearch`. */
export function matchesQuery(searchKey: string, query: string): boolean {
  const normalized = normalizeSearch(query);
  if (normalized === '') return true;
  return normalized.split(' ').every((token) => searchKey.includes(token));
}
