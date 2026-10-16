import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/** A terminal input as far as the prompts need it: a stream that may be a TTY and, if so, can be put in raw mode. */
export type PromptInput = Readable & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };

export interface Prompter {
  /** Asks for a line of text, shown as it is typed. */
  ask(label: string): Promise<string>;
  /** Asks for a line of text that is never shown: nothing typed is echoed, not even as asterisks. */
  askHidden(label: string): Promise<string>;
  close(): void;
}

const ENTER = new Set(['\r', '\n']);
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const ESCAPE = '\u001b';
const BACKSPACE = new Set(['\u007f', '\b']);

/**
 * Prompts on `input` and `output`. On a terminal each answer is read key by key in raw mode, so a hidden one is never
 * written back to the screen; when input is piped (a script, a test) each answer is the next line, and hidden answers
 * are not echoed either, since nothing is. Ctrl+C and the end of input reject with an error rather than answering.
 */
export function createPrompter(input: PromptInput, output: Writable): Prompter {
  const interactive = Boolean(input.isTTY && typeof input.setRawMode === 'function');

  // Piped: lines are pulled one at a time from a readline iterator, so nothing is read before it is asked for.
  const lines = interactive ? null : createInterface({ input, crlfDelay: Infinity });
  const iterator = lines?.[Symbol.asyncIterator]();

  async function readPiped(label: string): Promise<string> {
    output.write(label);
    const next = await (iterator as AsyncIterator<string>).next();
    output.write('\n');
    if (next.done) throw new Error('There was no more input to answer the question with');
    return next.value;
  }

  function readKeys(label: string, hidden: boolean): Promise<string> {
    output.write(label);
    return new Promise((resolve, reject) => {
      let answer = '';
      const finish = (done: () => void) => {
        input.off('data', onData);
        input.setRawMode?.(false);
        input.pause();
        output.write('\n');
        done();
      };
      const onData = (chunk: Buffer | string) => {
        const keys = Array.from(chunk.toString());
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i] as string;
          if (ENTER.has(key)) return finish(() => resolve(answer));
          if (key === CTRL_C || key === CTRL_D) return finish(() => reject(new Error('Cancelled')));
          if (key === ESCAPE) {
            // An arrow or function key (`ESC [ A`, `ESC [ 1 ; 5 C`): skip the whole sequence rather than typing it.
            if (keys[i + 1] === '[' || keys[i + 1] === 'O') {
              i += 1;
              while (i + 1 < keys.length && !/[A-Za-z~]/.test(keys[i + 1] as string)) i += 1;
              i += 1;
            }
            continue;
          }
          if (BACKSPACE.has(key)) {
            if (answer.length > 0) {
              answer = Array.from(answer).slice(0, -1).join('');
              if (!hidden) output.write('\b \b');
            }
            continue;
          }
          if (key >= ' ') {
            answer += key;
            if (!hidden) output.write(key);
          }
        }
      };
      input.setRawMode?.(true);
      input.setEncoding?.('utf8');
      input.on('data', onData);
      input.resume();
    });
  }

  const read = (label: string, hidden: boolean) => (interactive ? readKeys(label, hidden) : readPiped(label));

  return {
    ask: (label) => read(label, false),
    askHidden: (label) => read(label, true),
    close: () => lines?.close(),
  };
}
