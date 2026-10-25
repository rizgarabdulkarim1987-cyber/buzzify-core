import type { Messages } from '@/lib/i18n';

/** Settings → AI: the provider and its key. Spread into the Studio catalog by `../en.ts`. */
const aiSettings: Messages = {
  'settings.tabs.ai': 'AI',
  'activity.entity.AiSettings': 'AI settings',
  'activity.action.ai.settings.update': 'Changed the AI settings',

  'aiSettings.title': 'AI provider',
  'aiSettings.intro': 'Choose which company answers the AI questions of every restaurant that has the AI package, and save its key. The key is stored encrypted and is never shown again.',
  'aiSettings.active': 'Provider in use',
  'aiSettings.activeHint': 'Switching takes effect within a minute. Nothing else changes for the restaurants.',
  'aiSettings.provider.anthropic': 'Anthropic (Claude)',
  'aiSettings.provider.openai': 'OpenAI',
  'aiSettings.key.saved': 'Key saved, ends in {last4}',
  'aiSettings.key.environment': 'Using the server key',
  'aiSettings.key.none': 'No key',
  'aiSettings.apiKey': 'API key',
  'aiSettings.apiKeyHint': 'Paste a new key to replace the saved one. Leave empty to keep it.',
  'aiSettings.askModel': 'Model for questions and invoices',
  'aiSettings.askModelHint': 'Leave empty for the built-in model shown.',
  'aiSettings.fastModel': 'Model for short summaries and labels',
  'aiSettings.fastModelHint': 'A smaller, cheaper model is enough. Leave empty for the built-in one.',
  'aiSettings.removeKey': 'Remove the saved key',
  'aiSettings.save': 'Save',
  'aiSettings.saved': 'AI settings saved',
  'aiSettings.test': 'Test the connection',
  'aiSettings.testOk': 'It works: {provider} answered.',
  'aiSettings.testNote': 'The test sends one tiny request with the provider in use. It is not counted against any restaurant.',
  'aiSettings.noEncryptionKey': 'A key cannot be saved here yet: the server has no AI_SETTINGS_ENCRYPTION_KEY. Set it, or put the provider key in the server settings instead.',
};

export default aiSettings;
