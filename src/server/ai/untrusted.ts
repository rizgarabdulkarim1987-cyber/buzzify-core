import { toLatinDigits } from './grounding';

/**
 * Text from customers, suppliers or staff is data for the model, never instructions. It is wrapped so the model can tell,
 * and its angle brackets are escaped so it cannot close the wrapper early.
 */

export type UntrustedSource = 'invoice' | 'complaint' | 'toolResult' | 'question';

export function untrusted(source: UntrustedSource, text: string): string {
  return `<untrusted_data source="${source}">${text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</untrusted_data>`;
}

/**
 * Replaces every run of seven or more digits (optionally after a plus, with single spaces or hyphens between digits) with
 * "[number]": a customer can type a phone number into a complaint, and it must never reach the provider. A long price
 * written without separators is redacted too, which is accepted because complaint text is not a source of money.
 */
export function redactPhones(text: string): string {
  return toLatinDigits(text).replace(/\+?\(?\d(?:[\s.\-()/_ ]*\d){6,}\)?/g, '[number]');
}
