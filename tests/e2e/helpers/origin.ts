/**
 * Where the end-to-end run's dev server listens: port 3100, or `E2E_PORT` when another checkout's dev server already has
 * 3100 (Playwright would otherwise reuse that server, running that checkout's code against its database).
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
