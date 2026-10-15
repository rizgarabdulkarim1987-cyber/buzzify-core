import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import { DATA_DIR, DB_HOST, DB_PASSWORD, DB_PORT, DB_USER, DEV_DB, ROOT, TEST_DB } from './db-config';

const stopFile = resolve(ROOT, '.data/pg.stop');
const logFile = resolve(ROOT, '.data/pg.log');
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function portOpen(): Promise<boolean> {
  return new Promise((done) => {
    const socket = net.connect({ host: DB_HOST, port: DB_PORT });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

async function waitFor(open: boolean, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i += 1) {
    if ((await portOpen()) === open) return true;
    await sleep(500);
  }
  return false;
}

async function ensureDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: 'postgres' });
  await admin.connect();
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
}

async function start(): Promise<void> {
  mkdirSync(resolve(ROOT, '.data'), { recursive: true });
  rmSync(stopFile, { force: true });
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: DB_USER,
    password: DB_PASSWORD,
    port: DB_PORT,
    persistent: true,
  });
  if (!existsSync(resolve(DATA_DIR, 'PG_VERSION'))) await server.initialise();
  await server.start();
  await ensureDatabase(DEV_DB);
  await ensureDatabase(TEST_DB);
  console.log(`PostgreSQL ready on ${DB_HOST}:${DB_PORT} (${DEV_DB}, ${TEST_DB})`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    rmSync(stopFile, { force: true });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {
    if (existsSync(stopFile)) void stop();
  }, 500);
}

async function up(): Promise<void> {
  if (await portOpen()) {
    console.log(`PostgreSQL already running on ${DB_HOST}:${DB_PORT}`);
    return;
  }
  mkdirSync(resolve(ROOT, '.data'), { recursive: true });
  const args = ['--import', 'tsx', 'scripts/db.ts', 'start'];
  if (process.platform === 'win32') {
    // npm tree-kills detached children when `npm run` exits on Windows. Start-Process hands the
    // server to a process whose parent has already exited, so it outlives the npm script.
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const command =
      `Start-Process -WindowStyle Hidden -FilePath ${quote(process.execPath)} ` +
      `-ArgumentList ${args.map(quote).join(',')} -WorkingDirectory ${quote(ROOT)} ` +
      `-RedirectStandardOutput ${quote(logFile)} -RedirectStandardError ${quote(`${logFile}.err`)}`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    const log = openSync(logFile, 'a');
    spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: ['ignore', log, log] }).unref();
  }
  if (!(await waitFor(true, 90))) {
    console.error(`PostgreSQL did not come up within 90 s. See ${logFile}`);
    process.exit(1);
  }
  await sleep(1500);
  console.log(`PostgreSQL running on ${DB_HOST}:${DB_PORT}. Log: ${logFile}`);
}

async function down(): Promise<void> {
  if (!(await portOpen())) {
    console.log('PostgreSQL is not running');
    return;
  }
  writeFileSync(stopFile, 'stop');
  if (!(await waitFor(false, 30))) {
    console.error('PostgreSQL did not stop within 30 s');
    process.exit(1);
  }
  rmSync(stopFile, { force: true });
  console.log('PostgreSQL stopped');
}

async function status(): Promise<void> {
  const running = await portOpen();
  console.log(running ? `running on ${DB_HOST}:${DB_PORT}` : 'not running');
  process.exit(running ? 0 : 1);
}

const commands: Record<string, () => Promise<void>> = { start, up, down, status };
const command = process.argv[2] ?? '';
const run = commands[command];
if (!run) {
  console.error('Usage: tsx scripts/db.ts start | up | down | status');
  process.exit(2);
}
run().catch((error) => {
  console.error(error);
  process.exit(1);
});
