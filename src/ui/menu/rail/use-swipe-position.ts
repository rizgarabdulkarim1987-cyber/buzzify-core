'use client';

import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/** How far a press can wander before it counts as a drag rather than a tap. */
const DRAG_SLOP = 6;

interface Press {
  id: number;
  x: number;
  base: number;
  dragged: boolean;
}

/**
 * Which item a rail that does not scroll natively (the deck, the drum) is turned to. It follows the active
 * category, and the guest can drag sideways to turn it: `step` pixels of drag move it by one item, it settles
 * on the nearest item when released, and a drag that ends over an item is not a tap on it.
 */
export function useSwipePosition(active: number, count: number, rtl: boolean, step: number) {
  const last = Math.max(0, count - 1);
  const press = useRef<Press | null>(null);

  const [centre, setCentre] = useState(active);
  const [followed, setFollowed] = useState(active);
  if (followed !== active) {
    setFollowed(active);
    setCentre(active);
  }
  const [dragAt, setDragAt] = useState<number | null>(null);

  const along = (event: PointerEvent<HTMLElement>, from: Press) => (rtl ? -1 : 1) * (event.clientX - from.x);
  const turnedTo = (from: Press, distance: number) => Math.min(last, Math.max(0, from.base - distance / step));

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      press.current = { id: event.pointerId, x: event.clientX, base: centre, dragged: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const from = press.current;
      if (!from || from.id !== event.pointerId) return;
      const distance = along(event, from);
      if (!from.dragged) {
        if (Math.abs(distance) < DRAG_SLOP) return;
        from.dragged = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setDragAt(turnedTo(from, distance));
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const from = press.current;
      if (!from || from.id !== event.pointerId || !from.dragged) return;
      setCentre(Math.round(turnedTo(from, along(event, from))));
      setDragAt(null);
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      handlers.onPointerUp(event);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (press.current?.dragged) event.preventDefault();
      press.current = null;
    },
  };

  return {
    /** Fractional while dragging. */
    position: Math.min(last, dragAt ?? centre),
    dragging: dragAt !== null,
    /** Turn to an item, for example the one that has keyboard focus. */
    turnTo: setCentre,
    handlers,
  };
}
