import { notFound, serveStyleFile } from '@/server/studio/style-files';
import { menuStyleById } from '@/studio/styles/catalog';

/** The poster of one picked style (a still of its menu), by the style's catalog id. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const style = menuStyleById(id);
  if (!style) return notFound();
  return serveStyleFile('posters', `${style.id}.webp`, 'image/webp');
}
