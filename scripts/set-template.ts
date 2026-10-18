import 'dotenv/config';
import { isTemplateId, TEMPLATE_IDS } from '@/lib/templates';
import { createPrisma } from '@/server/data/prisma';
import { publishMenu } from '@/server/publish/publish';
import { describeDatabase } from './database-target';

/**
 * `npm run studio:template -- <menu-address> <template|classic> [--apply]`
 *
 * Draws a menu with one of the template presets (src/lib/templates), keeping the business's own overrides only when the
 * template stays the same, or puts it back to the classic menu, and republishes it. Without `--apply` it only says what
 * it would do. It refuses a menu with unpublished changes, which publishing would put live too. The Studio's Design tab
 * does the same for one menu at a time; this is for setting up demo menus and for support.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [slug, template] = args.filter((arg) => !arg.startsWith('--'));
  if (!slug || !template || (template !== 'classic' && !isTemplateId(template))) {
    throw new Error(`Usage: npm run studio:template -- <menu-address> <classic|${TEMPLATE_IDS.join('|')}> [--apply]`);
  }

  const prisma = createPrisma();
  try {
    console.log(`Database: ${describeDatabase()}`);
    const menu = await prisma.menu.findUnique({ where: { slug }, select: { id: true, restaurantId: true, draftHash: true, liveHash: true, brand: { select: { id: true, templateId: true } } } });
    if (!menu) throw new Error(`No menu has the address "${slug}"`);
    const next = template === 'classic' ? null : template;
    console.log(`  ${slug}: ${menu.brand?.templateId ?? 'classic'} -> ${next ?? 'classic'}`);
    if (menu.liveHash !== null && menu.draftHash !== menu.liveHash) {
      throw new Error('The menu has unpublished changes, which publishing would put live too. Publish or discard them in the Studio first.');
    }
    if (!apply) {
      console.log('Nothing was changed. Run again with --apply to change the template and republish the menu.');
      return;
    }
    const number = await prisma.$transaction(async (tx) => {
      const keep = menu.brand?.templateId === next;
      if (menu.brand) {
        await tx.brandConfig.update({
          where: { id: menu.brand.id },
          data: { templateId: next, ...(keep ? {} : { design: {}, customTemplateId: null }), version: { increment: 1 } },
        });
      } else {
        const restaurant = await tx.restaurant.findUniqueOrThrow({ where: { id: menu.restaurantId }, select: { name: true } });
        await tx.brandConfig.create({ data: { menuId: menu.id, tokens: {}, typography: {}, logoText: restaurant.name, templateId: next } });
      }
      const outcome = await publishMenu(tx, { menuId: menu.id, actorId: null, note: `Template: ${next ?? 'classic'}`, now: new Date() });
      if (!outcome.ok) throw new Error(`The menu cannot be published: ${JSON.stringify(outcome.issues.filter((issue) => issue.severity === 'block'))}`);
      await tx.auditLog.create({
        data: {
          restaurantId: menu.restaurantId,
          menuId: menu.id,
          action: 'design.applied',
          entityType: 'BrandConfig',
          entityId: menu.brand?.id ?? menu.id,
          changes: { templateId: { before: menu.brand?.templateId ?? null, after: next } },
        },
      });
      return outcome.number;
    });
    console.log(`Published as revision ${number}. Guests see it within five minutes.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
