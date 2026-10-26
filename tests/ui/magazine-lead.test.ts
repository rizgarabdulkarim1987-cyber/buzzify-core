import { describe, expect, it } from 'vitest';
import { splitLead } from '@/ui/template/bodies/lead';

const dish = (id: string, kind: string) => ({ id, media: [{ kind }] });

describe('splitLead', () => {
  it('leads with the first dish that has a photo, keeping the rest in order', () => {
    const { lead, rest } = splitLead([dish('a', 'art'), dish('b', 'image'), dish('c', 'image')]);
    expect(lead?.id).toBe('b');
    expect(rest.map((p) => p.id)).toEqual(['a', 'c']);
  });
  it('falls back to the first dish when none has a photo', () => {
    const { lead, rest } = splitLead([dish('a', 'art'), dish('b', 'art')]);
    expect(lead?.id).toBe('a');
    expect(rest.map((p) => p.id)).toEqual(['b']);
  });
  it('handles an empty section', () => {
    expect(splitLead([])).toEqual({ lead: undefined, rest: [] });
  });
});
