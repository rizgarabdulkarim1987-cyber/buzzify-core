/**
 * Every refusal of the AI package, each with the code a screen shows. A service throws these; a definition turns them into
 * `{ ok: false, code }` (`ai-error-code.ts`) so the till never reads an exception message that might carry content.
 */

export class AiNotEnabledError extends Error {
  readonly code = 'aiDisabled' as const;
  constructor() {
    super('The AI package is not switched on');
    this.name = 'AiNotEnabledError';
  }
}

/** The provider is missing, failed or timed out. Everything else keeps working. */
export class AiUnavailableError extends Error {
  readonly code = 'aiUnavailable' as const;
  constructor(message = 'The AI provider is not available') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export class AiTimeoutError extends AiUnavailableError {
  constructor() {
    super('The AI provider did not answer in time');
    this.name = 'AiTimeoutError';
  }
}

export class AiProviderError extends AiUnavailableError {
  constructor() {
    super('The AI provider failed');
    this.name = 'AiProviderError';
  }
}

export class AiRefusedError extends Error {
  readonly code = 'aiRefused' as const;
  constructor() {
    super('The AI provider declined the request');
    this.name = 'AiRefusedError';
  }
}

export class AiLimitReachedError extends Error {
  readonly code = 'aiLimit' as const;
  constructor() {
    super("This month's AI requests are used up");
    this.name = 'AiLimitReachedError';
  }
}

/** The model's text did not pass the grounding check (a number nobody supplied, or an accusation). */
export class AiOutputRejectedError extends Error {
  readonly code = 'ungrounded' as const;
  constructor() {
    super('The AI answer was rejected');
    this.name = 'AiOutputRejectedError';
  }
}

/** The model's output could not be read into the expected shape. */
export class AiUnreadableError extends Error {
  readonly code = 'unreadable' as const;
  constructor() {
    super('The AI output could not be read');
    this.name = 'AiUnreadableError';
  }
}

export class AiInputTooLargeError extends Error {
  readonly code = 'tooLarge' as const;
  constructor() {
    super('The input is too large');
    this.name = 'AiInputTooLargeError';
  }
}

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown AI tool ${name.slice(0, 40)}`);
    this.name = 'UnknownToolError';
  }
}
