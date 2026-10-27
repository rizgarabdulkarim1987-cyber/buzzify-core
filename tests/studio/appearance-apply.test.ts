import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@/lib/appearance';
import { appearanceHtmlProps } from '@/studio/appearance-html';

describe('appearanceHtmlProps', () => {
  it('adds nothing for a signed-out visitor or a person on the default look', () => {
    expect(appearanceHtmlProps(null)).toEqual({});
    expect(appearanceHtmlProps(undefined)).toEqual({});
    expect(appearanceHtmlProps(DEFAULT_APPEARANCE)).toEqual({});
  });

  it('puts the chosen button shape on <html> as a variable and a data attribute', () => {
    const props = appearanceHtmlProps({ ...DEFAULT_APPEARANCE, bg: '#fafafa', shape: 'round' });
    expect(props.style?.['--s-btn-radius' as never]).toBe('9999px');
    expect(props['data-shape']).toBe('round');
  });

  it('puts the chosen colours on <html>', () => {
    const props = appearanceHtmlProps({ font: 'studio', bg: '#101010', text: '#f5f5f5', button: '#f2b705', buttonText: '#000000', shape: 'square' });
    expect(props.style?.['--s-bg' as never]).toBe('#101010');
  });

  it('falls back to the default look for a damaged stored value', () => {
    expect(appearanceHtmlProps({ bg: 'nope' } as never)).toEqual({});
  });
});
