'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/photo-card.css';
import './shared/shapes.css';
import './chat.css';

/** One bubble the guest "sent" by adding a dish: its key, and the dish's name. */
export interface ChatSent {
  key: number;
  name: string;
}

/** How many of the guest's own bubbles a section keeps under its album, so adding many dishes never grows the page much. */
export const CHAT_KEEP = 3;

/** The section's sent bubbles after one more: the newest last, at most `keep` (the oldest go first). */
export function pushSent(list: readonly ChatSent[] | undefined, next: ChatSent, keep = CHAT_KEEP): ChatSent[] {
  return [...(list ?? []), next].slice(-Math.max(1, keep));
}

/** How long the waiter's typing dots show, the first time only (ms). Short, and the dishes never wait for it. */
export const CHAT_TYPING_MS = 700;

/**
 * The Waiter Chats (kind `chat`, النادل يراسلك): the menu as a chat with the waiter. The sticky top is the chat's bar,
 * the waiter's avatar (the restaurant's logo) and name (`logoText`), with the sections as chips under it. Each section
 * is a received bubble (its name and count) followed by an album bubble holding all its dishes, two photos a row, each
 * with its name, price and a round add on the photo's corner: every dish is on the page at once, nothing is typed out
 * before a guest can see it. Adding a dish sends the guest's own green bubble (the dish's name, two ticks); the very
 * first time the waiter types for a moment and answers with a nod. Less motion: no pop, no typing, the answer at once.
 */
export function ChatBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const [sent, setSent] = useState<Record<string, ChatSent[]>>({});
  const [typing, setTyping] = useState<string | null>(null);
  const typed = useRef(false);
  const counter = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const send = useCallback(
    (categoryId: string, name: string) => {
      counter.current += 1;
      const entry = { key: counter.current, name };
      setSent((all) => ({ ...all, [categoryId]: pushSent(all[categoryId], entry) }));
      if (reduced || typed.current) return;
      typed.current = true;
      setTyping(categoryId);
      timer.current = window.setTimeout(() => setTyping(null), CHAT_TYPING_MS);
    },
    [reduced],
  );

  return (
    <div className="tpl-body" data-body="chat" data-still={reduced ? '' : undefined}>
      <SectionStrip
        marker="chats"
        prefix="ch"
        lead={
          <div className="ch-bar">
            <span aria-hidden className="ch-avatar">
              {tenant.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tenant.logo.url} alt="" width={tenant.logo.width} height={tenant.logo.height} />
              ) : (
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8.5" r="4" fill="currentColor" />
                  <path d="M4.5 21c.8-4.2 3.8-6.5 7.5-6.5s6.7 2.3 7.5 6.5z" fill="currentColor" />
                  <path d="M9.5 15.6 12 17.4l2.5-1.8v3l-2.5-1.2-2.5 1.2z" fill="var(--accent)" />
                </svg>
              )}
              <i className="ch-online" />
            </span>
            <b className="ch-waiter">{tenant.logoText}</b>
          </div>
        }
      >
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0 ch-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const mine = sent[category.id] ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last ch-section">
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                count={n(products.length)}
                className="ch-head"
                title="ch-title"
              />
              <div className="ch-msg ch-album">
                <ul className="ch-grid">
                  {products.map((product, at) => (
                    <li key={product.id} data-row className="ch-pic">
                      <div data-photo className="ch-photo tpl-plate">
                        <ProductMedia product={product} suffix="chat" sizes="(min-width: 640px) 260px, 45vw" priority={index === 0 && at < 4} className="ch-img" />
                        <QuickAction product={product} variant="icon" className="ch-add relative z-[2]" onAdded={() => send(category.id, product.name)} />
                      </div>
                      <div className="ch-cap">
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open ch-name text-start">
                          {product.name}
                        </button>
                        <span className="ch-meta">
                          <Price product={product} className="ch-price" />
                          <Badges product={product} className="ch-badges" />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              {mine.length > 0 || typing === category.id ? (
                <div aria-hidden className="ch-log">
                  {mine.map((entry) => (
                    <p key={entry.key} className="ch-msg ch-me">
                      <span>{entry.name}</span>
                      <i className="ch-ticks">✓✓</i>
                    </p>
                  ))}
                  {typing === category.id ? (
                    <p className="ch-msg ch-typing">
                      <i />
                      <i />
                      <i />
                    </p>
                  ) : mine.length > 0 ? (
                    <p className="ch-msg ch-nod">👌</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </main>
    </div>
  );
}
