'use client';

import { useEffect, useRef } from 'react';
import { createScannerCapture, isPrintable, isTerminator, swallowsTerminator, type ScannerOptions } from './scanner';

export type ScannerCaptureOptions = ScannerOptions & {
  /** Listen at all. Default true. */
  enabled?: boolean;
  /** Ignore keys typed into a text field, even a scan. Default false: a scan inside a field is delivered. */
  ignoreWhenEditable?: boolean;
};

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isEditable(target: EventTarget | null): target is Editable {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'image'].includes(target.type);
  return target.isContentEditable;
}

function readValue(el: Editable): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '');
}

/** Writes the value back the way React notices (native setter, then an `input` event). */
function writeValue(el: Editable, value: string): void {
  if (readValue(el) === value) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.textContent = value;
  }
}

/**
 * Calls `onScan(code)` for every barcode a keyboard-wedge scanner types anywhere on the page (see `scanner.ts`).
 *
 * Text fields: nothing is ever blocked while a person types. A scan cannot be known until its terminator arrives, so
 * its characters do land in a focused field. When the terminator proves the run was a scan (or a double-trigger duplicate that is dropped), the hook (a) cancels the
 * Enter/Tab (`preventDefault`, so a form does not submit and focus does not move), and (b) restores the field to the
 * value it had when the run began, so the barcode text does not stay in, say, a search box. Typing that ends in
 * Enter is left alone. With `ignoreWhenEditable` a field's keys are skipped entirely.
 *
 * Safe on the server (the listener is added in an effect). The latest `onScan` is used without re-subscribing.
 */
export function useScannerCapture(onScan: (code: string) => void, options: ScannerCaptureOptions = {}): void {
  const { enabled = true, ignoreWhenEditable = false, minLength, maxGapMs, duplicateWindowMs, idleResetMs, maxLength, prefix, suffix } = options;
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const scanner = createScannerCapture({ minLength, maxGapMs, duplicateWindowMs, idleResetMs, maxLength, prefix, suffix });
    let snapshot: { el: Editable; value: string } | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const editable = isEditable(event.target);
      if (editable && ignoreWhenEditable) return;

      const time = event.timeStamp;
      if (editable && isPrintable(event.key) && !scanner.continuesBurst(time)) {
        // A new run starts with this key; the key has not been inserted yet, so the value is the pre-run value.
        snapshot = { el: event.target as Editable, value: readValue(event.target as Editable) };
      }
      const result = scanner.feed(event.key, time);
      if (isTerminator(event.key)) {
        if (swallowsTerminator(result)) {
          // A dropped duplicate is swallowed the same way: its text must not stay in a search box nor its Enter add the top result.
          event.preventDefault();
          if (snapshot && snapshot.el.isConnected) writeValue(snapshot.el, snapshot.value);
          if (result.kind === 'scan') handler.current(result.code);
        }
        snapshot = null;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      scanner.reset();
    };
  }, [enabled, ignoreWhenEditable, minLength, maxGapMs, duplicateWindowMs, idleResetMs, maxLength, prefix, suffix]);
}
