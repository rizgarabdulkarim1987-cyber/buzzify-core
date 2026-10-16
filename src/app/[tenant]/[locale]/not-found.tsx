import { BackToMenu } from '@/ui/BackToMenu';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="font-display text-3xl">We couldn’t find that page</h1>
      <p className="text-muted">Check the link, or go back to the menu.</p>
      <BackToMenu className="mt-2 inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-on-accent">
        Back to the menu
      </BackToMenu>
    </main>
  );
}
