import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { test as teardown } from '@playwright/test';
import { OWNER_FILE, removeStudioUsers, superAdmin, superAdminFile } from './helpers/studio';

/**
 * Once every suite that signed in as them has finished: removes the Super Admins the setup project made. The seeded
 * owner and their one session (kept for the next run, see OWNER_KEPT_FILE) stay.
 */
teardown('remove the setup Super Admins', async () => {
  const files = (['en', 'ar', 'ckb'] as const).map(superAdminFile).filter((file) => existsSync(file));
  await removeStudioUsers(files.map((file) => superAdmin(file).email));
  for (const file of [...files, OWNER_FILE]) await rm(file, { force: true });
});
