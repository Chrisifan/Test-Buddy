import { useEffect, useId, useMemo, useState } from 'react';
import type {
  CredentialRef,
  FixtureAsset,
  FixtureExecutionMode,
  FixtureHttpDeclaration,
  FixtureHttpMethod,
  FixtureLifecycleDeclaration,
  FixtureParameter,
  FixtureScriptLifecycle,
  FixtureScriptTrustStatus,
  ProjectAssetBinding,
  ProjectAssetBindingStatus,
  ProjectAssetMigrationPlan,
  ProjectAssetReloadPlan,
  ProjectAssetReloadResult,
  ProjectAssetUpdatePlan,
  ProjectDraft,
  ProjectEnvironment,
  ProjectGroup,
} from '../../../shared/studio.js';
import { normalizeFixtureHttpDeclaration } from '../../../shared/studio.js';

import {
  Boxes,
  Camera,
  FolderKanban,
  KeyRound,
  Layers3,
  ListChecks,
  Plus,
  RefreshCw,
  ServerCog,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { EvidenceCard, PageBody, PageHeader, PageShell, Surface } from '../../components/workbench.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '../../i18n/index.js';
import {
  approveFixtureScriptTrust,
  canPublishProjectAssetSnapshot,
  captureStorageState,
  inspectProjectAssetBinding,
  importStorageState,
  listFixtureScriptTrusts,
  planProjectAssetMigration,
  planProjectAssetReload,
  planProjectAssetUpdate,
  reloadProjectAssetSnapshot,
  revokeStorageState,
  selectProjectAssetDirectory,
  updateProjectAssetSnapshot,
  writeProjectAssetSnapshot,
} from '../../lib/runtime.js';

export function ProjectManagementPage({
  projects,
  selectedProject,
  selectedGroupId,
  onCreateProject,
  onDeleteProject,
  onProjectAssetBound,
  onProjectAssetReloaded,
  onSelectProject,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  onUpdateProject,
  onSaveCredential,
  projectAssetBindings = [],
  openProjectConfigurationFor,
  onProjectConfigurationOpened,
}: {
  projects: ProjectDraft[];
  selectedProject?: ProjectDraft;
  selectedGroupId: string;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateProject: (updater: (project: ProjectDraft) => ProjectDraft) => void;
  onProjectAssetBound?: (binding: ProjectAssetBinding) => void;
  onProjectAssetReloaded?: (result: ProjectAssetReloadResult) => void;
  projectAssetBindings?: ProjectAssetBinding[];
  openProjectConfigurationFor?: string;
  onProjectConfigurationOpened?: () => void;
  onSaveCredential: (payload: {
    label: string;
    username: string;
    secret: string;
  }) => Promise<CredentialRef | null>;
}) {
  const { t } = useI18n();
  const [credentialLabel, setCredentialLabel] = useState(() => t('project.credential.defaultLabel'));
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialSecret, setCredentialSecret] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const editingProject = projects.find((project) => project.id === editingProjectId);

  const totalCases = projects.reduce((total, project) => total + project.testCases.length, 0);
  const totalGroups = projects.reduce((total, project) => total + project.groups.length, 0);
  const totalEnvironments = projects.reduce((total, project) => total + project.environments.length, 0);
  const totalAssets = projects.reduce(
    (total, project) => total + project.documents.length + project.recordings.length,
    0,
  );
  const projectAssetBindingsByProjectId = useMemo(
    () => new Map(projectAssetBindings.map((binding) => [binding.projectId, binding])),
    [projectAssetBindings],
  );

  const openProjectEditor = (project: ProjectDraft) => {
    onSelectProject(project.id);
    setEditingProjectId(project.id);
  };

  useEffect(() => {
    if (!openProjectConfigurationFor) {
      return;
    }
    const project = projects.find((candidate) => candidate.id === openProjectConfigurationFor);
    if (!project) {
      return;
    }
    openProjectEditor(project);
    onProjectConfigurationOpened?.();
  }, [onProjectConfigurationOpened, openProjectConfigurationFor, projects]);

  return (
    <PageShell className="figma-project-page">
      <PageHeader
        action={
        <Button className="project-create-button" onClick={onCreateProject} type="button">
          <Plus className="h-4 w-4" />
          {t('project.create')}
        </Button>
        }
        title={t('project.header.title')}
      />
      <PageBody className="project-overview-scroll">
        <main className="project-overview figma-project-inventory" aria-label={t('project.overview.aria')}>
          <section aria-label={t('project.overview.summaryAria')} className="project-overview-metrics">
            <ProjectMetric icon={ListChecks} label={t('project.overview.totalCases')} value={totalCases} />
            <ProjectMetric icon={Layers3} label={t('project.overview.totalGroups')} value={totalGroups} />
            <ProjectMetric icon={ServerCog} label={t('project.overview.totalEnvironments')} value={totalEnvironments} />
            <ProjectMetric icon={Boxes} label={t('project.overview.totalAssets')} value={totalAssets} />
          </section>

          <section aria-label={t('project.overview.gridAria')} className="project-card-grid">
            {projects.map((project) => (
              <ProjectCard
                active={selectedProject?.id === project.id}
                key={project.id}
                onDelete={() => onDeleteProject(project.id)}
                onEdit={() => openProjectEditor(project)}
                onSelect={() => onSelectProject(project.id)}
                isBound={projectAssetBindingsByProjectId.has(project.id)}
                project={project}
                t={t}
              />
            ))}
            <button className="project-create-card" onClick={onCreateProject} type="button">
              <span className="project-create-card-icon"><Plus className="h-5 w-5" /></span>
              <span className="project-create-card-title">{t('project.overview.createCardTitle')}</span>
              <span className="project-create-card-description">{t('project.overview.createCardDescription')}</span>
            </button>
          </section>

          {!projects.length ? (
            <EvidenceCard title={t('project.empty.title')} description={t('project.empty.description')} />
          ) : null}
        </main>
      </PageBody>

      <ProjectConfigurationDialog
        credentialLabel={credentialLabel}
        credentialSecret={credentialSecret}
        credentialUsername={credentialUsername}
        onClose={() => setEditingProjectId(null)}
        onCreateGroup={onCreateGroup}
        onDeleteGroup={onDeleteGroup}
        onDeleteProject={onDeleteProject}
        onProjectAssetBound={onProjectAssetBound}
        onProjectAssetReloaded={onProjectAssetReloaded}
        onSaveCredential={onSaveCredential}
        onSelectGroup={onSelectGroup}
        onUpdateProject={onUpdateProject}
        open={Boolean(editingProject)}
        project={editingProject}
        projectAssetBinding={editingProject
          ? projectAssetBindings.find((binding) => binding.projectId === editingProject.id)
          : undefined}
        selectedGroupId={selectedGroupId}
        setCredentialLabel={setCredentialLabel}
        setCredentialSecret={setCredentialSecret}
        setCredentialUsername={setCredentialUsername}
      />
    </PageShell>
  );
}

function ProjectMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
}) {
  return (
    <div className="project-overview-metric">
      <div className="flex items-center justify-between gap-3">
        <p>{label}</p>
        <Icon className="h-[18px] w-[18px] text-primary" />
      </div>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function ProjectCard({
  active,
  onDelete,
  onEdit,
  onSelect,
  isBound,
  project,
  t,
}: {
  active: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onSelect: () => void;
  isBound: boolean;
  project: ProjectDraft;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}) {
  const assetCount = project.documents.length + project.recordings.length;

  return (
    <article className={`project-card ${active ? 'is-active' : ''}`} onClick={onSelect}>
      <div className="project-card-topline">
        <span className="project-card-icon"><FolderKanban className="h-4 w-4" /></span>
        <Badge className={`project-card-status ${active ? 'is-active' : ''}`} variant="outline">
          {active ? t('project.card.selected') : project.environments.length ? t('project.card.configured') : t('project.card.draft')}
        </Badge>
        {!isBound ? <Badge className="project-card-status" variant="outline">{t('project.assets.legacy')}</Badge> : null}
      </div>
      <div className="project-card-copy">
        <h2>{project.name}</h2>
        <p>{project.description || t('project.list.noDescription')}</p>
      </div>
      <dl className="project-card-metrics">
        <div>
          <dt>{t('project.metric.groups')}</dt>
          <dd>{project.groups.length}</dd>
        </div>
        <div>
          <dt>{t('project.metric.cases')}</dt>
          <dd>{project.testCases.length}</dd>
        </div>
        <div>
          <dt>{t('project.card.assets')}</dt>
          <dd>{assetCount}</dd>
        </div>
      </dl>
      <footer className="project-card-footer">
        <span>{t('project.card.environments', { count: project.environments.length })}</span>
        <span className="flex items-center gap-1">
          <button
            aria-label={t('project.delete')}
            className="project-card-icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="project-card-manage"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            type="button"
          >
            {t('project.card.manage')}
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </footer>
    </article>
  );
}

function ProjectConfigurationDialog({
  credentialLabel,
  credentialSecret,
  credentialUsername,
  onClose,
  onCreateGroup,
  onDeleteGroup,
  onDeleteProject,
  onProjectAssetBound,
  onProjectAssetReloaded,
  onSaveCredential,
  onSelectGroup,
  onUpdateProject,
  open,
  project,
  projectAssetBinding,
  selectedGroupId,
  setCredentialLabel,
  setCredentialSecret,
  setCredentialUsername,
}: {
  credentialLabel: string;
  credentialSecret: string;
  credentialUsername: string;
  onClose: () => void;
  onCreateGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onProjectAssetBound?: (binding: ProjectAssetBinding) => void;
  onProjectAssetReloaded?: (result: ProjectAssetReloadResult) => void;
  onSaveCredential: (payload: { label: string; username: string; secret: string }) => Promise<CredentialRef | null>;
  onSelectGroup: (groupId: string) => void;
  onUpdateProject: (updater: (project: ProjectDraft) => ProjectDraft) => void;
  open: boolean;
  project?: ProjectDraft;
  projectAssetBinding?: ProjectAssetBinding;
  selectedGroupId: string;
  setCredentialLabel: (value: string) => void;
  setCredentialSecret: (value: string) => void;
  setCredentialUsername: (value: string) => void;
}) {
  const { t } = useI18n();
  const [storageStateLabel, setStorageStateLabel] = useState('');
  const [storageStateError, setStorageStateError] = useState<string>();
  const [storageStateAction, setStorageStateAction] = useState<string>();
  const storageStateLabelId = useId();

  if (!project) {
    return null;
  }

  return (
    <Dialog onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent className="project-config-dialog max-h-[min(900px,calc(100vh-40px))] w-[min(1120px,calc(100vw-40px))] gap-0 overflow-hidden p-0" showCloseButton>
        <DialogHeader className="project-config-heading border-b border-border px-6 py-5 pr-16 text-left">
          <DialogTitle>{project.name}</DialogTitle>
          <DialogDescription>{t('project.detail.description')}</DialogDescription>
        </DialogHeader>
        <div className="project-config-content">
          <section className="project-config-section project-config-basic">
            <div className="project-config-section-heading">
              <div>
                <h3>{t('project.detail.basicInfo')}</h3>
                <p>{t('project.detail.caseCount', { count: project.testCases.length })}</p>
              </div>
            </div>
            <div className="project-config-form-grid">
              <div className="form-field">
                <Label>{t('project.form.name')}</Label>
                <Input
                  onChange={(event) => onUpdateProject((current) => ({ ...current, name: event.target.value }))}
                  value={project.name}
                />
              </div>
              <div className="form-field">
                <Label>{t('project.detail.baseUrl')}</Label>
                <Input
                  onChange={(event) => onUpdateProject((current) => ({ ...current, defaultUrl: event.target.value }))}
                  value={project.defaultUrl}
                />
              </div>
            </div>
            <div className="form-field">
              <Label>{t('project.form.description')}</Label>
              <Textarea
                className="min-h-[80px]"
                onChange={(event) => onUpdateProject((current) => ({ ...current, description: event.target.value }))}
                value={project.description}
              />
            </div>
          </section>

          <div className="project-config-columns">
            <section className="project-config-section">
              <div className="project-config-section-heading">
                <div>
                  <h3>{t('project.detail.environmentConfig')}</h3>
                  <p>{t('project.environment.description')}</p>
                </div>
                <ServerCog className="h-5 w-5 text-primary" />
              </div>
              <div className="grid gap-3">
                {project.environments.map((environment) => (
                  <EnvironmentRow
                    environment={environment}
                    key={environment.id}
                    onUpdateProject={onUpdateProject}
                    selectedProject={project}
                  />
                ))}
              </div>
            </section>

            <div className="grid content-start gap-5">
              <section className="project-config-section">
                <div className="project-config-section-heading">
                  <div>
                    <h3>{t('project.detail.groups')}</h3>
                    <p>{t('project.detail.groupDescription')}</p>
                  </div>
                  <Button onClick={onCreateGroup} size="sm" type="button" variant="outline">
                    <Plus className="h-4 w-4" />
                    {t('project.detail.manage')}
                  </Button>
                </div>
                <div className="grid gap-2">
                  {project.groups.map((group) => (
                    <GroupRow
                      active={group.id === selectedGroupId}
                      group={group}
                      key={group.id}
                      onDeleteGroup={onDeleteGroup}
                      onSelectGroup={onSelectGroup}
                      onUpdateProject={onUpdateProject}
                      selectedProject={project}
                    />
                  ))}
                </div>
              </section>

              <section className="project-config-section">
                <div className="project-config-section-heading">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <h3>{t('project.detail.credentials')}</h3>
                  </div>
                </div>
                <div className="grid gap-3">
                  <div className="form-field">
                    <Label>{t('project.credential.name')}</Label>
                    <Input
                      onChange={(event) => setCredentialLabel(event.target.value)}
                      placeholder={t('project.credential.labelPlaceholder')}
                      value={credentialLabel}
                    />
                  </div>
                  <div className="form-field">
                    <Label>{t('project.credential.username')}</Label>
                    <Input
                      onChange={(event) => setCredentialUsername(event.target.value)}
                      placeholder="admin@example.com"
                      value={credentialUsername}
                    />
                  </div>
                  <div className="form-field">
                    <Label>{t('project.credential.secret')}</Label>
                    <Input
                      onChange={(event) => setCredentialSecret(event.target.value)}
                      placeholder={t('project.credential.localEncryption')}
                      type="password"
                      value={credentialSecret}
                    />
                  </div>
                  <Button
                    disabled={!credentialLabel.trim() || !credentialSecret.trim()}
                    onClick={async () => {
                      const ref = await onSaveCredential({
                        label: credentialLabel,
                        username: credentialUsername,
                        secret: credentialSecret,
                      });
                      if (ref) {
                        setCredentialSecret('');
                      }
                    }}
                    type="button"
                    variant="outline"
                  >
                    {t('project.credential.save')}
                  </Button>
                </div>
                {project.credentialRefs.length ? (
                  <div className="project-credential-list">
                    {project.credentialRefs.map((credential) => (
                      <div className="project-credential-row" key={credential.id}>
                        <p>{credential.label}</p>
                        <span>{credential.username || t('project.detail.usernameUnset')} · ********</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="project-config-section">
                <div className="project-config-section-heading">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h3>{t('project.storageState.title')}</h3>
                  </div>
                </div>
                <div className="grid gap-3">
                  <div className="form-field">
                    <Label htmlFor={storageStateLabelId}>{t('project.storageState.name')}</Label>
                    <Input
                      id={storageStateLabelId}
                      onChange={(event) => setStorageStateLabel(event.target.value)}
                      placeholder={t('project.storageState.placeholder')}
                      value={storageStateLabel}
                    />
                  </div>
                  <Button
                    disabled={!storageStateLabel.trim() || Boolean(storageStateAction)}
                    onClick={async () => {
                      setStorageStateError(undefined);
                      setStorageStateAction('import');
                      try {
                        const reference = await importStorageState({
                          projectId: project.id,
                          label: storageStateLabel,
                        });
                        if (reference) {
                          onUpdateProject((current) => ({
                            ...current,
                            storageStateRefs: [
                              reference,
                              ...current.storageStateRefs.filter((item) => item.id !== reference.id),
                            ],
                          }));
                          setStorageStateLabel('');
                        }
                      } catch {
                        setStorageStateError(t('project.storageState.importError'));
                      } finally {
                        setStorageStateAction(undefined);
                      }
                    }}
                    type="button"
                    variant="outline"
                  >
                    {t('project.storageState.import')}
                  </Button>
                  <Button
                    disabled={!storageStateLabel.trim() || Boolean(storageStateAction)}
                    onClick={async () => {
                      setStorageStateError(undefined);
                      setStorageStateAction('capture');
                      try {
                        const reference = await captureStorageState({
                          projectId: project.id,
                          label: storageStateLabel,
                        });
                        if (!reference) {
                          throw new Error('desktop unavailable');
                        }
                        onUpdateProject((current) => ({
                          ...current,
                          storageStateRefs: [
                            reference,
                            ...current.storageStateRefs.filter((item) => item.id !== reference.id),
                          ],
                        }));
                        setStorageStateLabel('');
                      } catch {
                        setStorageStateError(t('project.storageState.captureError'));
                      } finally {
                        setStorageStateAction(undefined);
                      }
                    }}
                    type="button"
                    variant="outline"
                  >
                    <Camera className="h-4 w-4" />
                    {storageStateAction === 'capture' ? t('project.storageState.capturing') : t('project.storageState.capture')}
                  </Button>
                </div>
                {storageStateError ? <p aria-live="polite" className="mt-3 text-sm text-destructive">{storageStateError}</p> : null}
                {project.storageStateRefs.length ? (
                  <div className="project-credential-list mt-3">
                    {project.storageStateRefs.map((reference) => (
                      <div className="project-credential-row" key={reference.id}>
                        <div>
                          <p>{reference.label}</p>
                          <span>{t(`project.storageState.${reference.availability}`)}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            aria-label={t('project.storageState.refresh')}
                            disabled={Boolean(storageStateAction)}
                            onClick={async () => {
                              setStorageStateError(undefined);
                              setStorageStateAction(`refresh:${reference.id}`);
                              try {
                                const refreshed = await captureStorageState({
                                  projectId: project.id,
                                  label: reference.label,
                                  storageStateId: reference.id,
                                });
                                if (!refreshed) {
                                  throw new Error('desktop unavailable');
                                }
                                onUpdateProject((current) => ({
                                  ...current,
                                  storageStateRefs: current.storageStateRefs.map((item) => item.id === refreshed.id ? refreshed : item),
                                }));
                              } catch {
                                setStorageStateError(t('project.storageState.captureError'));
                              } finally {
                                setStorageStateAction(undefined);
                              }
                            }}
                            size="icon"
                            title={t('project.storageState.refresh')}
                            type="button"
                            variant="ghost"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={t('project.storageState.revoke')}
                            disabled={Boolean(storageStateAction)}
                            onClick={async () => {
                              setStorageStateError(undefined);
                              setStorageStateAction(`revoke:${reference.id}`);
                              try {
                                if (!await revokeStorageState({ projectId: project.id, storageStateId: reference.id })) {
                                  throw new Error('desktop unavailable');
                                }
                                onUpdateProject((current) => ({
                                  ...current,
                                  storageStateRefs: current.storageStateRefs.filter((item) => item.id !== reference.id),
                                  environments: current.environments.map((environment) => {
                                    if (environment.storageStateId !== reference.id) {
                                      return environment;
                                    }
                                    const { storageStateId: _storageStateId, ...environmentWithoutStorageState } = environment;
                                    return environmentWithoutStorageState;
                                  }),
                                }));
                              } catch {
                                setStorageStateError(t('project.storageState.revokeError'));
                              } finally {
                                setStorageStateAction(undefined);
                              }
                            }}
                            size="icon"
                            title={t('project.storageState.revoke')}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <FixtureSection
                onUpdateProject={onUpdateProject}
                project={project}
                projectAssetBinding={projectAssetBinding}
              />

              <ProjectAssetSnapshotSection
                binding={projectAssetBinding}
                onProjectAssetBound={onProjectAssetBound}
                onProjectAssetReloaded={onProjectAssetReloaded}
                project={project}
              />

              <Button
                className="justify-start"
                onClick={() => {
                  onDeleteProject(project.id);
                  onClose();
                }}
                type="button"
                variant="destructive"
              >
                <Trash2 className="h-4 w-4" />
                {t('project.delete')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type FixtureDraft = {
  name: string;
  description: string;
  setupMode: FixtureExecutionMode;
  cleanupMode: FixtureExecutionMode | 'none';
  setupHttp: FixtureHttpDraft;
  cleanupHttp: FixtureHttpDraft;
  inputDefinitions: string;
  outputDefinitions: string;
  environmentId: string;
  credentialId: string;
  concurrency: FixtureAsset['concurrency'];
  resourceLocks: string;
};

type FixtureHttpDraft = {
  method: FixtureHttpMethod;
  path: string;
  expectedStatuses: string;
  body: string;
  responseOutputs: string;
};

function createFixtureHttpDraft(declaration?: FixtureLifecycleDeclaration): FixtureHttpDraft {
  const http = declaration?.mode === 'http' ? declaration.http : undefined;
  return {
    method: http?.method ?? 'POST',
    path: http?.path ?? '',
    expectedStatuses: http?.expectedStatuses.join(', ') ?? '200',
    body: http?.body === undefined ? '' : JSON.stringify(http.body, null, 2),
    responseOutputs: http?.responseOutputs?.map((mapping) => `${mapping.outputName}: ${mapping.jsonPointer}`).join('\n') ?? '',
  };
}

function createFixtureDraft(fixture?: FixtureAsset): FixtureDraft {
  const parameterLines = (parameters: FixtureParameter[]) => parameters
    .map((parameter) => `${parameter.name}:${parameter.type}${parameter.required ? '' : '?'}`)
    .join('\n');
  return {
    name: fixture?.name ?? '',
    description: fixture?.description ?? '',
    setupMode: fixture?.setup.mode === 'script' ? 'ui' : fixture?.setup.mode ?? 'http',
    cleanupMode: fixture?.cleanup?.mode === 'script' ? 'ui' : fixture?.cleanup?.mode ?? 'none',
    setupHttp: createFixtureHttpDraft(fixture?.setup),
    cleanupHttp: createFixtureHttpDraft(fixture?.cleanup),
    inputDefinitions: parameterLines(fixture?.inputs ?? []),
    outputDefinitions: parameterLines(fixture?.outputs ?? []),
    environmentId: fixture?.environmentIds[0] ?? 'all',
    credentialId: fixture?.credentialIds[0] ?? 'none',
    concurrency: fixture?.concurrency ?? 'exclusive',
    resourceLocks: fixture?.resourceLocks.join(', ') ?? '',
  };
}

function parseFixtureHttpDraft(draft: FixtureHttpDraft, allowResponseOutputs = true): FixtureHttpDeclaration | undefined {
  const expectedStatuses = draft.expectedStatuses
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean)
    .map(Number);
  let body: unknown;
  if (draft.body.trim()) {
    try {
      body = JSON.parse(draft.body);
    } catch {
      return undefined;
    }
  }
  const responseOutputs = draft.responseOutputs
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [outputName, jsonPointer, ...rest] = line.split(':').map((part) => part.trim());
      return outputName && jsonPointer && !rest.length ? { outputName, jsonPointer } : undefined;
    });
  if (!allowResponseOutputs && responseOutputs.length) {
    return undefined;
  }
  if (responseOutputs.some((mapping) => !mapping)) {
    return undefined;
  }
  return normalizeFixtureHttpDeclaration({
    method: draft.method,
    path: draft.path.trim(),
    expectedStatuses,
    ...(body === undefined ? {} : { body }),
    ...(responseOutputs.length ? { responseOutputs } : {}),
  });
}

function createFixtureLifecycle(
  mode: FixtureExecutionMode,
  summary: string,
  httpDraft: FixtureHttpDraft,
  allowResponseOutputs = true,
): FixtureLifecycleDeclaration | undefined {
  if (mode === 'http') {
    const http = parseFixtureHttpDraft(httpDraft, allowResponseOutputs);
    return http ? { mode: 'http', summary, http } : undefined;
  }
  return { mode, summary };
}

function FixtureHttpFields({
  draft,
  idPrefix,
  onChange,
  showResponseOutputs = false,
}: {
  draft: FixtureHttpDraft;
  idPrefix: string;
  onChange: (patch: Partial<FixtureHttpDraft>) => void;
  showResponseOutputs?: boolean;
}) {
  const { t } = useI18n();
  const methodLabelId = `${idPrefix}-method-label`;
  const pathId = `${idPrefix}-path`;
  const expectedStatusesId = `${idPrefix}-expected-statuses`;
  const bodyId = `${idPrefix}-body`;
  const responseOutputsId = `${idPrefix}-response-outputs`;

  return (
    <div className="grid gap-3 rounded-[4px] border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-[132px,minmax(0,1fr)]">
        <div className="grid gap-2">
          <Label id={methodLabelId}>{t('project.fixture.http.method')}</Label>
          <Select onValueChange={(method) => onChange({ method: method as FixtureHttpMethod })} value={draft.method}>
            <SelectTrigger aria-labelledby={methodLabelId}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={pathId}>{t('project.fixture.http.path')}</Label>
          <Input id={pathId} onChange={(event) => onChange({ path: event.target.value })} placeholder="/api/test-data/orders" value={draft.path} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={expectedStatusesId}>{t('project.fixture.http.expectedStatuses')}</Label>
        <Input id={expectedStatusesId} inputMode="numeric" onChange={(event) => onChange({ expectedStatuses: event.target.value })} placeholder="200, 201" value={draft.expectedStatuses} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={bodyId}>{t('project.fixture.http.body')}</Label>
        <Textarea className="min-h-20 font-mono text-xs" id={bodyId} onChange={(event) => onChange({ body: event.target.value })} placeholder={'{\n  "orderType": "test"\n}'} value={draft.body} />
      </div>
      {showResponseOutputs ? (
        <div className="grid gap-2">
          <Label htmlFor={responseOutputsId}>{t('project.fixture.http.responseOutputs')}</Label>
          <Textarea className="min-h-20 font-mono text-xs" id={responseOutputsId} onChange={(event) => onChange({ responseOutputs: event.target.value })} placeholder="orderId: /orderId" value={draft.responseOutputs} />
          <p className="text-xs leading-5 text-muted-foreground">{t('project.fixture.http.responseOutputsHint')}</p>
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">{t('project.fixture.http.safety')}</p>
    </div>
  );
}

function parseFixtureParameters(value: string): { parameters: FixtureParameter[]; valid: boolean } {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const parameters = lines.map((line) => {
    const [rawName, rawType, ...rest] = line.split(':').map((part) => part.trim());
    const required = !rawType?.endsWith('?');
    const type = rawType?.replace(/\?$/u, '');
    if (
      rest.length ||
      !rawName ||
      !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(rawName) ||
      (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'json')
    ) {
      return undefined;
    }
    return { name: rawName, type, required } as FixtureParameter;
  });
  const valid = parameters.every((parameter): parameter is FixtureParameter => Boolean(parameter)) &&
    new Set(parameters.map((parameter) => parameter?.name)).size === parameters.length;
  return { parameters: parameters.filter((parameter): parameter is FixtureParameter => Boolean(parameter)), valid };
}

function FixtureEditorDialog({
  fixture,
  onOpenChange,
  onSave,
  open,
  project,
}: {
  fixture?: FixtureAsset;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: FixtureDraft) => void;
  open: boolean;
  project: ProjectDraft;
}) {
  const { t } = useI18n();
  const nameId = useId();
  const descriptionId = useId();
  const setupLabelId = useId();
  const cleanupLabelId = useId();
  const inputsId = useId();
  const outputsId = useId();
  const environmentLabelId = useId();
  const credentialLabelId = useId();
  const concurrencyLabelId = useId();
  const resourceLocksId = useId();
  const [draft, setDraft] = useState<FixtureDraft>(() => createFixtureDraft(fixture));
  const inputs = parseFixtureParameters(draft.inputDefinitions);
  const outputs = parseFixtureParameters(draft.outputDefinitions);
  const setupHttp = parseFixtureHttpDraft(draft.setupHttp);
  const cleanupHttp = parseFixtureHttpDraft(draft.cleanupHttp, false);
  const setupOutputMappingsAreDeclared = !setupHttp?.responseOutputs?.some((mapping) => (
    !outputs.parameters.some((output) => output.name === mapping.outputName)
  ));

  useEffect(() => {
    if (open) {
      setDraft(createFixtureDraft(fixture));
    }
  }, [fixture, open]);

  const update = (patch: Partial<FixtureDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const updateHttp = (lifecycle: 'setupHttp' | 'cleanupHttp', patch: Partial<FixtureHttpDraft>) => {
    setDraft((current) => ({ ...current, [lifecycle]: { ...current[lifecycle], ...patch } }));
  };
  const canSave = Boolean(
    draft.name.trim() &&
    inputs.valid &&
    outputs.valid &&
    (draft.setupMode !== 'http' || setupHttp) &&
    setupOutputMappingsAreDeclared &&
    (draft.cleanupMode !== 'http' || cleanupHttp),
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>{fixture ? t('project.fixture.newVersion') : t('project.fixture.create')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={nameId}>{t('project.fixture.name')}</Label>
            <Input id={nameId} onChange={(event) => update({ name: event.target.value })} value={draft.name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={descriptionId}>{t('project.fixture.description')}</Label>
            <Textarea className="min-h-20" id={descriptionId} onChange={(event) => update({ description: event.target.value })} value={draft.description} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label id={setupLabelId}>{t('project.fixture.setup')}</Label>
              <Select onValueChange={(value) => update({ setupMode: value as FixtureExecutionMode })} value={draft.setupMode}>
                <SelectTrigger aria-labelledby={setupLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="ui">{t('project.fixture.ui')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label id={cleanupLabelId}>{t('project.fixture.cleanup')}</Label>
              <Select onValueChange={(value) => update({ cleanupMode: value as FixtureDraft['cleanupMode'] })} value={draft.cleanupMode}>
                <SelectTrigger aria-labelledby={cleanupLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('project.fixture.noCleanup')}</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="ui">{t('project.fixture.ui')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {draft.setupMode === 'http' ? (
            <FixtureHttpFields draft={draft.setupHttp} idPrefix="fixture-setup-http" onChange={(patch) => updateHttp('setupHttp', patch)} showResponseOutputs />
          ) : null}
          {draft.cleanupMode === 'http' ? (
            <FixtureHttpFields draft={draft.cleanupHttp} idPrefix="fixture-cleanup-http" onChange={(patch) => updateHttp('cleanupHttp', patch)} />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={inputsId}>{t('project.fixture.inputs')}</Label>
              <Textarea aria-invalid={!inputs.valid} className="min-h-24 font-mono text-xs" id={inputsId} onChange={(event) => update({ inputDefinitions: event.target.value })} placeholder="accountId:string" value={draft.inputDefinitions} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={outputsId}>{t('project.fixture.outputs')}</Label>
              <Textarea aria-invalid={!outputs.valid} className="min-h-24 font-mono text-xs" id={outputsId} onChange={(event) => update({ outputDefinitions: event.target.value })} placeholder="orderId:string" value={draft.outputDefinitions} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label id={environmentLabelId}>{t('project.fixture.environment')}</Label>
              <Select onValueChange={(value) => update({ environmentId: value })} value={draft.environmentId}>
                <SelectTrigger aria-labelledby={environmentLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('project.fixture.allEnvironments')}</SelectItem>
                  {project.environments.map((environment) => <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label id={credentialLabelId}>{t('project.fixture.credential')}</Label>
              <Select onValueChange={(value) => update({ credentialId: value })} value={draft.credentialId}>
                <SelectTrigger aria-labelledby={credentialLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('project.fixture.noCredential')}</SelectItem>
                  {project.credentialRefs.map((credential) => <SelectItem key={credential.id} value={credential.id}>{credential.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label id={concurrencyLabelId}>{t('project.fixture.concurrency')}</Label>
              <Select onValueChange={(value) => update({ concurrency: value as FixtureAsset['concurrency'] })} value={draft.concurrency}>
                <SelectTrigger aria-labelledby={concurrencyLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclusive">{t('project.fixture.exclusive')}</SelectItem>
                  <SelectItem value="parallel">{t('project.fixture.parallel')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={resourceLocksId}>{t('project.fixture.resourceLocks')}</Label>
              <Input id={resourceLocksId} onChange={(event) => update({ resourceLocks: event.target.value })} placeholder="orders:seed" value={draft.resourceLocks} />
            </div>
          </div>
          <Button disabled={!canSave} onClick={() => onSave(draft)} type="button">
            {fixture ? t('project.fixture.saveVersion') : t('project.fixture.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FixtureSection({
  onUpdateProject,
  project,
  projectAssetBinding,
}: {
  onUpdateProject: (updater: (project: ProjectDraft) => ProjectDraft) => void;
  project: ProjectDraft;
  projectAssetBinding?: ProjectAssetBinding;
}) {
  const { t } = useI18n();
  const [editingFixture, setEditingFixture] = useState<FixtureAsset>();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [scriptTrusts, setScriptTrusts] = useState<FixtureScriptTrustStatus[]>([]);
  const [trustingKey, setTrustingKey] = useState<string>();
  const [scriptTrustError, setScriptTrustError] = useState('');

  useEffect(() => {
    let active = true;
    if (!projectAssetBinding) {
      setScriptTrusts([]);
      return () => {
        active = false;
      };
    }
    void listFixtureScriptTrusts(project.id)
      .then((records) => {
        if (active) {
          setScriptTrusts(records);
        }
      })
      .catch(() => {
        if (active) {
          setScriptTrustError(t('project.fixture.scriptTrustError'));
        }
      });
    return () => {
      active = false;
    };
  }, [project.id, projectAssetBinding, t]);

  async function approveScriptTrust(fixture: FixtureAsset, lifecycle: FixtureScriptLifecycle) {
    const key = `${fixture.id}@${fixture.version}:${lifecycle}`;
    setTrustingKey(key);
    setScriptTrustError('');
    try {
      const status = await approveFixtureScriptTrust({
        projectId: project.id,
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        lifecycle,
      });
      if (!status) {
        throw new Error('desktop bridge unavailable');
      }
      setScriptTrusts((current) => [
        ...current.filter((item) => !(
          item.fixtureId === status.fixtureId &&
          item.fixtureVersion === status.fixtureVersion &&
          item.lifecycle === status.lifecycle
        )),
        status,
      ]);
    } catch {
      setScriptTrustError(t('project.fixture.scriptTrustError'));
    } finally {
      setTrustingKey(undefined);
    }
  }

  function saveFixture(draft: FixtureDraft) {
    const inputs = parseFixtureParameters(draft.inputDefinitions).parameters;
    const outputs = parseFixtureParameters(draft.outputDefinitions).parameters;
    const now = new Date().toISOString();
    const setup = createFixtureLifecycle(draft.setupMode, draft.description.trim() || draft.name.trim(), draft.setupHttp);
    const cleanup = draft.cleanupMode === 'none'
      ? undefined
      : createFixtureLifecycle(draft.cleanupMode, `${draft.name.trim()} cleanup`, draft.cleanupHttp, false);
    if (!setup || (draft.cleanupMode !== 'none' && !cleanup)) {
      return;
    }
    onUpdateProject((current) => {
      const id = editingFixture?.id ?? `fixture-${Date.now()}`;
      const version = editingFixture
        ? Math.max(0, ...current.fixtures.filter((fixture) => fixture.id === editingFixture.id).map((fixture) => fixture.version)) + 1
        : 1;
      const fixture: FixtureAsset = {
        schemaVersion: 1,
        id,
        version,
        name: draft.name.trim(),
        description: draft.description.trim(),
        inputs,
        outputs,
        credentialIds: draft.credentialId === 'none' ? [] : [draft.credentialId],
        environmentIds: draft.environmentId === 'all' ? [] : [draft.environmentId],
        setup,
        ...(cleanup ? { cleanup } : {}),
        concurrency: draft.concurrency,
        resourceLocks: Array.from(new Set(draft.resourceLocks.split(',').map((lock) => lock.trim()).filter(Boolean))),
        createdAt: now,
        updatedAt: now,
      };
      return { ...current, fixtures: [...current.fixtures, fixture] };
    });
    setIsEditorOpen(false);
    setEditingFixture(undefined);
  }

  return (
    <section className="project-config-section">
      <div className="project-config-section-heading">
        <div>
          <h3>{t('project.fixture.title')}</h3>
        </div>
        <Button onClick={() => { setEditingFixture(undefined); setIsEditorOpen(true); }} size="sm" type="button" variant="outline">
          <Plus className="h-4 w-4" />
          {t('project.fixture.create')}
        </Button>
      </div>
      {project.fixtures.length ? (
        <div className="grid gap-2">
          {project.fixtures.map((fixture) => (
            <div className="flex items-start justify-between gap-3 rounded-[4px] border border-border bg-muted/20 p-3" key={`${fixture.id}@${fixture.version}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fixture.name}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  v{fixture.version} · {fixture.setup.mode.toUpperCase()} · {fixture.concurrency === 'exclusive' ? t('project.fixture.exclusive') : t('project.fixture.parallel')}
                </p>
                {projectAssetBinding ? ([
                  ...(fixture.setup.mode === 'script' ? ['setup' as const] : []),
                  ...(fixture.cleanup?.mode === 'script' ? ['cleanup' as const] : []),
                ] as FixtureScriptLifecycle[]).map((lifecycle) => {
                  const declaration = lifecycle === 'setup' ? fixture.setup : fixture.cleanup;
                  const script = declaration?.mode === 'script' ? declaration.script : undefined;
                  if (!script) {
                    return null;
                  }
                  const key = `${fixture.id}@${fixture.version}:${lifecycle}`;
                  const trusted = scriptTrusts.some((record) => (
                    record.fixtureId === fixture.id &&
                    record.fixtureVersion === fixture.version &&
                    record.lifecycle === lifecycle &&
                    record.relativePath === script.relativePath &&
                    record.contentHash === script.contentHash
                  ));
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" key={key}>
                      <span className="text-muted-foreground">
                        {lifecycle === 'setup' ? t('project.fixture.setupScript') : t('project.fixture.cleanupScript')} · {script.relativePath}
                      </span>
                      <Badge variant="outline">{trusted ? t('project.fixture.scriptTrusted') : t('project.fixture.scriptUntrusted')}</Badge>
                      <Button
                        disabled={trusted || trustingKey === key}
                        onClick={() => void approveScriptTrust(fixture, lifecycle)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {trustingKey === key ? t('project.fixture.scriptTrusting') : t('project.fixture.trustScript')}
                      </Button>
                    </div>
                  );
                }) : null}
              </div>
              <Button onClick={() => { setEditingFixture(fixture); setIsEditorOpen(true); }} size="sm" type="button" variant="ghost">
                {t('project.fixture.newVersion')}
              </Button>
            </div>
          ))}
        </div>
      ) : <p className="text-sm leading-6 text-muted-foreground">{t('project.fixture.empty')}</p>}
      {scriptTrustError ? <p className="mt-2 text-sm text-destructive">{scriptTrustError}</p> : null}
      <FixtureEditorDialog
        fixture={editingFixture}
        onOpenChange={(open) => { setIsEditorOpen(open); if (!open) setEditingFixture(undefined); }}
        onSave={saveFixture}
        open={isEditorOpen}
        project={project}
      />
    </section>
  );
}

function ProjectAssetSnapshotSection({
  binding,
  onProjectAssetBound,
  onProjectAssetReloaded,
  project,
}: {
  binding?: ProjectAssetBinding;
  onProjectAssetBound?: (binding: ProjectAssetBinding) => void;
  onProjectAssetReloaded?: (result: ProjectAssetReloadResult) => void;
  project: ProjectDraft;
}) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<ProjectAssetMigrationPlan>();
  const [bindingStatus, setBindingStatus] = useState<ProjectAssetBindingStatus>();
  const [reloadPlan, setReloadPlan] = useState<ProjectAssetReloadPlan>();
  const [updatePlan, setUpdatePlan] = useState<ProjectAssetUpdatePlan>();
  const [status, setStatus] = useState<'idle' | 'planning' | 'writing' | 'written' | 'reloadPlanning' | 'reloading' | 'reloaded' | 'updatePlanning' | 'updating' | 'updated' | 'error'>('idle');
  const [isInspecting, setIsInspecting] = useState(false);
  const [error, setError] = useState('');

  async function refreshBindingStatus() {
    if (!binding) {
      setBindingStatus(undefined);
      return;
    }

    setIsInspecting(true);
    try {
      const nextStatus = await inspectProjectAssetBinding(project.id);
      setBindingStatus(nextStatus);
      if (nextStatus?.state !== 'externalChanges') {
        setReloadPlan(undefined);
      }
      if (nextStatus?.state !== 'localChanges') {
        setUpdatePlan(undefined);
      }
    } catch (caughtError) {
      setBindingStatus({
        projectId: project.id,
        projectDirectory: binding.projectDirectory,
        state: 'unavailable',
        issues: [{
          path: binding.projectDirectory,
          message: caughtError instanceof Error ? caughtError.message : t('project.assets.error'),
        }],
      });
    } finally {
      setIsInspecting(false);
    }
  }

  useEffect(() => {
    void refreshBindingStatus();
  }, [binding?.projectDirectory, binding?.revision, project.id]);

  useEffect(() => {
    setPlan(undefined);
    setReloadPlan(undefined);
    setUpdatePlan(undefined);
  }, [project.updatedAt]);

  if (!canPublishProjectAssetSnapshot()) {
    return null;
  }

  async function prepareSnapshot() {
    setStatus('planning');
    setError('');
    try {
      const projectDirectory = await selectProjectAssetDirectory();
      if (!projectDirectory) {
        setStatus('idle');
        return;
      }

      const nextPlan = await planProjectAssetMigration({ projectId: project.id, projectDirectory, project });
      if (!nextPlan) {
        setStatus('idle');
        return;
      }
      setPlan(nextPlan);
      setStatus('idle');
    } catch (caughtError) {
      setPlan(undefined);
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : t('project.assets.error'));
    }
  }

  async function prepareReload() {
    if (!binding) {
      return;
    }

    setStatus('reloadPlanning');
    setError('');
    try {
      const nextPlan = await planProjectAssetReload({ projectId: project.id, project });
      setReloadPlan(nextPlan);
      setStatus('idle');
    } catch (caughtError) {
      setReloadPlan(undefined);
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : t('project.assets.error'));
    }
  }

  async function prepareUpdate() {
    if (!binding) {
      return;
    }

    setStatus('updatePlanning');
    setError('');
    try {
      const nextPlan = await planProjectAssetUpdate({
        projectId: project.id,
        project,
        expectedRevision: binding.revision,
      });
      setUpdatePlan(nextPlan);
      setStatus('idle');
    } catch (caughtError) {
      setUpdatePlan(undefined);
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : t('project.assets.error'));
    }
  }

  async function writeSnapshot() {
    if (!plan || plan.status !== 'ready') {
      return;
    }

    setStatus('writing');
    setError('');
    try {
      const nextBinding = await writeProjectAssetSnapshot({
        projectId: project.id,
        projectDirectory: plan.projectDirectory,
        project,
        plannedRevision: plan.snapshotRevision,
      });
      if (!nextBinding) {
        setStatus('idle');
        return;
      }
      onProjectAssetBound?.(nextBinding);
      setBindingStatus({
        projectId: project.id,
        projectDirectory: nextBinding.projectDirectory,
        state: 'inSync',
        issues: [],
      });
      setStatus('written');
    } catch (caughtError) {
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : t('project.assets.error'));
    }
  }

  async function reloadSnapshot() {
    if (!reloadPlan || reloadPlan.status !== 'ready' || !reloadPlan.snapshotRevision) {
      return;
    }

    setStatus('reloading');
    setError('');
    try {
      const result = await reloadProjectAssetSnapshot({
        projectId: project.id,
        project,
        snapshotRevision: reloadPlan.snapshotRevision,
      });
      if (!result) {
        setStatus('idle');
        return;
      }
      onProjectAssetReloaded?.(result);
      setBindingStatus({
        projectId: result.project.id,
        projectDirectory: result.binding.projectDirectory,
        state: 'inSync',
        issues: [],
      });
      setReloadPlan(undefined);
      setStatus('reloaded');
    } catch (caughtError) {
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : t('project.assets.error'));
    }
  }

  async function updateSnapshot() {
    if (!binding || !updatePlan || updatePlan.status !== 'ready' || !updatePlan.snapshotRevision) {
      return;
    }

    setStatus('updating');
    setError('');
    try {
      const nextBinding = await updateProjectAssetSnapshot({
        projectId: project.id,
        project,
        expectedRevision: binding.revision,
        plannedRevision: updatePlan.snapshotRevision,
      });
      if (!nextBinding) {
        setStatus('idle');
        return;
      }
      onProjectAssetBound?.(nextBinding);
      setBindingStatus({
        projectId: project.id,
        projectDirectory: nextBinding.projectDirectory,
        state: 'inSync',
        issues: [],
      });
      setUpdatePlan(undefined);
      setStatus('updated');
    } catch (caughtError) {
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : t('project.assets.error'));
    }
  }

  const isBusy = status === 'planning' || status === 'writing' || status === 'reloadPlanning' || status === 'reloading' || status === 'updatePlanning' || status === 'updating';
  const canWrite = plan?.status === 'ready' && status !== 'written';

  return (
    <section className="project-config-section">
      <div className="project-config-section-heading">
        <div>
          <h3>{t('project.assets.title')}</h3>
        </div>
        <Boxes className="h-5 w-5 text-primary" />
      </div>
      <div className="grid gap-3">
        <Button disabled={isBusy} onClick={prepareSnapshot} size="sm" type="button" variant="outline">
          <Boxes className="h-4 w-4" />
          {status === 'planning'
            ? t('project.assets.planning')
            : plan
              ? t('project.assets.reselect')
              : t('project.assets.prepare')}
        </Button>
        {plan ? (
          <div className="grid gap-3 rounded-[4px] border border-border bg-muted/20 p-3">
            <p className="break-all font-mono text-xs text-muted-foreground">
              {t('project.assets.path')}: {plan.projectDirectory}
            </p>
            <Badge className="w-fit" variant="outline">
              {plan.status === 'ready' ? t('project.assets.ready') : t('project.assets.conflicts')}
            </Badge>
            {plan.status === 'ready' ? (
              <>
                <p className="text-sm text-muted-foreground">{t('project.assets.files', { count: plan.files.length })}</p>
                <ul className="max-h-36 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
                  {plan.files.map((file) => <li key={file}>{file}</li>)}
                </ul>
                <Button disabled={!canWrite || isBusy} onClick={writeSnapshot} size="sm" type="button">
                  <Boxes className="h-4 w-4" />
                  {status === 'writing' ? t('project.assets.writing') : t('project.assets.confirm')}
                </Button>
              </>
            ) : (
              <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-xs text-destructive">
                {plan.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
              </ul>
            )}
          </div>
        ) : null}
        {binding ? (
          <div className="grid gap-2 rounded-[4px] border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{t('project.assets.bound')}</p>
              <Badge className="w-fit" variant="outline">
                {isInspecting
                  ? t('project.assets.status.checking')
                  : t(`project.assets.status.${bindingStatus?.state ?? 'unavailable'}`)}
              </Badge>
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">{binding.projectDirectory}</p>
            {bindingStatus?.issues.length ? (
              <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
                {bindingStatus.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}>{issue.path}: {issue.message}</li>)}
              </ul>
            ) : null}
            <Button disabled={isInspecting || isBusy} onClick={refreshBindingStatus} size="sm" type="button" variant="outline">
              <Boxes className="h-4 w-4" />
              {t('project.assets.refresh')}
            </Button>
            {bindingStatus?.state === 'localChanges' ? (
              <Button disabled={isBusy} onClick={prepareUpdate} size="sm" type="button" variant="outline">
                <Boxes className="h-4 w-4" />
                {status === 'updatePlanning' ? t('project.assets.updatePlanning') : t('project.assets.updatePlan')}
              </Button>
            ) : null}
            {updatePlan ? (
              <div className="grid gap-2 rounded-[4px] border border-border bg-background p-3">
                <Badge className="w-fit" variant="outline">
                  {updatePlan.status === 'ready'
                    ? t('project.assets.updateReady')
                    : updatePlan.status === 'unavailable'
                      ? t('project.assets.reloadUnavailable')
                      : t('project.assets.updateBlocked')}
                </Badge>
                {updatePlan.files.length ? (
                  <p className="text-sm text-muted-foreground">{t('project.assets.files', { count: updatePlan.files.length })}</p>
                ) : null}
                {updatePlan.issues.length ? (
                  <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
                    {updatePlan.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}>{issue.path}: {issue.message}</li>)}
                  </ul>
                ) : null}
                {updatePlan.status === 'ready' ? (
                  <Button disabled={isBusy} onClick={updateSnapshot} size="sm" type="button">
                    <Boxes className="h-4 w-4" />
                    {status === 'updating' ? t('project.assets.updating') : t('project.assets.updateConfirm')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {bindingStatus?.state === 'externalChanges' ? (
              <Button disabled={isBusy} onClick={prepareReload} size="sm" type="button" variant="outline">
                <Boxes className="h-4 w-4" />
                {status === 'reloadPlanning' ? t('project.assets.reloadPlanning') : t('project.assets.reloadPlan')}
              </Button>
            ) : null}
            {reloadPlan ? (
              <div className="grid gap-2 rounded-[4px] border border-border bg-background p-3">
                <Badge className="w-fit" variant="outline">
                  {reloadPlan.status === 'ready'
                    ? t('project.assets.reloadReady')
                    : reloadPlan.status === 'unavailable'
                      ? t('project.assets.reloadUnavailable')
                      : t('project.assets.reloadBlocked')}
                </Badge>
                {reloadPlan.issues.length ? (
                  <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
                    {reloadPlan.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}>{issue.path}: {issue.message}</li>)}
                  </ul>
                ) : null}
                {reloadPlan.status === 'ready' ? (
                  <Button disabled={isBusy} onClick={reloadSnapshot} size="sm" type="button">
                    <Boxes className="h-4 w-4" />
                    {status === 'reloading' ? t('project.assets.reloading') : t('project.assets.reloadConfirm')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {status === 'written' ? <p aria-live="polite" className="text-sm text-primary">{t('project.assets.written')}</p> : null}
        {status === 'reloaded' ? <p aria-live="polite" className="text-sm text-primary">{t('project.assets.reloaded')}</p> : null}
        {status === 'updated' ? <p aria-live="polite" className="text-sm text-primary">{t('project.assets.updated')}</p> : null}
        {status === 'error' ? <p aria-live="polite" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}

function GroupRow({
  group,
  active,
  selectedProject,
  onDeleteGroup,
  onSelectGroup,
  onUpdateProject,
}: {
  group: ProjectGroup;
  active: boolean;
  selectedProject: ProjectDraft;
  onDeleteGroup: (groupId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onUpdateProject: (updater: (project: ProjectDraft) => ProjectDraft) => void;
}) {
  const { locale, t } = useI18n();
  const caseCount = selectedProject.testCases.filter((item) => item.groupId === group.id).length;

  return (
    <div
      className={`project-group-row cursor-pointer text-left ${active ? 'tech-active' : 'tech-list-row'}`}
      onClick={() => onSelectGroup(group.id)}
      role="button"
      tabIndex={0}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-[4px]" variant="outline">
              {t('project.group.caseCount', { count: caseCount })}
            </Badge>
            <Badge className="rounded-[4px]" variant="outline">
              {t('project.group.createdAt', { date: new Date(group.createdAt).toLocaleDateString(locale) })}
            </Badge>
          </div>
          <Input
            className="inline-edit mt-3 h-9 px-3 text-base font-semibold tracking-[-0.025em]"
            aria-label={t('project.group.name')}
            onChange={(event) =>
              onUpdateProject((project) => ({
                ...project,
                groups: project.groups.map((item) =>
                  item.id === group.id ? { ...item, name: event.target.value } : item,
                ),
              }))
            }
            onClick={(event) => event.stopPropagation()}
            value={group.name}
          />
        </div>
        <Button
          className="rounded-[4px] sm:mt-7"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteGroup(group.id);
          }}
          size="icon"
          type="button"
          variant="outline"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        className="inline-edit mt-3 min-h-[58px] resize-none px-3 py-2 text-sm leading-6"
        aria-label={t('project.group.description')}
        onChange={(event) =>
          onUpdateProject((project) => ({
            ...project,
            groups: project.groups.map((item) =>
              item.id === group.id ? { ...item, description: event.target.value } : item,
            ),
          }))
        }
        onClick={(event) => event.stopPropagation()}
        value={group.description}
      />
    </div>
  );
}

function EnvironmentRow({
  environment,
  selectedProject,
  onUpdateProject,
}: {
  environment: ProjectEnvironment;
  selectedProject: ProjectDraft;
  onUpdateProject: (updater: (project: ProjectDraft) => ProjectDraft) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="project-environment-row tech-list-row">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t('project.environment.eyebrow')}</p>
          <p className="mt-1 text-base font-semibold tracking-[-0.025em]">{environment.name}</p>
        </div>
        <Badge className="rounded-[4px]" variant="outline">
          {environment.kind}
        </Badge>
      </div>
      <div className="environment-form-grid mt-4">
        <div className="form-field">
          <Label>{t('project.environment.name')}</Label>
          <Input
            onChange={(event) =>
              onUpdateProject((project) => ({
                ...project,
                environments: project.environments.map((item) =>
                  item.id === environment.id ? { ...item, name: event.target.value } : item,
                ),
              }))
            }
            value={environment.name}
          />
        </div>
        <div className="form-field">
          <Label>{t('project.environment.entryPath')}</Label>
          <Input
            onChange={(event) =>
              onUpdateProject((project) => ({
                ...project,
                environments: project.environments.map((item) =>
                  item.id === environment.id ? { ...item, entryPath: event.target.value } : item,
                ),
              }))
            }
            value={environment.entryPath}
          />
        </div>
        <div className="form-field">
          <Label>{t('project.environment.browser')}</Label>
          <Select
            onValueChange={(value) =>
              onUpdateProject((project) => ({
                ...project,
                selectedEnvironmentId: environment.id,
                environments: project.environments.map((item) =>
                  item.id === environment.id ? { ...item, browser: value as ProjectEnvironment['browser'] } : item,
                ),
              }))
            }
            value={environment.browser}
          >
            <SelectTrigger className="rounded-[4px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chromium">Chromium</SelectItem>
              <SelectItem value="firefox">Firefox</SelectItem>
              <SelectItem value="webkit">WebKit</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="form-field">
          <Label>{t('project.environment.credential')}</Label>
          <Select
            onValueChange={(value) =>
              onUpdateProject((project) => ({
                ...project,
                environments: project.environments.map((item) =>
                  item.id === environment.id
                    ? { ...item, credentialId: value === 'none' ? undefined : value }
                    : item,
                ),
              }))
            }
            value={environment.credentialId ?? 'none'}
          >
            <SelectTrigger className="rounded-[4px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('project.environment.noCredential')}</SelectItem>
              {selectedProject.credentialRefs.map((credential) => (
                <SelectItem key={credential.id} value={credential.id}>
                  {credential.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="form-field">
          <Label>{t('project.environment.storageState')}</Label>
          <Select
            onValueChange={(value) =>
              onUpdateProject((project) => ({
                ...project,
                environments: project.environments.map((item) =>
                  item.id === environment.id
                    ? { ...item, storageStateId: value === 'none' ? undefined : value }
                    : item,
                ),
              }))
            }
            value={environment.storageStateId ?? 'none'}
          >
            <SelectTrigger className="rounded-[4px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('project.environment.noStorageState')}</SelectItem>
              {selectedProject.storageStateRefs.map((reference) => (
                <SelectItem key={reference.id} value={reference.id}>
                  {reference.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="form-field mt-3">
        <Label>{t('project.environment.url')}</Label>
        <Input
          onChange={(event) =>
            onUpdateProject((project) => ({
              ...project,
              environments: project.environments.map((item) =>
                item.id === environment.id ? { ...item, url: event.target.value } : item,
              ),
            }))
          }
          value={environment.url}
        />
        <p className="form-hint">{t('project.environment.urlHint')}</p>
      </div>
    </div>
  );
}
