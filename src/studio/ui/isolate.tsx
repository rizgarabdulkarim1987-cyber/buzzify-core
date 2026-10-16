import { Fragment, type ReactNode } from 'react';

/**
 * A translated sentence with its placeholders filled by text from outside the catalog (an email, a restaurant's name),
 * each in a `<bdi>`, so a Latin address inside an Arabic sentence (or an Arabic name inside an English one) keeps its own
 * reading order and the sentence's punctuation stays where it belongs. Pass the template as `t(key)` returns it without
 * parameters; placeholders without a value are left as they are.
 */
export function isolated(template: string, values: Record<string, string>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name !== undefined && name in values) return <bdi key={index}>{values[name]}</bdi>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
