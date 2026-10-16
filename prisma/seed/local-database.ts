import { databaseTarget, isSocketPath } from '../../scripts/database-target';

/**
 * The guard the development seeds share. They write things that must never reach a shared database: sign-in users with
 * a password written in `.env.example`, and a thousand test restaurants. A script run from a laptop with `DATABASE_URL`
 * pointed at a hosted database (and `NODE_ENV` unset, as it is there) is not "production" to the code, so what a seed
 * is allowed to do also depends on where the connection string leads.
 *
 * It judges the host `pg` would connect to (`databaseTarget`), not the URL's authority, so `127.0.0.1/db?host=other`
 * is `other`, and a Unix socket path is never this machine's loopback. What it cannot see is a loopback address that
 * is really a tunnel to a remote database (an SSH forward, a proxy): that looks like this machine and is let through.
 */

/** The hosts that are this machine. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1'];

/** The one setting that lets a development seed write to another host. */
export const ALLOW_REMOTE_VARIABLE = 'ALLOW_REMOTE_DEV_SEED';

type Env = Record<string, string | undefined>;

/**
 * Throws unless `DATABASE_URL` leads to this machine (`127.0.0.1`, `localhost` or `::1`, as `pg` reads it), or is unset,
 * which means the embedded development database. `ALLOW_REMOTE_DEV_SEED=1` lets it through. Call it before the first write.
 *
 * `what` starts the message ("The load seed"); `instead` is advice for the person who does not mean to seed there. The
 * message names the host `pg` would reach and never the rest of the URL, which holds the credentials; a URL that is not
 * a connection URL is not quoted at all.
 */
export function assertLocalDatabase(what: string, options: { env?: Env; instead?: string } = {}): void {
  const env = options.env ?? process.env;
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') return;
  if (env[ALLOW_REMOTE_VARIABLE] === '1') return;

  const target = databaseTarget(url, env);
  if (target !== null && LOOPBACK_HOSTS.includes(target.host)) return;

  const where =
    target === null
      ? 'DATABASE_URL is not a connection URL'
      : isSocketPath(target.host)
        ? `DATABASE_URL connects through the socket ${target.host}, which can lead to a shared database`
        : `DATABASE_URL leads to the host ${target.host}, not to this machine`;
  throw new Error(
    `${what} refused: ${where}. It is for local development and never for a shared database. ` +
      `${options.instead ? `${options.instead} ` : ''}To run it there anyway, set ${ALLOW_REMOTE_VARIABLE}=1.`,
  );
}
