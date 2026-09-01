const replacement = '[REDACTED_MODEL_SECRET]';

export interface SecretRedactor {
  redactText(value: string): string;
  redactError(error: unknown): string;
  redactValue<T>(value: T): T;
}

/**
 * Main-process-only protection for values that may contain a resolved model key.
 * The caller supplies resolved configs; no secret-bearing API crosses this module's boundary.
 */
export const createSecretRedactor = (...configSources: unknown[]): SecretRedactor => {
  const secrets = collectModelApiKeys(configSources);

  const redactText = (value: string): string =>
    secrets.reduce((result, secret) => result.split(secret).join(replacement), value);

  return {
    redactText,
    redactError: (error) => redactText(error instanceof Error ? error.message : String(error)),
    redactValue: <T>(value: T): T => redactUnknown(value, redactText) as T,
  };
};

const collectModelApiKeys = (sources: unknown[]): string[] => {
  const keys = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || visited.has(value)) {
      return;
    }
    visited.add(value);
    if ('modelApiKey' in value && typeof value.modelApiKey === 'string' && value.modelApiKey) {
      keys.add(value.modelApiKey);
    }
    Object.values(value).forEach(visit);
  };

  sources.forEach(visit);
  return [...keys].sort((left, right) => right.length - left.length);
};

const redactUnknown = (value: unknown, redactText: (value: string) => string, visited = new WeakMap<object, unknown>()): unknown => {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (visited.has(value)) {
    return visited.get(value);
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    visited.set(value, copy);
    value.forEach((item) => copy.push(redactUnknown(item, redactText, visited)));
    return copy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }
  const copy: Record<string, unknown> = {};
  visited.set(value, copy);
  Object.entries(value).forEach(([key, entry]) => {
    copy[key] = redactUnknown(entry, redactText, visited);
  });
  return copy;
};
