/**
 * An operation a till device queued while offline. Run with `runAction(..., { operation })`, the action's one transaction
 * claims it first and stores the action's answer last, so the change and its record commit together or not at all.
 */
export interface OperationClaim {
  /** The device's uuid for the operation: unique per restaurant. */
  operationId: string;
  kind: string;
  deviceId: string;
  /** When the device made it. Metadata only: every stored timestamp is the server's. */
  clientAt: Date;
  /** `payloadHash` of what was sent, so the same id with another payload is told apart. */
  payloadHash: string;
}

/** The operation id was already stored, by this call's twin: nothing of this call was applied. */
export class DuplicateOperationError extends Error {
  constructor(readonly operationId: string) {
    super('This operation was already applied');
  }
}
