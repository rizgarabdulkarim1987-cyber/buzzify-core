import { describe, expect, it } from 'vitest';
import { PharmacyAuditError, assertAuditSafe } from '@/server/domain/pharmacy/audit-fields';

const change = (after: unknown = 'x') => ({ before: null, after });

describe('pharmacy audit redaction rule', () => {
  it('a change on patientName is refused', () => {
    expect(() => assertAuditSafe('PhSale', { patientName: change() })).toThrow(PharmacyAuditError);
  });

  it('a change on prescriptionNo is refused', () => {
    expect(() => assertAuditSafe('PhPrescription', { prescriptionNo: change() })).toThrow(PharmacyAuditError);
  });

  it('catalog fields (tradeName, strength, barcode, amount) pass', () => {
    expect(() =>
      assertAuditSafe('PhProduct', {
        tradeName: change('Panadol'),
        strength: change('500mg'),
        barcode: change('123'),
        amount: change(5),
      }),
    ).not.toThrow();
    expect(() => assertAuditSafe('PhProduct', undefined)).not.toThrow();
  });

  it('the error names the field and never the value', () => {
    let message = '';
    try {
      assertAuditSafe('PhSale', { customerPhone: change('0750-SECRET-VALUE') });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('customerPhone');
    expect(message).not.toContain('SECRET-VALUE');
  });

  it('nested keys are checked case-insensitively', () => {
    expect(() => assertAuditSafe('PhSale', { lines: change({ items: [{ NationalID: '1' }] }) })).toThrow(/NationalID/);
    expect(() => assertAuditSafe('PhSale', { meta: { before: null, after: { DOCTOR: 'a' } } })).toThrow(
      PharmacyAuditError,
    );
  });
});
