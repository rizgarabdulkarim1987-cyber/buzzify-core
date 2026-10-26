import { z } from 'zod';
import { normalizePhone } from '@/lib/phone';

/** A phone typed in any digits, stored as ASCII digits. An empty string passes only where `optional` says so. */
export const phoneField = (optional: boolean) =>
  z
    .string()
    .trim()
    .max(40)
    .transform((value, ctx) => {
      if (value === '' && optional) return '';
      const phone = normalizePhone(value);
      if (phone === '') ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
      return phone;
    });
