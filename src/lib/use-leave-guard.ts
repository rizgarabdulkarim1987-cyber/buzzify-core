'use client';

import { useEffect } from 'react';

/**
 * While `dirty`, leaving the page asks first: closing, reloading or typing an address (the browser's own `beforeunload`
 * question), and following any link to another page of this site, wherever it is on the page (the shell's navigation, a
 * link in a message). A link click is caught in the capture phase, before the router's own handler, so "no" keeps the
 * person here and nothing navigates. Links that open elsewhere (a new tab, a download, a modified click) are let through.
 */
export function useLeaveGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || (anchor.target !== '' && anchor.target !== '_self')) return;
      let to: URL;
      try {
        to = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Another site: the browser's beforeunload question covers it. The same page (a jump to an anchor) is not leaving.
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
