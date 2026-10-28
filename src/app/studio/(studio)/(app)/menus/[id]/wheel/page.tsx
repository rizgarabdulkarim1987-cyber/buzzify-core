import { redirect } from 'next/navigation';

/** The wheel is a section of the Explore tab now; an old link to its own tab lands there. */
export default async function WheelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/studio/menus/${id}/about`);
}
