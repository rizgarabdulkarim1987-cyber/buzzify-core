import { parse } from 'pg-connection-string';

/**
 * Where a `DATABASE_URL` really connects. The application reaches the database through `pg` (Prisma's `PrismaPg`
 * adapter hands the connection string to a `pg` pool), and `pg` does not take the host from the URL's authority alone:
 * a `host` query parameter replaces it (`postgresql://u:p@127.0.0.1/db?host=db.example.com` connects to
 * `db.example.com`), a host that is a path is a Unix socket, and when no host is left it uses `PGHOST` and then
 * `localhost`. The guards in front of the development seeds and the lines that say which database a script will change
 * must go by the same answer, so they ask `pg`'s own parser (`pg-connection-string`) and apply `pg`'s own fallbacks
 * rather than reading the URL's `hostname`.
 */

type Env = Record<string, string | undefined>;

export interface DatabaseTarget {
  /** Lower case. A path (it starts with `/`) when the connection goes through a Unix socket. */
  host: string;
  /** Empty when the URL names none (`pg` then uses 5432). */
  port: string;
  database: string;
}

/**
 * The target `pg` connects to for this connection string, or null when it is not a connection URL at all. Never holds
 * the credentials. A host list (`a,b`) is returned as written: `pg` takes it for one host name, which no one has.
 */
export function databaseTarget(url: string, env: Env = process.env): DatabaseTarget | null {
  // Anything else would be read by `pg` as a path on a made-up host, which no one means.
  if (!url.startsWith('/') && !/^(postgres(ql)?|socket):/i.test(url)) return null;
  let config;
  try {
    config = parse(url);
  } catch {
    return null;
  }
  // `pg` takes an empty host from the environment, then from its defaults.
  const host = (config.host || env.PGHOST || 'localhost').toLowerCase();
  return { host, port: config.port ? String(config.port) : '', database: config.database ?? '' };
}

/** Whether the connection goes through a Unix socket, which can lead anywhere (a Cloud SQL socket reaches a hosted database). */
export const isSocketPath = (host: string) => host.startsWith('/');

/** Where `DATABASE_URL` connects, without its credentials, so a person can see which database a script will change. */
export function describeDatabase(env: Env = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) return 'the development database (DATABASE_URL is not set)';
  const target = databaseTarget(url, env);
  if (!target) return 'a database that DATABASE_URL does not name properly (it is not a connection URL)';
  return `${target.host}${target.port ? `:${target.port}` : ''}/${target.database}`;
}
