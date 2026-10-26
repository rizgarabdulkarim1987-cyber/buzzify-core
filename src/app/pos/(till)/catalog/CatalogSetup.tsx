'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { chooseCatalogMenu, ensureCatalogMenu } from '@/app/studio/_actions/pos';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Select } from '@/studio/ui/Select';

interface MenuChoice {
  id: string;
  name: string;
  currency: string;
}

/**
 * A restaurant with no product list yet. With no menu, or one menu, one press sets it up; with several, the owner says
 * which of them the till sells from (the server refuses to guess).
 */
export function CatalogSetup({ menus }: { menus: MenuChoice[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState(menus[0]?.id ?? '');

  async function run(call: () => Promise<ActionResult<unknown>>) {
    setBusy(true);
    const result = await settle(call);
    setBusy(false);
    if (result.ok) {
      toast.success(t('pos.catalog.saved'));
      router.refresh();
    } else {
      toast.error(describeFailure(t, locale, result.error).message);
    }
  }

  return (
    <section className="flex max-w-md flex-col gap-4">
      <p className="text-base text-muted">{t('pos.catalog.none')}</p>
      {menus.length > 1 ? (
        <>
          <p className="text-base text-text">{t('pos.catalog.choosePrompt')}</p>
          <Select
            aria-label={t('pos.catalog.chosen')}
            value={menuId}
            onChange={(event) => setMenuId(event.target.value)}
            options={menus.map((menu) => ({ value: menu.id, label: `${menu.name} (${menu.currency})` }))}
          />
          <Button pending={busy} className="self-start" onClick={() => void run(() => chooseCatalogMenu({ menuId }))}>
            {t('pos.catalog.choose')}
          </Button>
        </>
      ) : (
        <Button pending={busy} className="self-start" onClick={() => void run(() => ensureCatalogMenu({}))}>
          {t('pos.catalog.set')}
        </Button>
      )}
    </section>
  );
}
