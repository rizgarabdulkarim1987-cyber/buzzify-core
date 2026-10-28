/** One row of a printed paper. The browser draws rows on a canvas; the printer receives the picture. */
export type PaperRow =
  | { kind: 'text'; align: 'start' | 'center' | 'end'; left: string; right?: string; size?: 1 | 2; bold?: boolean }
  | { kind: 'rule' }
  | { kind: 'gap' }
  | { kind: 'barcode'; value: string };

export interface PaperDoc {
  rows: PaperRow[];
  copy?: boolean;
}
