'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { direction } from '@/lib/locale';
import type { StoryView } from '@/server/data/stories';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { CloseIcon } from '@/ui/Icons';
import { useTemplate } from './context';
import './showcase.css';

/**
 * The restaurant's stories (plan feature `guest.stories`): a row of round pictures at the top of the menu, and a
 * full-screen viewer a guest steps through by tapping. Nothing plays by itself: no timer, no autoplay, no animation,
 * so the menu stays as light as without it. The row is a labelled list scrolled by the browser; the viewer is a modal
 * dialog that Escape and the close button leave, and that returns focus to the picture it was opened from.
 */
export function StoriesRail({ stories }: { stories: readonly StoryView[] }) {
  const { t, locale } = useApp();
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();
  if (stories.length === 0) return null;
  return (
    <section id={id} aria-label={t('stories.label')} dir={direction(locale)} className="tpl-stories">
      <ul tabIndex={0} aria-labelledby={id} className="tpl-stories-strip scroll-hidden">
        {stories.map((story, index) => (
          <li key={story.id}>
            <button
              type="button"
              className="tpl-story"
              aria-label={t('stories.open', { caption: story.caption || String(index + 1) })}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(index);
              }}
            >
              <span className="tpl-story-ring">
                <ProductVisual media={[story.image]} name={story.caption} slug={`story-${story.id}`} className="tpl-story-pic" sizes="72px" />
              </span>
              {story.caption && <span className="tpl-story-caption">{story.caption}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && (
        <StoryViewer
          stories={stories}
          start={open}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      )}
    </section>
  );
}

function StoryViewer({ stories, start, onClose }: { stories: readonly StoryView[]; start: number; onClose: () => void }) {
  const { t, locale } = useApp();
  const { view, openProduct } = useTemplate();
  const [index, setIndex] = useState(start);
  const close = useRef<HTMLButtonElement>(null);
  const story = stories[index];
  const rtl = direction(locale) === 'rtl';

  const step = useCallback(
    (by: number) => {
      const next = index + by;
      if (next < 0) return;
      if (next >= stories.length) onClose();
      else setIndex(next);
    },
    [index, stories.length, onClose],
  );

  useEffect(() => {
    close.current?.focus();
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = scroll;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      // The arrows follow the reading direction: "next" is to the right in English and to the left in Arabic.
      else if (event.key === 'ArrowRight') step(rtl ? -1 : 1);
      else if (event.key === 'ArrowLeft') step(rtl ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, step, rtl]);

  if (!story) return null;
  const product = story.productSlug ? view.products.find((candidate) => candidate.slug === story.productSlug) : undefined;

  return (
    <div role="dialog" aria-modal="true" aria-label={t('stories.label')} dir={direction(locale)} className="tpl-story-viewer">
      <ol className="tpl-story-bars" aria-hidden>
        {stories.map((entry, position) => (
          <li key={entry.id} data-done={position <= index ? '' : undefined} />
        ))}
      </ol>
      <button ref={close} type="button" onClick={onClose} aria-label={t('stories.close')} className="tpl-story-close">
        <CloseIcon />
      </button>
      <div className="tpl-story-stage">
        <ProductVisual media={[story.image]} name={story.caption} slug={`story-view-${story.id}`} priority sizes="100vw" className="tpl-story-full" />
        {/* Tap the start edge for the previous story and the end edge for the next, as in the apps guests know; the edges follow the reading direction. */}
        <button type="button" className="tpl-story-hit tpl-story-hit-prev" onClick={() => step(-1)} aria-label={t('stories.previous')} disabled={index === 0} />
        <button type="button" className="tpl-story-hit tpl-story-hit-next" onClick={() => step(1)} aria-label={t('stories.next')} />
      </div>
      {(story.caption || product) && (
        <div className="tpl-story-foot">
          {story.caption && <p>{story.caption}</p>}
          {product && (
            <button
              type="button"
              className="tpl-story-dish"
              onClick={() => {
                onClose();
                openProduct(product.id);
              }}
            >
              {t('stories.openDish', { name: product.name })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
