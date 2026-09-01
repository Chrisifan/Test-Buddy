import { createHash, randomUUID } from 'node:crypto';

import {
  analyzeMaintenanceImpact,
  createMaintenanceDraft,
  isSafeMaintenanceRationale,
  transitionMaintenanceDraft,
  validateMaintenanceDraft,
  type MaintenanceCaseTarget,
  type MaintenanceDraft,
  type MaintenanceEvidenceReference,
} from '../../shared/maintenance.js';
import {
  createNextTestCaseVersion,
  findTestCaseVersion,
  type RunDetail,
  type MaintenanceDraftRejectionRequest,
  type MaintenanceEvidenceOpenRequest,
  type StudioState,
  type TestCaseDraft,
} from '../../shared/studio.js';
import { calculateProjectAssetRevision, type ProjectAssetStore } from '../projectAssetStore.js';
import type { ProjectRepository } from '../projectRepository.js';
import type { ArtifactManager } from './artifact-manager.js';
import { validateDeterministicPersistenceSurfaces } from './deterministic-step-contract.js';

type StudioStateUpdater = (state: StudioState) => StudioState | Promise<StudioState>;

export interface MaintenanceServiceDependencies {
  projectRepository: Pick<ProjectRepository, 'loadBound'>;
  artifactManager: Pick<ArtifactManager, 'findManifestEntry' | 'resolveManifestEntryPath'>;
  assetStoreForProject: (projectId: string) => Pick<ProjectAssetStore, 'save'> | Promise<Pick<ProjectAssetStore, 'save'>>;
  loadState: () => Promise<StudioState>;
  updateState: (updater: StudioStateUpdater) => Promise<StudioState>;
  createId?: () => string;
  now?: () => Date;
  hashCase?: (testCase: TestCaseDraft) => string;
  /** Main-process-only resolved values used solely to reject unsafe durable records. */
  getKnownSecrets?: () => Promise<readonly string[]>;
}

export interface CreateMaintenanceDraftRequest {
  runId: string;
  target: MaintenanceCaseTarget;
  proposedCase: TestCaseDraft;
  citations: Array<Pick<MaintenanceEvidenceReference, 'artifactId' | 'contentHash'>>;
}

export interface AcceptMaintenanceDraftRequest {
  draftId: string;
  expectedRevision: string;
}

export type AcceptMaintenanceDraftResult =
  | { status: 'accepted'; draft: MaintenanceDraft; published: { id: string; version: number } }
  | { status: 'stale'; draft: MaintenanceDraft };

/** Main-process-only maintenance review and publication lifecycle. */
export class MaintenanceService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly hashCase: (testCase: TestCaseDraft) => string;

  constructor(private readonly dependencies: MaintenanceServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? (() => `maintenance-${randomUUID()}`);
    this.hashCase = dependencies.hashCase ?? hashTestCase;
  }

  async createFromRun(request: CreateMaintenanceDraftRequest): Promise<MaintenanceDraft> {
    const state = await this.dependencies.loadState();
    const run = state.runDetails.find((candidate) => candidate.id === request.runId);
    if (!run?.provenance || run.provenance.reproducibility !== 'versioned') {
      throw new Error('Maintenance analysis requires a versioned RunDetail with frozen provenance.');
    }
    if (!sameTarget(request.target, run.provenance.testCase) || run.provenance.projectId !== run.projectId) {
      throw new Error('Maintenance target must exactly match the frozen Run provenance.');
    }

    const snapshot = await this.dependencies.projectRepository.loadBound(
      run.provenance.projectId,
      run.provenance.projectRevision,
    );
    const sourceCase = findTestCaseVersion(snapshot.project, request.target);
    if (!sourceCase) {
      throw new Error('Maintenance analysis could not resolve the exact source Case version.');
    }
    await this.assertNoKnownSecret({ maintenance: [sourceCase, request.proposedCase] });
    const evidence = await this.verifyCitations(run, request.citations);
    const createdAt = this.now().toISOString();
    const draft = createMaintenanceDraft({
      id: this.createId(),
      createdAt,
      projectId: snapshot.project.id,
      projectRevision: snapshot.revision,
      target: request.target,
      baseAssetHash: this.hashCase(sourceCase),
      sourceCase,
      proposedCase: request.proposedCase,
      evidence,
      impact: analyzeMaintenanceImpact(snapshot.project, request.target),
    });

    await this.dependencies.updateState((current) => ({
      ...current,
      maintenanceDrafts: [draft, ...current.maintenanceDrafts.filter((candidate) => candidate.id !== draft.id)],
    }));
    return draft;
  }

  async accept(request: AcceptMaintenanceDraftRequest): Promise<AcceptMaintenanceDraftResult> {
    const draft = await this.findDraft(request.draftId);
    if (draft.status !== 'draft' || request.expectedRevision !== draft.projectRevision) {
      return this.markStale(draft.id);
    }

    let snapshot: Awaited<ReturnType<ProjectRepository['loadBound']>>;
    try {
      snapshot = await this.dependencies.projectRepository.loadBound(draft.projectId, draft.projectRevision);
    } catch {
      return this.markStale(draft.id);
    }
    const sourceCase = findTestCaseVersion(snapshot.project, draft.target);
    await this.assertNoKnownSecret({ maintenance: [draft, sourceCase] });
    if (validateMaintenanceDraft(draft).length) {
      throw new Error('Maintenance draft is invalid and cannot be published.');
    }
    if (
      !sourceCase ||
      this.hashCase(sourceCase) !== draft.baseAssetHash ||
      !sameImpact(analyzeMaintenanceImpact(snapshot.project, draft.target), draft.impact)
    ) {
      return this.markStale(draft.id);
    }

    const { id: _candidateId, version: _candidateVersion, ...candidatePatch } = draft.candidate;
    const published = createNextTestCaseVersion(snapshot.project, sourceCase, candidatePatch);
    const nextProject = {
      ...snapshot.project,
      testCases: [...snapshot.project.testCases, published],
    };
    await (await this.dependencies.assetStoreForProject(draft.projectId)).save(nextProject, snapshot.revision);
    const nextRevision = calculateProjectAssetRevision(nextProject);
    let accepted: MaintenanceDraft | undefined;
    await this.dependencies.updateState((current) => {
      const currentDraft = current.maintenanceDrafts.find((candidate) => candidate.id === draft.id);
      if (!currentDraft || currentDraft.status !== 'draft') {
        throw new Error('Maintenance draft changed before its publication audit could be saved.');
      }
      accepted = transitionMaintenanceDraft(currentDraft, 'accepted', this.now().toISOString());
      return {
        ...current,
        projects: current.projects.map((project) => project.id === nextProject.id ? structuredClone(nextProject) : project),
        projectAssetBindings: current.projectAssetBindings.map((binding) => (
          binding.projectId === nextProject.id ? { ...binding, revision: nextRevision } : binding
        )),
        maintenanceDrafts: current.maintenanceDrafts.map((candidate) => candidate.id === draft.id ? accepted! : candidate),
      };
    });
    return {
      status: 'accepted',
      draft: accepted!,
      published: { id: published.id, version: published.version ?? 1 },
    };
  }

  async reject(request: MaintenanceDraftRejectionRequest): Promise<MaintenanceDraft> {
    if (!isSafeMaintenanceRationale(request.rationale)) {
      throw new Error('Maintenance rejection requires a non-empty redacted rationale.');
    }
    await this.assertNoKnownSecret({ maintenance: [request.rationale] });
    const draft = await this.findDraft(request.draftId);
    if (draft.status !== 'draft') {
      throw new Error(`Maintenance draft ${draft.id} is terminal and cannot be rejected.`);
    }
    let rejected: MaintenanceDraft | undefined;
    await this.dependencies.updateState((current) => {
      const currentDraft = current.maintenanceDrafts.find((candidate) => candidate.id === request.draftId);
      if (!currentDraft || currentDraft.status !== 'draft') {
        throw new Error('Maintenance draft changed before rejection.');
      }
      rejected = transitionMaintenanceDraft(currentDraft, 'rejected', this.now().toISOString(), request.rationale);
      return {
        ...current,
        maintenanceDrafts: current.maintenanceDrafts.map((candidate) => candidate.id === request.draftId ? rejected! : candidate),
      };
    });
    return rejected!;
  }

  /** Resolves an opaque cited identity to a main-process-only managed artifact path. */
  async openEvidence(request: MaintenanceEvidenceOpenRequest): Promise<string> {
    const draft = await this.findDraft(request.draftId);
    const citation = draft.evidence.find((candidate) => (
      candidate.runId === request.citation.runId &&
      candidate.artifactId === request.citation.artifactId &&
      candidate.contentHash === request.citation.contentHash
    ));
    if (!citation) {
      throw new Error('Maintenance evidence citation is not part of this draft.');
    }
    const entry = await this.dependencies.artifactManager.findManifestEntry(citation.artifactId);
    if (!entry || entry.contentHash !== citation.contentHash || entry.ownerRunId !== citation.runId) {
      throw new Error('Maintenance evidence citation is no longer retained by the managed artifact store.');
    }
    const artifactPath = await this.dependencies.artifactManager.resolveManifestEntryPath(entry);
    if (!artifactPath) {
      throw new Error('Maintenance evidence citation is no longer retained by the managed artifact store.');
    }
    return artifactPath;
  }

  private async findDraft(draftId: string): Promise<MaintenanceDraft> {
    const draft = (await this.dependencies.loadState()).maintenanceDrafts.find((candidate) => candidate.id === draftId);
    if (!draft) {
      throw new Error(`Maintenance draft ${draftId} was not found.`);
    }
    return draft;
  }

  private async assertNoKnownSecret(surfaces: { maintenance: readonly unknown[] }): Promise<void> {
    const knownSecrets = await this.dependencies.getKnownSecrets?.() ?? [];
    if (validateDeterministicPersistenceSurfaces(surfaces, { knownSecrets }).length) {
      throw new Error('Maintenance data contains a resolved secret and cannot be persisted.');
    }
  }

  private async markStale(draftId: string): Promise<AcceptMaintenanceDraftResult> {
    let stale: MaintenanceDraft | undefined;
    await this.dependencies.updateState((current) => {
      const currentDraft = current.maintenanceDrafts.find((candidate) => candidate.id === draftId);
      if (!currentDraft) {
        throw new Error(`Maintenance draft ${draftId} was not found.`);
      }
      stale = currentDraft.status === 'draft'
        ? transitionMaintenanceDraft(currentDraft, 'stale', this.now().toISOString())
        : currentDraft;
      return {
        ...current,
        maintenanceDrafts: current.maintenanceDrafts.map((candidate) => candidate.id === draftId ? stale! : candidate),
      };
    });
    return { status: 'stale', draft: stale! };
  }

  private async verifyCitations(
    run: RunDetail,
    citations: CreateMaintenanceDraftRequest['citations'],
  ): Promise<MaintenanceEvidenceReference[]> {
    if (!citations.length) {
      throw new Error('Maintenance analysis requires at least one retained evidence citation.');
    }
    return Promise.all(citations.map(async (citation) => {
      const entry = await this.dependencies.artifactManager.findManifestEntry(citation.artifactId);
      if (!entry || entry.contentHash !== citation.contentHash || entry.ownerRunId !== run.id) {
        throw new Error(`Maintenance citation ${citation.artifactId} is missing, changed, or belongs to another Run.`);
      }
      return { runId: run.id, artifactId: entry.id, contentHash: entry.contentHash };
    }));
  }
}

function sameTarget(
  target: MaintenanceCaseTarget,
  reference: { id: string; version: number },
): boolean {
  return target.kind === 'case' && target.id === reference.id && target.version === reference.version;
}

function sameImpact(
  left: ReturnType<typeof analyzeMaintenanceImpact>,
  right: ReturnType<typeof analyzeMaintenanceImpact>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((reference, index) => (
    reference.kind === right[index]?.kind &&
    reference.id === right[index]?.id &&
    reference.version === right[index]?.version
  ));
}

function hashTestCase(testCase: TestCaseDraft): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(testCase)), 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      const candidate = (value as Record<string, unknown>)[key];
      if (candidate !== undefined) {
        result[key] = canonicalize(candidate);
      }
      return result;
    }, {});
  }
  return value;
}
