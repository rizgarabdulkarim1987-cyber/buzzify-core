/**
 * The digits of a restaurant's WhatsApp number for a wa.me link (international form, no plus, no leading zeros of the
 * dialling prefix), or null when what the restaurant typed cannot be one.
 */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[^0-9]/g, '').replace(/^00/, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}
