import type { ReactNode } from 'react';

export interface FormSectionProps {
  /** The heading's id, which names the section for assistive technology. */
  id: string;
  title: string;
  /** What the section is for. */
  intro?: string;
  children: ReactNode;
}

/** One part of a long form: its heading and what it is for on the start side, its fields beside them. */
export function FormSection({ id, title, intro, children }: FormSectionProps) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 first:border-t-0 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-4">{children}</div>
    </section>
  );
}
