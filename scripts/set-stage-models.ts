import 'dotenv/config';
import { isStageArt } from '@/lib/stage';
import { createPrisma } from '@/server/data/prisma';
import { describeDatabase } from './database-target';
import { applyStageModels, planStageModels, type StageModelRule } from './stage-models';

/**
 * `npm run studio:stage-models -- <menu-address> <category>=<model>[+<scan>][@<signature>] ... [--media-url=<url>] [--apply]`
 *
 * Shows what it would change, and changes it and republishes the menu with `--apply`, for example:
 *
 *   npm run studio:stage-models -- zhamitos chicken=bagchicken+/api/assets/models/zhamitos-chicken-919dee01.glb@Small meat=bagbeef@Small --apply
 *
 * Publishing turns library photos into the addresses guests load, so against the live database it needs the address
 * the bucket is served on (`MEDIA_PUBLIC_URL`, or `--media-url`). Without the right one the rebuilt menu would differ
 * from the live one, and the script refuses to publish.
 */

function parseRule(argument: string): StageModelRule {
  const match = /^([^=]+)=([a-z]+)(?:\+([^@]+))?(?:@(.+))?$/.exec(argument);
  if (!match) throw new Error(`"${argument}" is not <category>=<model>[+<scan>][@<signature>]`);
  const [, category, model, scan, signature] = match;
  if (!isStageArt(model!)) throw new Error(`"${model}" is not a 3D model`);
  if (scan && !/^\/api\/assets\/models\/[a-z0-9-]+\.glb$/.test(scan)) throw new Error(`"${scan}" is not /api/assets/models/<file>.glb`);
  return { category: category!.trim(), model, ...(scan ? { scan } : {}), ...(signature ? { signature: signature.trim() } : {}) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const mediaUrl = args.find((arg) => arg.startsWith('--media-url='))?.slice('--media-url='.length);
  if (mediaUrl) process.env.MEDIA_PUBLIC_URL = mediaUrl;
  const [slug, ...rest] = args.filter((arg) => !arg.startsWith('--'));
  if (!slug || rest.length === 0) {
    throw new Error('Usage: npm run studio:stage-models -- <menu-address> <category>=<model>[@<signature>] ... [--apply]');
  }

  const prisma = createPrisma();
  try {
    console.log(`Database: ${describeDatabase()}`);
    const plan = await planStageModels(prisma, slug, rest.map(parseRule));
    for (const product of plan.products) {
      const changes = [
        product.addModel ? `add ${product.model}` : `has ${product.model}`,
        product.setScan ? `scan ${product.setScan}` : '',
        product.signature.before !== product.signature.after ? 'make signature' : product.signature.after ? 'signature' : '',
      ].filter(Boolean);
      console.log(`  ${product.category} / ${product.name} (${product.slug}): ${changes.join(', ')}`);
    }
    if (plan.unpublished) console.log('The menu has unpublished changes: publish or discard them in the Studio first.');
    if (!apply) {
      console.log('Nothing was changed. Run again with --apply to make these changes and republish the menu.');
      return;
    }
    const { number } = await applyStageModels(prisma, plan, { now: new Date() });
    console.log(`Published as revision ${number}. Guests see it within five minutes.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
