import { useState } from 'react';
import type {
  CredentialRef,
  ProjectDraft,
  ProjectEnvironment,
  ProjectGroup,
} from '../../../shared/studio.js';

import {
  Boxes,
  FolderKanban,
  KeyRound,
  Layers3,
  ListChecks,
  Plus,
  ServerCog,
  Settings2,
  Trash2,
} from 'lucide-react';

import { EvidenceCard, PageBody, PageShell, Surface } from '../../components/workbench.js';
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

export function ProjectManagementPage({
  projects,
  selectedProject,
  selectedGroupId,
  onCreateProject,
  onDeleteProject,
  onSelectProject,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  onUpdateProject,
  onSaveCredential,
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

  const openProjectEditor = (project: ProjectDraft) => {
    onSelectProject(project.id);
    setEditingProjectId(project.id);
  };

  return (
    <PageShell>
      <header className="page-header motion-page-header project-overview-header">
        <div>
          <nav aria-label={t('project.overview.breadcrumbAria')} className="project-breadcrumb">
            <span>{t('project.overview.breadcrumbRoot')}</span>
            <span aria-hidden="true">/</span>
            <span className="text-foreground">{t('project.overview.breadcrumbCurrent')}</span>
          </nav>
          <h1>{t('project.header.title')}</h1>
          <p>{t('project.header.description')}</p>
        </div>
        <Button className="project-create-button" onClick={onCreateProject} type="button">
          <Plus className="h-4 w-4" />
          {t('project.create')}
        </Button>
      </header>
      <PageBody className="project-overview-scroll">
        <main className="project-overview" aria-label={t('project.overview.aria')}>
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
        onSaveCredential={onSaveCredential}
        onSelectGroup={onSelectGroup}
        onUpdateProject={onUpdateProject}
        open={Boolean(editingProject)}
        project={editingProject}
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
  project,
  t,
}: {
  active: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onSelect: () => void;
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
  onSaveCredential,
  onSelectGroup,
  onUpdateProject,
  open,
  project,
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
  onSaveCredential: (payload: { label: string; username: string; secret: string }) => Promise<CredentialRef | null>;
  onSelectGroup: (groupId: string) => void;
  onUpdateProject: (updater: (project: ProjectDraft) => ProjectDraft) => void;
  open: boolean;
  project?: ProjectDraft;
  selectedGroupId: string;
  setCredentialLabel: (value: string) => void;
  setCredentialSecret: (value: string) => void;
  setCredentialUsername: (value: string) => void;
}) {
  const { t } = useI18n();

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
