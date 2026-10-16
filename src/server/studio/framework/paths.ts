/**
 * The Studio's own addresses that server code names: where a flow sends the browser next, and where the framework sends
 * a visitor who may not see a page. The pages themselves live under `src/app/studio`.
 */
export const STUDIO_HOME = '/studio';

/** Where `query()` sends a visitor who is not signed in. */
export const SIGN_IN_PATH = '/studio/sign-in';

/** The second step of signing in, for a person whose account has two-factor on. */
export const TWO_FACTOR_PATH = '/studio/two-factor';

/**
 * Where `query()` sends a Super Admin who has not enrolled in two-factor. The page sits outside the signed-in layout,
 * whose own two-factor redirect would otherwise send it to itself.
 */
export const TWO_FACTOR_SETUP_PATH = '/studio/setup-two-factor';

/** The signed-in person's account page: where the links in account emails return to. */
export const ACCOUNT_PATH = '/studio/account';
