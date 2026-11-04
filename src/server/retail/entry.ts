import { retailConfig } from './config';
import { RETAIL_SIGN_IN_PATH, RETAIL_START_PATH } from './paths';

/**
 * Where to send a person into Buzzify Retail from the Studio's side: Retails' own start of the sign-in handoff, which
 * makes the state, comes back to `/api/retail/v1/handoff` and signs them in there. Null when the link is off or its
 * address is not valid (then there is nowhere to send them).
 */
export function retailStartUrl(): string | null {
  const config = retailConfig();
  if (!config.enabled) return null;
  try {
    return `${config.baseUrl}${RETAIL_START_PATH}`;
  } catch {
    return null;
  }
}

/** Retails' own sign-in page, where a person whose sign-in started in Retail goes back to; null when the link is off. */
export function retailSignInUrl(): string | null {
  const config = retailConfig();
  if (!config.enabled) return null;
  try {
    return `${config.baseUrl}${RETAIL_SIGN_IN_PATH}`;
  } catch {
    return null;
  }
}
