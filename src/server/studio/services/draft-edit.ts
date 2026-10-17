import type { ScopedTx } from '@/server/data/tenant-db';
import { refreshDraftHash } from '@/server/publish/draft';
import type { ActionContext } from '@/server/studio/framework/action';

/**
 * Runs a change to a menu's draft in one transaction on the menu's client and, before it commits, stores the hash of
 * the draft as it then stands (`Menu.draftHash`). A publish reads the draft with several queries; it sees a consistent
 * draft only because every draft edit also writes the menu's row, so the publish's lock on that row waits for it
 * (2a follow-up 2). Every Studio action that writes draft rows goes through this.
 */
export function editDraft<T>(ctx: ActionContext, fn: (tx: ScopedTx, menuId: string) => Promise<T>): Promise<T> {
  const menuId = ctx.menuId;
  if (menuId === null) throw new Error('editDraft needs an action whose target is a menu');
  return ctx.transaction(async (tx) => {
    const result = await fn(tx, menuId);
    await refreshDraftHash(tx, menuId);
    return result;
  });
}
