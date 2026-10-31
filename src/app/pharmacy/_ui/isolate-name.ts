/** Keeps a name from reordering the words around it in a right-to-left sentence (first strong isolate, pop isolate). Usable on the server. */
export const isolateName = (text: string): string => `\u2068${text}\u2069`;
