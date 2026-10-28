import type { StoryBlock } from '@/server/domain/about';

/**
 * The story, drawn by components from the stored block list: every string is a text node (React escapes it), a link is an
 * anchor the page built from a checked address. Nothing the restaurant typed is parsed as markup.
 */
export function StoryBlocks({ blocks }: { blocks: StoryBlock[] }) {
  return (
    <div className="flex flex-col gap-4 text-base leading-relaxed text-text">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h3 key={index} className="mt-2 break-words font-display text-2xl tracking-[-0.005em]">
              {block.text}
            </h3>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className="list-disc space-y-1 ps-6 marker:text-accent">
              {block.text.map((item, at) => (
                <li key={at} className="break-words">
                  {item}
                </li>
              ))}
              <BlockLinks links={block.links} />
            </ul>
          );
        }
        return (
          <p key={index} className="break-words">
            {block.text}
            <BlockLinks links={block.links} inline />
          </p>
        );
      })}
    </div>
  );
}

function BlockLinks({ links, inline = false }: { links: { text: string; href: string }[] | undefined; inline?: boolean }) {
  if (!links || links.length === 0) return null;
  const anchors = links.map((link) => {
    const external = link.href.startsWith('https://');
    return (
      <a
        key={link.href + link.text}
        href={link.href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="break-words text-accent underline underline-offset-4"
      >
        {link.text}
      </a>
    );
  });
  if (inline) {
    return (
      <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{anchors}</span>
    );
  }
  return <li className="list-none ps-0">{<span className="flex flex-wrap gap-x-4 gap-y-1">{anchors}</span>}</li>;
}
