import { describe, expect, it } from 'vitest';
import { isCountableAgent, showsCounts, VIEW_IP_LIMIT, viewCounts } from '@/server/domain/dish-counts';

describe('isCountableAgent', () => {
  it('counts an ordinary phone browser', () => {
    expect(isCountableAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).toBe(true);
  });

  it.each(['Googlebot/2.1 (+http://www.google.com/bot.html)', 'WhatsApp/2.23.20', 'facebookexternalhit/1.1', 'Mozilla/5.0 HeadlessChrome/120', 'Slackbot-LinkExpanding 1.0', 'Lighthouse', 'TelegramBot (like TwitterBot)', 'Link Preview Fetcher'])(
    'does not count %s',
    (agent) => expect(isCountableAgent(agent)).toBe(false),
  );

  it('does not count a request with no user agent', () => {
    expect(isCountableAgent(null)).toBe(false);
    expect(isCountableAgent('')).toBe(false);
  });
});

describe('viewCounts', () => {
  it('counts a new device while its address is under the limit', () => {
    expect(VIEW_IP_LIMIT).toBe(3);
    expect(viewCounts({ deviceSeen: false, addressViews: 0 })).toBe(true);
    expect(viewCounts({ deviceSeen: false, addressViews: 2 })).toBe(true);
  });

  it('does not count a device that already counted today', () => {
    expect(viewCounts({ deviceSeen: true, addressViews: 0 })).toBe(false);
  });

  it('does not count once the address has reached the limit', () => {
    expect(viewCounts({ deviceSeen: false, addressViews: 3 })).toBe(false);
    expect(viewCounts({ deviceSeen: false, addressViews: 10 })).toBe(false);
  });
});

describe('showsCounts', () => {
  it('shows a dish only from its first paid order', () => {
    expect(showsCounts(0)).toBe(false);
    expect(showsCounts(1)).toBe(true);
    expect(showsCounts(340)).toBe(true);
  });
});
