import { describe, expect, it } from 'vitest';
import { CHAT_KEEP, CHAT_TYPING_MS, pushSent } from '@/ui/template/bodies/ChatBody';

describe('the chat body (The Waiter Chats)', () => {
  it('adds the guest bubble last, keeping the newest few per section', () => {
    let list = pushSent(undefined, { key: 1, name: 'a' });
    expect(list).toEqual([{ key: 1, name: 'a' }]);
    for (let key = 2; key <= 5; key++) list = pushSent(list, { key, name: String(key) });
    expect(list.map((entry) => entry.key)).toEqual([3, 4, 5]);
    expect(list).toHaveLength(CHAT_KEEP);
  });

  it('never keeps fewer than one bubble', () => {
    expect(pushSent([{ key: 1, name: 'a' }], { key: 2, name: 'b' }, 0)).toEqual([{ key: 2, name: 'b' }]);
  });

  it('types only briefly, so no dish ever waits on it', () => {
    expect(CHAT_TYPING_MS).toBeLessThanOrEqual(1000);
  });
});
