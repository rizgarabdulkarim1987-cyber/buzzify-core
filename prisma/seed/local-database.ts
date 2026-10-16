/**
 * The guard the development seeds share. They write things that must never reach a shared database: sign-in users with
 * a password written in `.env.example`, and a thousand test restaurants. A script run from a laptop with `DATABASE_URL`
 * pointed at a hosted database (and `NODE_ENV` unset, as it is there) is not "production" to the code, so what a seed
 * is allowed to do also depends on where the connection string points.
 */

/** The hosts that are this machine. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1'];

/** The one setting that lets a development seed write to another host. */
export const ALLOW_REMOTE_VARIABLE = 'ALLOW_REMOTE_DEV_SEED';

type Env = Record<string, string | undefined>;

/**
 * The host a connection string names, in lower case and without the brackets round an IPv6 address. An empty string when
 * the URL names none (a socket path), null when it is not a URL at all.
 */
export function databaseHost(url: string): string | null {
  if (!URL.canParse(url)) return null;
  return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * Throws unless `DATABASE_URL` points at this machine (`127.0.0.1`, `localhost` or `::1`), or is unset, which means the
 * embedded development database. `ALLOW_REMOTE_DEV_SEED=1` lets it through. Call it before the first write.
 *
 * `what` starts the message ("The load seed"); `instead` is advice for the person who does not mean to seed there. The
 * message names the host and never the rest of the URL, which holds the credentials; a URL that does not parse is not
 * quoted at all.
 */
export function assertLocalDatabase(what: string, options: { env?: Env; instead?: string } = {}): void {
  const env = options.env ?? process.env;
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') return;
  if (env[ALLOW_REMOTE_VARIABLE] === '1') return;

  const host = databaseHost(url);
  if (host !== null && LOOPBACK_HOSTS.includes(host)) return;

  const where = host === null ? 'DATABASE_URL is not a valid URL' : `DATABASE_URL points at ${host === '' ? 'no host' : `the host ${host}`}, not at this machine`;
  throw new Error(
    `${what} refused: ${where}. It is for local development and never for a shared database. ` +
      `${options.instead ? `${options.instead} ` : ''}To run it there anyway, set ${ALLOW_REMOTE_VARIABLE}=1.`,
  );
}
