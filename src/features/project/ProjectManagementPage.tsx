import { useState } from 'react';
import type {
  CredentialRef,
  ProjectDraft,
  ProjectEnvironment,
  ProjectGroup,
} from '../../../shared/studio.js';

import { DatabaseZap, KeyRound, Plus, ServerCog, Trash2 } from 'lucide-react';

import { EvidenceCard, MetricTile, PageHeader, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

  return (
    <PageShell>
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-[4px]" onClick={onCreateProject} type="button">
              <Plus className="h-4 w-4" />
              {t('project.create')}
            </Button>
            <Button
              className="rounded-[4px]"
              disabled={!selectedProject}
              onClick={() => selectedProject && onDeleteProject(selectedProject.id)}
              type="button"
              variant="outline"
            >
              <Trash2 className="h-4 w-4" />
              {t('project.delete')}
            </Button>
          </div>
        }
        description={t('project.header.description')}
        eyebrow={t('project.header.eyebrow')}
        meta={[
          t('project.meta.projects', { count: projects.length }),
          t('project.meta.groups', { count: selectedProject?.groups.length ?? 0 }),
          t('project.meta.environments', { count: selectedProject?.environments.length ?? 0 }),
        ].map((item) => (
          <Badge className="rounded-[4px] px-3 py-1.5" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('project.header.title')}
      />

      <PageBody>
        <section className="designer-split project-console">
          <aside className="designer-panel">
            <div className="designer-panel-header flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('project.list.active', { count: projects.length })}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">{t('project.list.title')}</h2>
              </div>
              <DatabaseZap className="h-5 w-5 text-primary" />
            </div>
            <div className="designer-panel-body grid gap-3">
              <div className="grid gap-2">
                <Label>{t('project.list.all')}</Label>
                <Select onValueChange={onSelectProject} value={selectedProject?.id ?? ''}>
                  <SelectTrigger className="rounded-[4px]">
                    <SelectValue placeholder={t('project.list.select')} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {projects.map((project) => (
                <button
                  className={`designer-case-row ${selectedProject?.id === project.id ? 'is-active' : ''}`}
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  type="button"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{project.name}</span>
                      <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                        {project.description || t('project.list.noDescription')}
                      </span>
                    </span>
                    <Badge className="rounded-[4px]" variant="outline">
                      {project.testCases.length}
                    </Badge>
                  </span>
                  <span className="mt-3 flex gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    <span>{t('project.list.groups', { count: project.groups.length })}</span>
                    <span>{t('project.list.environments', { count: project.environments.length })}</span>
                  </span>
                </button>
              ))}
              {!projects.length ? (
                <EvidenceCard title={t('project.empty.title')} description={t('project.empty.description')} />
              ) : null}
            </div>
          </aside>

          <main className="designer-panel designer-detail-stage">
            {selectedProject ? (
              <div className="mx-auto grid max-w-[1280px] gap-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-primary">
                      <DatabaseZap className="h-4 w-4" />
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
                        {t('project.detail.eyebrow')}
                      </span>
                    </div>
                    <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em]">{selectedProject.name}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {selectedProject.description || t('project.detail.description')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="rounded-[4px]" onClick={onCreateProject} type="button" variant="outline">
                      <Plus className="h-4 w-4" />
                      {t('project.create')}
                    </Button>
                    <Button
                      className="rounded-[4px]"
                      onClick={() => onDeleteProject(selectedProject.id)}
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('project.delete')}
                    </Button>
                  </div>
                </div>

                <div className="designer-bento-grid">
                  <div className="designer-bento-main">
                    <Surface className="grid gap-5 p-5" variant="plain">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold tracking-[-0.03em]">{t('project.detail.basicInfo')}</h3>
                        <Badge className="rounded-[4px]" variant="outline">
                          {t('project.detail.caseCount', { count: selectedProject.testCases.length })}
                        </Badge>
                      </div>
                      <div className="form-grid">
                        <div className="form-field">
                          <Label>{t('project.form.name')}</Label>
                          <Input
                            onChange={(event) =>
                              onUpdateProject((project) => ({ ...project, name: event.target.value }))
                            }
                            value={selectedProject.name}
                          />
                        </div>
                        <div className="form-field is-url">
                          <Label>{t('project.detail.baseUrl')}</Label>
                          <Input
                            onChange={(event) =>
                              onUpdateProject((project) => ({ ...project, defaultUrl: event.target.value }))
                            }
                            value={selectedProject.defaultUrl}
                          />
                        </div>
                      </div>
                      <div className="form-field">
                        <Label>{t('project.form.description')}</Label>
                        <Textarea
                          className="min-h-[88px]"
                          onChange={(event) =>
                            onUpdateProject((project) => ({ ...project, description: event.target.value }))
                          }
                          value={selectedProject.description}
                        />
                      </div>
                    </Surface>

                    <Surface className="grid gap-4 p-5" variant="plain">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold tracking-[-0.03em]">{t('project.detail.environmentConfig')}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t('project.environment.description')}
                          </p>
                        </div>
                        <ServerCog className="h-5 w-5 text-primary" />
                      </div>
                      <div className="grid gap-3">
                        {selectedProject.environments.map((environment) => (
                          <EnvironmentRow
                            environment={environment}
                            key={environment.id}
                            onUpdateProject={onUpdateProject}
                            selectedProject={selectedProject}
                          />
                        ))}
                      </div>
                    </Surface>
                  </div>

                  <aside className="designer-bento-side">
                    <Surface className="p-5" variant="plain">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold tracking-[-0.03em]">{t('project.detail.groups')}</h3>
                        <Button className="rounded-[4px]" onClick={onCreateGroup} size="sm" type="button" variant="outline">
                          <Plus className="h-4 w-4" />
                          {t('project.detail.manage')}
                        </Button>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{t('project.detail.groupDescription')}</p>
                      <div className="mt-4 grid gap-2">
                        {selectedProject.groups.map((group) => (
                          <GroupRow
                            active={group.id === selectedGroupId}
                            group={group}
                            key={group.id}
                            onDeleteGroup={onDeleteGroup}
                            onSelectGroup={onSelectGroup}
                            onUpdateProject={onUpdateProject}
                            selectedProject={selectedProject}
                          />
                        ))}
                      </div>
                    </Surface>

                    <Surface className="p-5" variant="plain">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-primary" />
                        <h3 className="text-lg font-semibold tracking-[-0.03em]">{t('project.detail.credentials')}</h3>
                      </div>
                      <div className="mt-4 grid gap-3">
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
                          className="rounded-[4px]"
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
                      <div className="mt-4 grid gap-2">
                        {selectedProject.credentialRefs.map((credential) => (
                          <div className="designer-info-block" key={credential.id}>
                            <p className="text-sm font-semibold">{credential.label}</p>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {credential.username || t('project.detail.usernameUnset')} · ********
                            </p>
                          </div>
                        ))}
                      </div>
                    </Surface>

                    <Surface className="p-5" variant="evidence">
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">{t('project.detail.executionHealth')}</p>
                      <div className="mt-3 flex items-end gap-2">
                        <span className="text-4xl font-black tracking-[-0.06em]">98.4%</span>
                        <span className="pb-1 text-sm font-semibold text-secondary">+1.2%</span>
                      </div>
                      <div className="mt-4 grid grid-cols-4 gap-2">
                        <MetricTile label={t('project.metric.groups')} value={`${selectedProject.groups.length}`} />
                        <MetricTile label={t('project.metric.environments')} value={`${selectedProject.environments.length}`} />
                        <MetricTile label={t('project.metric.cases')} value={`${selectedProject.testCases.length}`} tone="primary" />
                        <MetricTile label={t('project.metric.documents')} value={`${selectedProject.documents.length}`} />
                      </div>
                    </Surface>
                  </aside>
                </div>
              </div>
            ) : (
              <EvidenceCard title={t('project.select.title')} description={t('project.select.description')} />
            )}
          </main>
        </section>
      </PageBody>
    </PageShell>
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
      className={`cursor-pointer rounded-[4px] p-4 text-left ${active ? 'tech-active' : 'tech-list-row'}`}
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
    <div className="tech-list-row rounded-[4px] p-4">
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
