import { targetOf } from '@/server/domain/pos/bridge-protocol';
import { packRaster, PAPER_DOTS, rasterJob } from '@/server/domain/pos/escpos';
import type { PaperDoc } from '@/server/domain/pos/paper';
import type { PrinterView } from '@/server/pos/printers';
import { readBridgeUrl } from './bridge-url';
import { renderDoc } from './render-doc';

export type PrintResult = { ok: true } | { ok: false; reason: 'bridge' | 'printer'; message: string };

export interface PrintOptions {
  /** Kick the cash drawer after the paper (only if the printer has a drawer pin). */
  drawer: boolean;
  fetchImpl?: typeof fetch;
  render?: typeof renderDoc;
  bridgeUrl?: string;
  dir?: 'rtl' | 'ltr';
  font?: string;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Draws the document for the printer's paper and sends it through the bridge. Never throws: a failure is a result the screen shows. */
export async function printDoc(doc: PaperDoc, printer: PrinterView, opts: PrintOptions): Promise<PrintResult> {
  const render = opts.render ?? renderDoc;
  const dir = opts.dir ?? (typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');
  let bytes: Uint8Array;
  try {
    const picture = render(doc, PAPER_DOTS[printer.paperWidth], dir, opts.font ?? 'sans-serif');
    bytes = rasterJob(packRaster(picture.rgba, picture.width, picture.height), { cut: printer.cut, drawerPin: opts.drawer ? printer.drawerPin : null });
  } catch (error) {
    return { ok: false, reason: 'printer', message: error instanceof Error ? error.message : 'could not draw the paper' };
  }
  const send = opts.fetchImpl ?? fetch;
  try {
    const response = await send(`${opts.bridgeUrl ?? readBridgeUrl()}/print`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: targetOf(printer), dataBase64: toBase64(bytes) }),
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: response.status === 502 ? 'printer' : 'bridge', message: body.error ?? `bridge answered ${response.status}` };
  } catch (error) {
    return { ok: false, reason: 'bridge', message: error instanceof Error ? error.message : 'bridge unreachable' };
  }
}

/** True when the bridge on this PC answers; the settings screen shows it. */
export async function bridgeAlive(bridgeUrl = readBridgeUrl(), fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    return (await fetchImpl(`${bridgeUrl}/health`)).ok;
  } catch {
    return false;
  }
}
