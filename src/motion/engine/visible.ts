'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether the element is on screen, or within `margin` of it. Motions pause off screen: a gallery of 150 runs only what
 * the viewer can see.
 */
export function useVisible(ref: RefObject<Element | null>, margin = '120px'): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Without IntersectionObserver (no current browser) the motion stays still rather than guessing.
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: margin,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin]);
  return visible;
}
