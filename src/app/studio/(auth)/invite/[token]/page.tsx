import type { Metadata } from 'next';
import { getInvitation } from '@/app/studio/_actions/people';
import { getActor } from '@/server/studio/auth/actor';
import { describeFailure } from '@/studio/errors';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { Alert } from '@/studio/ui/Alert';
import { InviteFlow } from './InviteFlow';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('auth.invite.title') };
}

/**
 * The page an invitation email links to. What the token stands for is read through the public invitation action (the
 * token is the whole credential, so it is limited per address like accepting); the client part then takes the person
 * through creating an account, or accepting with the account they have.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, locale, actor] = await Promise.all([params, requestStudioLocale(), getActor()]);
  const t = getStudioTranslator(locale);
  const view = await getInvitation({ token });

  if (!view.ok) {
    return (
      <AuthPanel title={t('auth.invite.title')}>
        <Alert tone="danger">{describeFailure(t, locale, view.error).message}</Alert>
      </AuthPanel>
    );
  }
  return <InviteFlow token={token} view={view.data} signedInEmail={actor?.email ?? null} />;
}
