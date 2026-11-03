/**
 * The addresses of the sign-in handoff to Buzzify Retail, apart from the handlers (`./handoff-http.ts`) so the sign-in
 * pages and their client forms can name them without loading the database client.
 */

/** Retails sends the browser here with its state and nonce. */
export const HANDOFF_PATH = '/api/retail/v1/handoff';

/**
 * Where the sign-in returns a person whose sign-in Retails started: the parked state is rebuilt into the handoff. It is
 * also how the sign-in pages know the person came from Retail (`authEntryOf`), so they show no Studio frame.
 */
export const CONTINUE_PATH = '/studio/retail/continue';

/** An owner of several shops picks the one to open. */
export const CHOOSE_PATH = '/studio/retail/choose';

/** Retails' own start of the handoff (it makes the state): the way into Retail from the Studio's side. */
export const RETAIL_START_PATH = '/api/core/v1/handoff/start';
