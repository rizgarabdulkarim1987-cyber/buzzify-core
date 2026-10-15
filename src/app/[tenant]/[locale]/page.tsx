export default async function Page({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  return (
    <main>
      <h1>{tenant}</h1>
    </main>
  );
}
