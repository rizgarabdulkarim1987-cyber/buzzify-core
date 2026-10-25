import { notFound, serveStyleFile } from '@/server/studio/style-files';
import { STYLE_PAGES, type StylePage } from '@/studio/styles/catalog';

/** One of the five design mockup pages, with its own gallery of the picked styles; `?style=<key>` shows one style alone. */
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await context.params;
  // A strict allow-list, never a path built from the request.
  if (!STYLE_PAGES.includes(file as StylePage)) return notFound();
  return serveStyleFile('pages', `${file}.html`, 'text/html; charset=utf-8');
}
