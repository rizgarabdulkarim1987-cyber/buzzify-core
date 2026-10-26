'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveAiSettings, testAiProvider } from '@/app/studio/_actions/ai-settings';
import type { AiSettingsView } from '@/server/ai/settings';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';

type Name = 'anthropic' | 'openai';
const NAMES: readonly Name[] = ['anthropic', 'openai'];

interface Draft {
  apiKey: string;
  askModel: string;
  fastModel: string;
}

/**
 * Settings → AI: which provider answers (Anthropic or OpenAI), each provider's key and its two model names. A key is
 * written here and never shown again: the screen says whether one is saved and its last four characters. Read-only for every
 * Super Admin but the platform owner (the page does not render this form for anyone else).
 */
export function AiSettings({ settings }: { settings: AiSettingsView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [provider, setProvider] = useState<Name>(settings.provider);
  const [drafts, setDrafts] = useState<Record<Name, Draft>>({
    anthropic: { apiKey: '', askModel: settings.providers.anthropic.askModel, fastModel: settings.providers.anthropic.fastModel },
    openai: { apiKey: '', askModel: settings.providers.openai.askModel, fastModel: settings.providers.openai.fastModel },
  });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const edit = (name: Name, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [name]: { ...all[name], ...patch } }));

  function body(removeKey?: Name) {
    const part = (name: Name) => {
      const d = drafts[name];
      return { askModel: d.askModel.trim(), fastModel: d.fastModel.trim(), ...(removeKey === name ? { apiKey: null } : d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}) };
    };
    return { provider, anthropic: part('anthropic'), openai: part('openai') };
  }

  async function save(removeKey?: Name) {
    setBusy('save');
    setProblem(null);
    setTestResult(null);
    const result = await settle(() => saveAiSettings(body(removeKey)));
    setBusy(null);
    if (!result.ok) {
      setProblem(result.error.fields?.apiKey === 'noEncryptionKey' ? t('aiSettings.noEncryptionKey') : describeFailure(t, locale, result.error).message);
      return;
    }
    setDrafts((all) => ({ anthropic: { ...all.anthropic, apiKey: '' }, openai: { ...all.openai, apiKey: '' } }));
    toast.success(t('aiSettings.saved'));
    startRefresh(() => router.refresh());
  }

  async function test() {
    setBusy('test');
    setTestResult(null);
    const result = await settle(() => testAiProvider({}));
    setBusy(null);
    if (!result.ok) return void setTestResult({ ok: false, text: describeFailure(t, locale, result.error).message });
    const data = result.data;
    if (data.ok) return void setTestResult({ ok: true, text: t('aiSettings.testOk', { provider: t(`aiSettings.provider.${data.provider}`) }) });
    const failed = data.checks.filter((check) => !check.ok).map((check) => `[${check.purpose}: ${check.detail ?? 'failed'}]`);
    setTestResult({ ok: false, text: `${t('pos.ai.error.aiUnavailable')} ${data.detail ? `(${data.detail})` : failed.join(' ')}` });
  }

  const pending = busy !== null || refreshing;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold text-text">{t('aiSettings.title')}</h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('aiSettings.intro')}</p>
      </div>

      {!settings.canStoreKeys && <Alert tone="neutral">{t('aiSettings.noEncryptionKey')}</Alert>}
      {problem && <Alert tone="danger">{problem}</Alert>}

      <Field label={t('aiSettings.active')} hint={t('aiSettings.activeHint')}>
        <Select value={provider} onChange={(event) => setProvider(event.target.value as Name)} options={NAMES.map((name) => ({ value: name, label: t(`aiSettings.provider.${name}`) }))} />
      </Field>

      {NAMES.map((name) => {
        const view = settings.providers[name];
        const draft = drafts[name];
        return (
          <section key={name} className="flex flex-col gap-4 rounded-lg border border-line p-4" aria-labelledby={`ai-${name}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`ai-${name}`} className="text-base font-semibold text-text">{t(`aiSettings.provider.${name}`)}</h3>
              <StatusBadge tone={view.keySource === 'none' ? undefined : 'success'}>
                {view.keySource === 'saved' ? t('aiSettings.key.saved', { last4: view.last4 ?? '' }) : view.keySource === 'environment' ? t('aiSettings.key.environment') : t('aiSettings.key.none')}
              </StatusBadge>
            </div>
            <Field label={t('aiSettings.apiKey')} hint={t('aiSettings.apiKeyHint')}>
              <Input type="password" dir="ltr" autoComplete="off" spellCheck={false} placeholder={view.keySource === 'saved' ? '••••••••' : ''} value={draft.apiKey} onChange={(event) => edit(name, { apiKey: event.target.value })} disabled={!settings.canStoreKeys} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('aiSettings.askModel')} hint={t('aiSettings.askModelHint')}>
                <Input dir="ltr" placeholder={view.defaultAsk} value={draft.askModel} onChange={(event) => edit(name, { askModel: event.target.value })} />
              </Field>
              <Field label={t('aiSettings.fastModel')} hint={t('aiSettings.fastModelHint')}>
                <Input dir="ltr" placeholder={view.defaultFast} value={draft.fastModel} onChange={(event) => edit(name, { fastModel: event.target.value })} />
              </Field>
            </div>
            {view.keySource === 'saved' && (
              <div>
                <Button variant="secondary" size="md" disabled={pending} onClick={() => void save(name)}>
                  {t('aiSettings.removeKey')}
                </Button>
              </div>
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="md" pending={busy === 'save' || refreshing} disabled={pending} onClick={() => void save()}>
          {t('aiSettings.save')}
        </Button>
        <Button variant="secondary" size="md" pending={busy === 'test'} disabled={pending} onClick={() => void test()}>
          {t('aiSettings.test')}
        </Button>
        {testResult && (
          <span role="status" className={testResult.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
            {testResult.text}
          </span>
        )}
      </div>
      <p className="max-w-[72ch] text-sm text-muted">{t('aiSettings.testNote')}</p>
    </div>
  );
}
