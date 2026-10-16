import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { test as teardown } from '@playwright/test';
import { removeStudioUsers, SUPER_ADMIN_FILE, superAdmin } from './helpers/studio';

/** Removes the Super Admin the setup project made, once every suite that signed in as them has finished. */
teardown('remove the setup Super Admin', async () => {
  if (!existsSync(SUPER_ADMIN_FILE)) return;
  await removeStudioUsers([superAdmin().email]);
  await rm(SUPER_ADMIN_FILE, { force: true });
});
