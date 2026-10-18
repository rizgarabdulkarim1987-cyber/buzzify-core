import { redirect } from 'next/navigation';

/** The Sales tab opens on its first page until the Overview has its own. */
export default async function SalesPage({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/studio/menus/${(await params).id}/sales/upgrades`);
}
