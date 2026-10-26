/**
 * Pharmacy audit entries must never carry patient, prescription or similar personal data. A change that touches such a
 * field is refused outright (never silently dropped), so the mistake surfaces in development.
 */

export const FORBIDDEN_AUDIT_FIELDS: readonly RegExp[] = [
  /patient/i,
  /customer/i,
  /prescription/i,
  /doctor/i,
  /national_?id/i,
  /phone/i,
  /address/i,
  /dob|birth/i,
  /attachment/i,
];

export class PharmacyAuditError extends Error {
  constructor(
    readonly entityType: string,
    readonly field: string,
  ) {
    // Names the field only: never the value.
    super(`Audit change on ${entityType} carries a forbidden field: ${field}`);
    this.name = 'PharmacyAuditError';
  }
}

function findForbidden(value: unknown, depth = 0): string | null {
  if (value === null || typeof value !== 'object' || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbidden(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (FORBIDDEN_AUDIT_FIELDS.some((re) => re.test(key))) return key;
    const hit = findForbidden(inner, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function assertAuditSafe(
  entityType: string,
  changes: Record<string, { before: unknown; after: unknown }> | undefined,
): void {
  if (!changes) return;
  for (const [field, change] of Object.entries(changes)) {
    if (FORBIDDEN_AUDIT_FIELDS.some((re) => re.test(field))) throw new PharmacyAuditError(entityType, field);
    const nested = findForbidden(change);
    if (nested) throw new PharmacyAuditError(entityType, nested);
  }
}
