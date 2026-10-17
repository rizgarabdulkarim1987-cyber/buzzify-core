import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/locale';
import { liveStateKeys, type LiveState } from '@/studio/menu-live';
import { getStudioTranslator } from '@/studio/messages';

const live: LiveState = { status: 'PUBLISHED', restaurantStatus: 'ACTIVE', hasLiveRevision: true, unpublished: false };

describe('what the menu page says about its live version', () => {
  it('says guests see the draft only for a published menu of an active restaurant whose draft has not changed', () => {
    expect(liveStateKeys(live)).toEqual(['menus.live.upToDate']);
    expect(liveStateKeys({ ...live, unpublished: true })).toEqual(['menus.live.unpublished']);
  });

  it('says guests see an unavailable page while the menu is suspended or archived, and how the draft compares', () => {
    expect(liveStateKeys({ ...live, status: 'SUSPENDED' })).toEqual(['menus.live.state.SUSPENDED', 'menus.live.state.heldUpToDate']);
    expect(liveStateKeys({ ...live, status: 'ARCHIVED', unpublished: true })).toEqual([
      'menus.live.state.ARCHIVED',
      'menus.live.state.heldUnpublished',
    ]);
  });

  it('says the same while its restaurant is suspended or archived, naming the menu first when both are', () => {
    expect(liveStateKeys({ ...live, restaurantStatus: 'SUSPENDED' })).toEqual([
      'menus.live.state.restaurant.SUSPENDED',
      'menus.live.state.heldUpToDate',
    ]);
    expect(liveStateKeys({ ...live, restaurantStatus: 'ARCHIVED', unpublished: true })).toEqual([
      'menus.live.state.restaurant.ARCHIVED',
      'menus.live.state.heldUnpublished',
    ]);
    expect(liveStateKeys({ ...live, status: 'SUSPENDED', restaurantStatus: 'ARCHIVED' })[0]).toBe('menus.live.state.SUSPENDED');
  });

  it('says a menu never published is not found, whatever its status', () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      expect(liveStateKeys({ ...live, status, hasLiveRevision: false })).toEqual(['menus.live.none']);
    }
  });

  it('has every sentence in every language', () => {
    const states: LiveState[] = [];
    for (const status of ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED'] as const) {
      for (const restaurantStatus of ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const) {
        for (const unpublished of [false, true]) states.push({ status, restaurantStatus, hasLiveRevision: status !== 'DRAFT', unpublished });
      }
    }
    for (const locale of LOCALES) {
      const t = getStudioTranslator(locale);
      for (const key of new Set(states.flatMap(liveStateKeys))) expect(t(key), `${locale} ${key}`).not.toBe(key);
    }
  });
});
