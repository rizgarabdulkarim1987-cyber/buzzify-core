import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * `npm run studio:thumbnails`: draws the Design tab's gallery thumbnails (tests/e2e/template-thumbnails.gen.ts) through the
 * Studio preview, signed in as the Super Admin the e2e Studio setup creates (and its teardown removes). It needs the demo
 * menus seeded (`npm run db:seed`). `THUMBNAILS_BASE_URL` points it at another dev server than the e2e one.
 */
const baseURL = process.env.THUMBNAILS_BASE_URL ?? base.use?.baseURL ?? 'http://127.0.0.1:3100';
const setups = (base.projects ?? []).filter((project) => ['public setup', 'studio setup', 'studio teardown'].includes(project.name ?? ''));

export default defineConfig({
  ...base,
  workers: 3,
  use: { ...base.use, baseURL },
  projects: [
    ...setups,
    { name: 'thumbnails', testMatch: /template-thumbnails\.gen\.ts$/, dependencies: ['studio setup'], use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: base.webServer && !Array.isArray(base.webServer) ? { ...base.webServer, url: `${baseURL}/atelier/en` } : base.webServer,
});
