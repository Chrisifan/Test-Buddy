import type { ProjectDraft, ReusableFlowAsset, VersionedTestAssetReference } from '../studio.js';

const versionedReferenceKey = (reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string => (
  `${reference.id}@${reference.version}`
);

/** Creates an unpublished V1 Flow draft. It is invalid until it contains supported steps. */
export const createEmptyReusableFlowAsset = (seed: number): ReusableFlowAsset => {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `flow-${Date.now()}-${seed}`,
    version: 1,
    name: `新的可复用流程 ${seed}`,
    description: '',
    tags: [],
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
};

/** Finds exactly one published Flow version; duplicate versions remain unavailable. */
export const findReusableFlowAsset = (
  project: Pick<ProjectDraft, 'reusableFlows'>,
  reference: VersionedTestAssetReference,
): ReusableFlowAsset | undefined => {
  const matches = project.reusableFlows.filter((flow) => (
    flow.id === reference.id && flow.version === reference.version
  ));
  return matches.length === 1 ? matches[0] : undefined;
};

/** Returns one latest immutable Flow version per Flow ID. */
export const listLatestReusableFlowVersions = (
  project: Pick<ProjectDraft, 'reusableFlows'>,
): ReusableFlowAsset[] => {
  const latest = new Map<string, ReusableFlowAsset>();
  const seenVersions = new Set<string>();
  project.reusableFlows.forEach((flow) => {
    const key = versionedReferenceKey(flow);
    if (seenVersions.has(key)) {
      throw new Error(`Duplicate reusable Flow version ${key}.`);
    }
    seenVersions.add(key);
    const previous = latest.get(flow.id);
    if (!previous || flow.version > previous.version) {
      latest.set(flow.id, flow);
    }
  });
  return [...latest.values()];
};

/** Clones an exact published Flow and assigns the next version for its ID. */
export const createNextReusableFlowVersion = (
  project: Pick<ProjectDraft, 'reusableFlows'>,
  source: ReusableFlowAsset,
  patch: Omit<Partial<ReusableFlowAsset>, 'id' | 'version' | 'schemaVersion' | 'createdAt'>,
): ReusableFlowAsset => {
  const reference = { id: source.id, version: source.version };
  const canonicalSource = findReusableFlowAsset(project, reference);
  if (!canonicalSource) {
    throw new Error(`Reusable Flow source ${versionedReferenceKey(reference)} must match exactly one published version.`);
  }
  const highestVersion = project.reusableFlows
    .filter((flow) => flow.id === canonicalSource.id)
    .reduce((highest, flow) => Math.max(highest, flow.version), 0);
  return {
    ...structuredClone(canonicalSource),
    ...structuredClone(patch),
    schemaVersion: 1,
    id: canonicalSource.id,
    version: highestVersion + 1,
    createdAt: canonicalSource.createdAt,
    updatedAt: new Date().toISOString(),
  };
};
