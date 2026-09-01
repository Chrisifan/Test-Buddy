import type {
  DeterministicFileReference,
  DeterministicNetworkMethod,
  DeterministicTestAction,
  TestStepDraft,
} from '../../shared/studio.js';
import { hasValidDeterministicTestActionShape } from '../../shared/studio.js';

export type DeterministicInteractionBlockReason =
  | 'crossOriginIframe'
  | 'unapprovedUploadReference'
  | 'uploadTooLarge'
  | 'untrustedTab'
  | 'untrustedDownload'
  | 'unsupportedUrlScheme'
  | 'unsupportedNetworkHost'
  | 'unsupportedNetworkMethod'
  | 'mockBodyTooLarge'
  | 'coordinateOutOfBounds'
  | 'clipboardTooLarge'
  | 'resolvedSecret'
  | 'malformedAction'
  | 'preflightPolicyUnavailable';

export interface DeterministicStepValidationIssue {
  code: 'unsupportedAction';
  reason: DeterministicInteractionBlockReason;
  message: string;
  surface?: 'step' | 'log' | 'artifactLabel' | 'maintenance' | 'report';
}

/** An exact, main-owned file selection. No local filesystem path crosses this boundary. */
export type DeterministicUploadReference = DeterministicFileReference & { byteCount: number };

export interface DeterministicInteractionPreflightContext {
  /** The selected environment URL. It is the only allowed iframe origin. */
  baseUrl: string;
  /** Full origins permitted for opening a user-reviewed tab or managed download. */
  allowedTabOrigins?: readonly string[];
  /** Exact hosts permitted for response observation and route mocking. */
  allowedNetworkHosts?: readonly string[];
  /** Methods permitted for response observation and route mocking. */
  allowedNetworkMethods?: readonly DeterministicNetworkMethod[];
  /** Main process selections which may be resolved to a managed file at execution time. */
  uploadReferences?: readonly DeterministicUploadReference[];
  maxUploadBytes?: number;
  maxClipboardBytes?: number;
  maxMockBodyBytes?: number;
  coordinateBounds?: { min: number; max: number };
  /** Resolved values supplied only by the main process for preflight comparison. */
  knownSecrets?: readonly string[];
}

/** Main-process-only policy. Renderer and project assets cannot supply these approvals or values. */
export type DeterministicInteractionPreflightPolicy = Omit<DeterministicInteractionPreflightContext, 'baseUrl'>;

export interface DeterministicInteractionPreflightPolicyProvider {
  resolve(request: {
    projectId: string;
    environmentId: string;
    testCaseId: string;
  }): Promise<DeterministicInteractionPreflightPolicy>;
  /** Resolves an already-approved opaque reference only in Electron main or the CLI process. */
  resolveUpload?: (request: {
    projectId: string;
    environmentId: string;
    testCaseId: string;
    reference: DeterministicFileReference;
  }) => Promise<{ path: string; byteCount: number }>;
}

export interface DeterministicPersistenceSurfaces {
  steps?: readonly TestStepDraft[];
  logs?: readonly string[];
  artifactLabels?: readonly string[];
  maintenance?: readonly unknown[];
  reports?: readonly unknown[];
}

const controlledActionKinds = new Set<DeterministicTestAction['kind']>([
  'iframe',
  'tab',
  'upload',
  'download',
  'hover',
  'drag',
  'clipboard',
  'networkObserve',
  'networkMock',
]);
const defaultMaxUploadBytes = 10 * 1024 * 1024;
const defaultMaxClipboardBytes = 4 * 1024;
const defaultMaxMockBodyBytes = 64 * 1024;
const defaultCoordinateBounds = { min: 0, max: 10_000 };

type ControlledDeterministicInteraction = Extract<
  DeterministicTestAction,
  { kind: 'iframe' | 'tab' | 'upload' | 'download' | 'hover' | 'drag' | 'clipboard' | 'networkObserve' | 'networkMock' }
>;

export function isControlledDeterministicInteraction(
  action: DeterministicTestAction | undefined,
): action is ControlledDeterministicInteraction {
  return Boolean(action && typeof action === 'object' && 'kind' in action &&
    typeof action.kind === 'string' && controlledActionKinds.has(action.kind as DeterministicTestAction['kind']));
}

/**
 * Pure validation for one persisted V2 step. The caller maps every issue to
 * a terminal blocked/unsupportedAction result before it starts BrowserRuntime.
 */
export function validateDeterministicStep(
  step: TestStepDraft,
  context: DeterministicInteractionPreflightContext,
): DeterministicStepValidationIssue[] {
  const issues = validateDeterministicPersistenceSurfaces({ steps: [step] }, context);
  const action = step.execution?.action;
  if (!isControlledDeterministicInteraction(action)) {
    return issues;
  }
  if (!hasValidDeterministicTestActionShape(action)) {
    return [...issues, block('malformedAction', 'step', 'Controlled deterministic interaction payload is malformed.')];
  }

  const base = parseHttpUrl(context.baseUrl);
  if (!base) {
    return [...issues, block('unsupportedUrlScheme', 'step', 'The selected environment URL is not an http(s) origin.')];
  }
  const allowedTabOrigins = new Set(normalizeOrigins(context.allowedTabOrigins, base.origin));
  const allowedNetworkHosts = new Set(context.allowedNetworkHosts?.map((host) => host.toLowerCase()) ?? [base.hostname]);
  const allowedNetworkMethods = new Set(context.allowedNetworkMethods ?? ['GET']);

  switch (action.kind) {
    case 'iframe': {
      const frameUrl = parseHttpUrl(action.frame.url);
      if (!frameUrl || frameUrl.origin !== base.origin) {
        issues.push(block('crossOriginIframe', 'step', 'Iframe interactions require an exact same-origin frame URL.'));
      }
      break;
    }
    case 'tab': {
      if (!isAllowedOrigin(action.url, allowedTabOrigins)) {
        issues.push(blockForUrl(action.url, 'untrustedTab', 'A new tab URL must use an allowlisted http(s) origin.'));
      }
      break;
    }
    case 'upload': {
      const selected = context.uploadReferences?.find((reference) => sameFileReference(reference, action.fileRef));
      if (!selected) {
        issues.push(block('unapprovedUploadReference', 'step', 'Upload actions must use an exact main-owned attachment or fixture reference.'));
      } else if (selected.byteCount > (context.maxUploadBytes ?? defaultMaxUploadBytes)) {
        issues.push(block('uploadTooLarge', 'step', 'The selected upload exceeds the approved byte limit.'));
      }
      break;
    }
    case 'download': {
      if (!isAllowedOrigin(action.url, allowedTabOrigins)) {
        issues.push(blockForUrl(action.url, 'untrustedDownload', 'Downloads must use an allowlisted managed http(s) URL.'));
      }
      break;
    }
    case 'drag': {
      const bounds = context.coordinateBounds ?? defaultCoordinateBounds;
      if (!isBoundedPoint(action.sourcePosition, bounds) || !isBoundedPoint(action.targetPosition, bounds)) {
        issues.push(block('coordinateOutOfBounds', 'step', 'Drag coordinates must stay inside the configured interaction bounds.'));
      }
      break;
    }
    case 'clipboard': {
      if (byteCount(action.value) > (context.maxClipboardBytes ?? defaultMaxClipboardBytes)) {
        issues.push(block('clipboardTooLarge', 'step', 'Clipboard content exceeds the approved byte limit.'));
      }
      break;
    }
    case 'networkObserve':
    case 'networkMock': {
      const url = parseHttpUrl(action.url);
      if (!url) {
        issues.push(block('unsupportedUrlScheme', 'step', 'Network interactions require an http(s) URL.'));
      } else if (!allowedNetworkHosts.has(url.hostname.toLowerCase())) {
        issues.push(block('unsupportedNetworkHost', 'step', 'Network interactions must target an exact allowlisted host.'));
      }
      if (action.method && !allowedNetworkMethods.has(action.method)) {
        issues.push(block('unsupportedNetworkMethod', 'step', 'Network interactions must use an allowlisted method.'));
      }
      if (action.kind === 'networkMock' && byteCount(JSON.stringify(action.response.body)) > (context.maxMockBodyBytes ?? defaultMaxMockBodyBytes)) {
        issues.push(block('mockBodyTooLarge', 'step', 'Network mock body exceeds the approved byte limit.'));
      }
      break;
    }
    case 'hover':
      break;
  }

  return issues;
}

/** Validates all persisted Case/Flow steps before a browser session is started. */
export function validateDeterministicSteps(
  steps: readonly TestStepDraft[],
  context: DeterministicInteractionPreflightContext,
): DeterministicStepValidationIssue[] {
  return [
    ...steps.flatMap((step) => validateDeterministicStep(step, context)),
    ...validateDeterministicPersistenceSurfaces({ steps }, context),
  ].filter((issue, index, all) => all.findIndex((candidate) => (
    candidate.reason === issue.reason && candidate.surface === issue.surface && candidate.message === issue.message
  )) === index);
}

/** Rejects resolved secrets in every durable surface before it can be recorded. */
export function validateDeterministicPersistenceSurfaces(
  surfaces: DeterministicPersistenceSurfaces,
  context: Pick<DeterministicInteractionPreflightContext, 'knownSecrets'>,
): DeterministicStepValidationIssue[] {
  const issues: DeterministicStepValidationIssue[] = [];
  const visit = (value: unknown, surface: DeterministicStepValidationIssue['surface']) => {
    if (containsKnownSecret(value, context.knownSecrets)) {
      issues.push(block('resolvedSecret', surface, `A resolved secret cannot be persisted in ${surface}.`));
    }
  };

  surfaces.steps?.forEach((step) => visit(step, 'step'));
  surfaces.logs?.forEach((line) => visit(line, 'log'));
  surfaces.artifactLabels?.forEach((label) => visit(label, 'artifactLabel'));
  surfaces.maintenance?.forEach((entry) => visit(entry, 'maintenance'));
  surfaces.reports?.forEach((entry) => visit(entry, 'report'));
  return issues;
}

function block(
  reason: DeterministicInteractionBlockReason,
  surface: DeterministicStepValidationIssue['surface'],
  message: string,
): DeterministicStepValidationIssue {
  return { code: 'unsupportedAction', reason, message, ...(surface ? { surface } : {}) };
}

function blockForUrl(
  value: string,
  reason: 'untrustedTab' | 'untrustedDownload',
  message: string,
): DeterministicStepValidationIssue {
  return parseHttpUrl(value)
    ? block(reason, 'step', message)
    : block('unsupportedUrlScheme', 'step', message);
}

function normalizeOrigins(origins: readonly string[] | undefined, fallback: string): string[] {
  return (origins?.length ? origins : [fallback]).flatMap((origin) => {
    const url = parseHttpUrl(origin);
    return url ? [url.origin] : [];
  });
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(value: string, allowedOrigins: ReadonlySet<string>): boolean {
  const url = parseHttpUrl(value);
  return Boolean(url && allowedOrigins.has(url.origin));
}

function sameFileReference(left: DeterministicFileReference, right: DeterministicFileReference): boolean {
  if (left.kind !== right.kind || left.id !== right.id) {
    return false;
  }
  return left.kind !== 'fixture' || right.kind === 'fixture' && left.version === right.version;
}

function isBoundedPoint(
  point: { x: number; y: number } | undefined,
  bounds: { min: number; max: number },
): boolean {
  return !point || (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= bounds.min && point.x <= bounds.max &&
    point.y >= bounds.min && point.y <= bounds.max
  );
}

function byteCount(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function containsKnownSecret(value: unknown, knownSecrets: readonly string[] | undefined): boolean {
  const secrets = knownSecrets?.filter((secret) => typeof secret === 'string' && secret.length > 0) ?? [];
  if (!secrets.length) {
    return false;
  }
  const completed = new WeakSet<object>();
  const visiting = new WeakSet<object>();
  const visit = (candidate: unknown): boolean => {
    if (typeof candidate === 'string') {
      return secrets.some((secret) => candidate.includes(secret));
    }
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    if (visiting.has(candidate)) {
      return true;
    }
    if (completed.has(candidate)) {
      return false;
    }
    const values = getSafePersistenceValues(candidate);
    if (!values) {
      return true;
    }
    visiting.add(candidate);
    try {
      return values.some(visit);
    } finally {
      visiting.delete(candidate);
      completed.add(candidate);
    }
  };
  return visit(value);
}

/** Reads only own data descriptors so persistence checks never invoke arbitrary getters. */
function getSafePersistenceValues(value: object): unknown[] | undefined {
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) {
        return undefined;
      }
      const ownNames = Object.getOwnPropertyNames(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        ownNames.length !== length + 1 ||
        !ownNames.includes('length')
      ) {
        return undefined;
      }
      const entries: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          return undefined;
        }
        entries.push(descriptor.value);
      }
      return entries;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) {
      return undefined;
    }
    const entries: unknown[] = [];
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return undefined;
      }
      entries.push(descriptor.value);
    }
    return entries;
  } catch {
    return undefined;
  }
}
