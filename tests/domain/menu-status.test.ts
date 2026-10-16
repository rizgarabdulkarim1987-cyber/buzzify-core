import { describe, expect, it } from 'vitest';
import { MENU_STATUSES, nextMenuStatus, STATUS_ACTIONS, type MenuStatus, type StatusAction } from '@/server/domain/menu-status';

const live = { hasLiveRevision: true, statusBeforeArchive: null };

describe('nextMenuStatus', () => {
  it('archives a draft', () => {
    expect(nextMenuStatus('DRAFT', 'archive', { hasLiveRevision: false, statusBeforeArchive: null })).toBe('ARCHIVED');
  });

  it('suspends a published menu', () => {
    expect(nextMenuStatus('PUBLISHED', 'suspend', live)).toBe('SUSPENDED');
  });

  it('archives a published menu', () => {
    expect(nextMenuStatus('PUBLISHED', 'archive', live)).toBe('ARCHIVED');
  });

  it('restores a suspended menu to published', () => {
    expect(nextMenuStatus('SUSPENDED', 'restore', live)).toBe('PUBLISHED');
  });

  it('archives a suspended menu', () => {
    expect(nextMenuStatus('SUSPENDED', 'archive', live)).toBe('ARCHIVED');
  });

  it('restores an archived menu to the status it had before', () => {
    for (const before of ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const) {
      expect(nextMenuStatus('ARCHIVED', 'restore', { hasLiveRevision: true, statusBeforeArchive: before }), before).toBe(before);
    }
  });

  it('restores an archived menu to a draft when nothing says what it was', () => {
    expect(nextMenuStatus('ARCHIVED', 'restore', { hasLiveRevision: false, statusBeforeArchive: null })).toBe('DRAFT');
    expect(nextMenuStatus('ARCHIVED', 'restore', { hasLiveRevision: true, statusBeforeArchive: null })).toBe('DRAFT');
  });

  it('never restores to a live status without a live revision to show', () => {
    expect(nextMenuStatus('SUSPENDED', 'restore', { hasLiveRevision: false, statusBeforeArchive: null })).toBe('DRAFT');
    for (const before of ['PUBLISHED', 'SUSPENDED'] as const) {
      expect(nextMenuStatus('ARCHIVED', 'restore', { hasLiveRevision: false, statusBeforeArchive: before }), before).toBe('DRAFT');
    }
    // A status before archiving that is itself "archived" cannot be gone back to.
    expect(nextMenuStatus('ARCHIVED', 'restore', { hasLiveRevision: true, statusBeforeArchive: 'ARCHIVED' })).toBe('DRAFT');
  });

  it('allows nothing else', () => {
    const listed = new Set(['DRAFT:archive', 'PUBLISHED:suspend', 'PUBLISHED:archive', 'SUSPENDED:restore', 'SUSPENDED:archive', 'ARCHIVED:restore']);
    const pairs: Array<[MenuStatus, StatusAction]> = MENU_STATUSES.flatMap((status) => STATUS_ACTIONS.map((action) => [status, action] as [MenuStatus, StatusAction]));
    expect(pairs).toHaveLength(12);
    for (const [status, action] of pairs) {
      if (listed.has(`${status}:${action}`)) continue;
      for (const hasLiveRevision of [true, false]) {
        for (const statusBeforeArchive of [null, 'DRAFT', 'PUBLISHED'] as const) {
          expect(nextMenuStatus(status, action, { hasLiveRevision, statusBeforeArchive }), `${status} ${action}`).toBeNull();
        }
      }
    }
  });
});
