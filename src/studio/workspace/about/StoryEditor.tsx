'use client';

import { ArrowDown, ArrowUp, Link2, Plus, Trash2 } from 'lucide-react';
import type { StoryBlock } from '@/server/domain/about';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';

/** A block while it is being edited: a list is one text box with an item per line. */
export interface DraftBlock {
  type: 'heading' | 'paragraph' | 'list';
  text: string;
  links: { text: string; href: string }[];
}

export const toDrafts = (blocks: StoryBlock[] | undefined): DraftBlock[] =>
  (blocks ?? []).map((block) => ({
    type: block.type,
    text: block.type === 'list' ? block.text.join('\n') : block.text,
    links: block.links ?? [],
  }));

/** What is saved: empty blocks, empty list lines and half-filled links are dropped rather than refused. */
export function fromDrafts(drafts: DraftBlock[]): StoryBlock[] {
  const blocks: StoryBlock[] = [];
  for (const draft of drafts) {
    const links = draft.links.map((link) => ({ text: link.text.trim(), href: link.href.trim() })).filter((link) => link.text !== '' && link.href !== '');
    const extra = links.length > 0 ? { links } : {};
    if (draft.type === 'list') {
      const items = draft.text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
      if (items.length > 0) blocks.push({ type: 'list', text: items, ...extra });
    } else if (draft.text.trim() !== '') {
      blocks.push({ type: draft.type, text: draft.text.trim(), ...extra });
    }
  }
  return blocks;
}

const LABELS = { heading: 'aboutPage.blockHeading', paragraph: 'aboutPage.blockParagraph', list: 'aboutPage.blockList' } as const;

export interface StoryEditorProps {
  drafts: DraftBlock[];
  onChange: (next: DraftBlock[]) => void;
  /** The language the story is written in, for the text direction and the screen reader. */
  language: string;
  lang: string;
  rtl: boolean;
  error?: string | undefined;
}

/** Headings, paragraphs and lists for one language; reorder, remove, and a few links under each block. */
export function StoryEditor({ drafts, onChange, language, lang, rtl, error }: StoryEditorProps) {
  const t = useT();
  const set = (index: number, change: Partial<DraftBlock>) => onChange(drafts.map((draft, at) => (at === index ? { ...draft, ...change } : draft)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...drafts];
    const [taken] = next.splice(index, 1);
    if (taken) next.splice(index + by, 0, taken);
    onChange(next);
  };
  const add = (type: DraftBlock['type']) => onChange([...drafts, { type, text: '', links: [] }]);
  const direction = { lang, dir: rtl ? ('rtl' as const) : ('ltr' as const) };

  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft, index) => {
        const label = t(LABELS[draft.type]);
        const named = t('content.inLanguage', { field: label, language });
        return (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{label}</span>
              <div className="flex gap-1">
                <IconButton size="sm" icon={<ArrowUp aria-hidden />} label={t('aboutPage.moveUp')} disabled={index === 0} onClick={() => move(index, -1)} />
                <IconButton size="sm" icon={<ArrowDown aria-hidden />} label={t('aboutPage.moveDown')} disabled={index === drafts.length - 1} onClick={() => move(index, 1)} />
                <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('aboutPage.removeBlock')} onClick={() => onChange(drafts.filter((_, at) => at !== index))} />
              </div>
            </div>
            {draft.type === 'heading' ? (
              <Input value={draft.text} maxLength={2000} aria-label={named} {...direction} onChange={(event) => set(index, { text: event.target.value })} />
            ) : (
              <Textarea rows={draft.type === 'list' ? 4 : 3} value={draft.text} maxLength={draft.type === 'list' ? 20000 : 2000} aria-label={named} {...direction} onChange={(event) => set(index, { text: event.target.value })} />
            )}
            {draft.type !== 'heading' &&
              draft.links.map((link, at) => (
                <div key={at} className="flex flex-wrap items-center gap-2">
                  <Input value={link.text} maxLength={200} placeholder={t('aboutPage.linkText')} aria-label={t('aboutPage.linkText')} {...direction} className="min-w-0 flex-1 basis-40" onChange={(event) => set(index, { links: draft.links.map((one, i) => (i === at ? { ...one, text: event.target.value } : one)) })} />
                  <Input value={link.href} maxLength={500} placeholder={t('aboutPage.linkHref')} aria-label={t('aboutPage.linkHref')} dir="ltr" className="min-w-0 flex-1 basis-56" onChange={(event) => set(index, { links: draft.links.map((one, i) => (i === at ? { ...one, href: event.target.value } : one)) })} />
                  <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('aboutPage.removeLink')} onClick={() => set(index, { links: draft.links.filter((_, i) => i !== at) })} />
                </div>
              ))}
            {draft.type !== 'heading' && draft.links.length < 10 && (
              <div>
                <Button size="sm" variant="ghost" icon={<Link2 aria-hidden />} onClick={() => set(index, { links: [...draft.links, { text: '', href: '' }] })}>
                  {t('aboutPage.addLink')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {(['heading', 'paragraph', 'list'] as const).map((type) => (
          <Button key={type} size="sm" icon={<Plus aria-hidden />} onClick={() => add(type)} disabled={drafts.length >= 40}>
            {t(type === 'heading' ? 'aboutPage.addHeading' : type === 'paragraph' ? 'aboutPage.addParagraph' : 'aboutPage.addList')}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className={cx('text-sm text-danger')}>
          {error}
        </p>
      )}
    </div>
  );
}
