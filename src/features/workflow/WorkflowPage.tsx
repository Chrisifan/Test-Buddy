import type {
  RuntimeProfile,
  RunTone,
  WorkflowDraft,
  WorkflowStepDraft,
} from '../../../shared/studio.js';

import { PlayCircle, Plus, Route, Settings2, Trash2 } from 'lucide-react';

import { EvidenceCard, MetricTile, PageHeader, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { StatusPill } from '../../components/StatusPill.js';
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

function getWorkflowKindLabel(workflow: WorkflowDraft, t: (key: string) => string): string {
  if (workflow.kind === 'assertion') {
    return t('cases.step.assert');
  }

  if (workflow.kind === 'extraction') {
    return t('cases.step.query');
  }

  return t('app.nav.workflow');
}

function getStepTypeLabel(type: WorkflowStepDraft['type'], t: (key: string) => string): string {
  if (type === 'aiAssert') {
    return t('cases.step.assert');
  }

  if (type === 'aiQuery') {
    return t('cases.step.query');
  }

  return t('cases.step.action');
}

export function WorkflowPage({
  workflows,
  selectedWorkflow,
  selectedWorkflowId,
  isRunning,
  runStatus,
  runTitle,
  runId,
  runLogs,
  runtimeProfile,
  onSelectWorkflow,
  onCreateWorkflow,
  onAppendStep,
  onRunWorkflow,
  onUpdateWorkflow,
  onDeleteStep,
  onDuplicateStepType,
  onUpdateRuntimeProfile,
}: {
  workflows: WorkflowDraft[];
  selectedWorkflow?: WorkflowDraft;
  selectedWorkflowId: string;
  isRunning: boolean;
  runStatus: RunTone;
  runTitle: string;
  runId: string;
  runLogs: string[];
  runtimeProfile: RuntimeProfile;
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onAppendStep: (type?: WorkflowStepDraft['type']) => void;
  onRunWorkflow: () => void;
  onUpdateWorkflow: (updater: (workflow: WorkflowDraft) => WorkflowDraft) => void;
  onDeleteStep: (stepId: string) => void;
  onDuplicateStepType: (type: WorkflowStepDraft['type']) => void;
  onUpdateRuntimeProfile: (patch: Partial<RuntimeProfile>) => void;
}) {
  const { t } = useI18n();

  return (
    <PageShell>
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-[4px]" onClick={onCreateWorkflow} type="button" variant="outline">
              <Plus className="h-4 w-4" />
              {t('workflow.action.create')}
            </Button>
            <Button
              className="rounded-[4px]"
              disabled={isRunning || !selectedWorkflow}
              onClick={onRunWorkflow}
              type="button"
            >
              <PlayCircle className="h-4 w-4" />
              {isRunning ? t('workflow.action.running') : t('workflow.action.run')}
            </Button>
          </div>
        }
        description={t('workflow.header.description')}
        eyebrow={t('workflow.header.eyebrow')}
        title={t('workflow.header.title')}
      />

      <PageBody>
        <section className="designer-split workflow-console">
          <aside className="designer-panel">
            <div className="designer-panel-header flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('workflow.library.eyebrow')}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">{t('workflow.library.title')}</h2>
              </div>
              <Button className="rounded-[4px]" onClick={onCreateWorkflow} size="sm" type="button" variant="outline">
                <Plus className="h-4 w-4" />
                {t('workflow.action.createShort')}
              </Button>
            </div>
            <div className="designer-panel-body grid gap-2">
              {workflows.map((workflow) => (
                <button
                  className={`designer-case-row ${workflow.id === selectedWorkflowId ? 'is-active' : ''}`}
                  key={workflow.id}
                  onClick={() => onSelectWorkflow(workflow.id)}
                  type="button"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{workflow.name}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{workflow.notes}</span>
                    </span>
                    <span className="rounded-[4px] bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      {workflow.steps.length}
                    </span>
                  </span>
                  <span className="mt-3 flex gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    <span>{getWorkflowKindLabel(workflow, t)}</span>
                    <span>{workflow.category}</span>
                  </span>
                </button>
              ))}
              {!workflows.length ? (
                <EvidenceCard title={t('workflow.empty.title')} description={t('workflow.empty.description')} />
              ) : null}
            </div>
          </aside>

          <main className="designer-panel designer-detail-stage">
            {selectedWorkflow ? (
              <div className="mx-auto grid max-w-[1280px] gap-5">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card p-5 shadow-sm">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-[4px] bg-primary/10 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                        {selectedWorkflow.category || t('workflow.detail.defaultCategory')}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t('workflow.detail.stepCount', { count: selectedWorkflow.steps.length, browser: runtimeProfile.browser })}
                      </span>
                    </div>
                    <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em]">{selectedWorkflow.name}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      {selectedWorkflow.notes || t('workflow.detail.defaultDescription')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="rounded-[4px]" onClick={() => onAppendStep('ai')} type="button" variant="outline">
                      <Plus className="h-4 w-4" />
                      {t('workflow.action.addStep')}
                    </Button>
                    <Button
                      className="rounded-[4px]"
                      disabled={isRunning || !selectedWorkflow}
                      onClick={onRunWorkflow}
                      type="button"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {isRunning ? t('workflow.action.running') : t('workflow.action.run')}
                    </Button>
                  </div>
                </div>

                <div className="designer-bento-grid">
                  <section className="designer-bento-main">
                    <Surface className="grid gap-4 p-5" variant="plain">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold tracking-[-0.03em]">{t('workflow.config.title')}</h3>
                        <Badge className="rounded-[4px]" variant="outline">
                          {getWorkflowKindLabel(selectedWorkflow, t)}
                        </Badge>
                      </div>
                      <div className="form-grid">
                        <div className="form-field">
                          <Label>{t('workflow.form.name')}</Label>
                          <Input
                            onChange={(event) =>
                              onUpdateWorkflow((workflow) => ({ ...workflow, name: event.target.value }))
                            }
                            value={selectedWorkflow.name}
                          />
                        </div>
                        <div className="form-field is-medium">
                          <Label>{t('workflow.form.category')}</Label>
                          <Input
                            onChange={(event) =>
                              onUpdateWorkflow((workflow) => ({ ...workflow, category: event.target.value }))
                            }
                            value={selectedWorkflow.category}
                          />
                        </div>
                      </div>
                      <div className="form-field">
                        <Label>{t('workflow.form.targetUrl')}</Label>
                        <Input
                          onChange={(event) => onUpdateWorkflow((workflow) => ({ ...workflow, url: event.target.value }))}
                          value={selectedWorkflow.url}
                        />
                      </div>
                      <div className="form-field">
                        <Label>{t('workflow.form.notes')}</Label>
                        <Textarea
                          className="min-h-[80px]"
                          onChange={(event) =>
                            onUpdateWorkflow((workflow) => ({ ...workflow, notes: event.target.value }))
                          }
                          rows={3}
                          value={selectedWorkflow.notes}
                        />
                      </div>
                    </Surface>

                    <div className="flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em]">
                        <Route className="h-5 w-5 text-primary" />
                        {t('workflow.sequence.title')}
                      </h3>
                      <Button className="rounded-[4px]" onClick={() => onAppendStep('ai')} size="sm" type="button" variant="outline">
                        <Plus className="h-4 w-4" />
                        {t('workflow.action.addStep')}
                      </Button>
                    </div>

                    <div className="ml-4 grid gap-4 border-l-2 border-primary/20 pl-5">
                      {selectedWorkflow.steps.map((step, index) => (
                        <article className="designer-flow-step" key={step.id}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                              {t('workflow.sequence.step', {
                                index: String(index + 1).padStart(2, '0'),
                                type: getStepTypeLabel(step.type, t),
                              })}
                            </span>
                            <Button className="rounded-[4px]" onClick={() => onDeleteStep(step.id)} size="sm" type="button" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                              {t('workflow.action.delete')}
                            </Button>
                          </div>
                          <div className="mt-3 step-editor-grid">
                            <Input
                              aria-label={t('workflow.form.stepTitle')}
                              onChange={(event) =>
                                onUpdateWorkflow((workflow) => ({
                                  ...workflow,
                                  steps: workflow.steps.map((item) =>
                                    item.id === step.id ? { ...item, title: event.target.value } : item,
                                  ),
                                }))
                              }
                              value={step.title}
                            />
                            <Select
                              onValueChange={(value) =>
                                onUpdateWorkflow((workflow) => ({
                                  ...workflow,
                                  steps: workflow.steps.map((item) =>
                                    item.id === step.id ? { ...item, type: value as WorkflowStepDraft['type'] } : item,
                                  ),
                                }))
                              }
                              value={step.type}
                            >
                              <SelectTrigger className="rounded-[4px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ai">{t('cases.step.action')}</SelectItem>
                                <SelectItem value="aiAssert">{t('cases.step.assert')}</SelectItem>
                                <SelectItem value="aiQuery">{t('cases.step.query')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Textarea
                            className="step-editor-body mt-3"
                            onChange={(event) =>
                              onUpdateWorkflow((workflow) => ({
                                ...workflow,
                                steps: workflow.steps.map((item) =>
                                  item.id === step.id ? { ...item, body: event.target.value } : item,
                                ),
                              }))
                            }
                            rows={3}
                            value={step.body}
                          />
                          <div className="mt-3 flex flex-wrap gap-3">
                            <Button
                              className="rounded-[4px]"
                              onClick={() => onDuplicateStepType(step.type)}
                              type="button"
                              variant="outline"
                            >
                              {t('workflow.action.duplicateType')}
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <aside className="designer-bento-side">
                    <Surface className="p-5" variant="plain">
                      <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {t('workflow.health.title')}
                      </h4>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <MetricTile label={t('workflow.health.successRate')} value="98%" tone="primary" />
                        <MetricTile label={t('workflow.health.avgDuration')} value="12.4s" />
                      </div>
                    </Surface>

                    <Surface className="overflow-hidden p-0" variant="plain">
                      <div className="border-b border-border bg-muted px-4 py-3">
                        <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          {t('workflow.history.title')}
                        </h4>
                      </div>
                      <div className="grid divide-y divide-border">
                        {[
                          `#1402 · ${t('workflow.history.mainBranch')}`,
                          `#1398 · ${t('workflow.history.mainBranch')}`,
                          runId || `#1382 · ${t('workflow.history.current')}`,
                        ].map((item, index) => (
                          <div className="flex items-center justify-between gap-3 px-4 py-3" key={item}>
                            <div className="flex items-center gap-3">
                              <span className={`h-2 w-2 rounded-full ${index === 2 ? 'bg-destructive' : 'bg-secondary'}`} />
                              <div>
                                <p className="text-sm font-semibold">{item}</p>
                                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                                  {index === 0
                                    ? t('workflow.history.today')
                                    : index === 1
                                      ? t('workflow.history.yesterday')
                                      : t(`common.status.${runStatus}`)}
                                </p>
                              </div>
                            </div>
                            <span className="text-muted-foreground">›</span>
                          </div>
                        ))}
                      </div>
                    </Surface>

                    <Surface className="designer-terminal p-5" variant="plain">
                      <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-2">
                        <Settings2 className="h-4 w-4 text-primary" />
                        <span className="font-mono text-xs text-white/60">environment_context</span>
                      </div>
                      <div className="grid gap-2 font-mono text-xs">
                        <div className="flex justify-between gap-4">
                          <span className="text-white/40">BASE_URL</span>
                          <span className="truncate text-primary">{runtimeProfile.baseUrl || selectedWorkflow.url}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-white/40">BROWSER</span>
                          <span className="text-primary">{runtimeProfile.browser}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-white/40">VIEWPORT</span>
                          <span className="text-primary">{runtimeProfile.viewport}</span>
                        </div>
                      </div>
                    </Surface>

                    <Surface className="p-5" variant="plain">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {t('workflow.observer.title')}
                          </h4>
                          <p className="mt-2 text-sm font-semibold">{runTitle}</p>
                        </div>
                        <StatusPill tone={runStatus} />
                      </div>
                      <div className="mt-4 grid max-h-[180px] gap-2 overflow-y-auto rounded-[8px] bg-muted p-3">
                        {runLogs.map((line) => (
                          <code className="font-mono text-xs leading-5 text-muted-foreground" key={line}>
                            {line}
                          </code>
                        ))}
                      </div>
                    </Surface>

                    <Surface className="grid gap-4 p-5" variant="plain">
                      <div className="flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-primary" />
                        <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          {t('workflow.runtime.title')}
                        </h4>
                      </div>
                      <div className="form-field">
                        <Label>Base URL</Label>
                        <Input
                          onChange={(event) => onUpdateRuntimeProfile({ baseUrl: event.target.value })}
                          value={runtimeProfile.baseUrl}
                        />
                      </div>
                      <div className="form-grid-compact">
                        <div className="form-field">
                          <Label>{t('workflow.runtime.browser')}</Label>
                          <Select
                            onValueChange={(value) =>
                              onUpdateRuntimeProfile({
                                browser: value as RuntimeProfile['browser'],
                              })
                            }
                            value={runtimeProfile.browser}
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
                          <Label>{t('workflow.runtime.viewport')}</Label>
                          <Select
                            onValueChange={(value) =>
                              onUpdateRuntimeProfile({
                                viewport: value as RuntimeProfile['viewport'],
                              })
                            }
                            value={runtimeProfile.viewport}
                          >
                            <SelectTrigger className="rounded-[4px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="desktop">{t('common.viewport.desktop')}</SelectItem>
                              <SelectItem value="laptop">{t('common.viewport.laptop')}</SelectItem>
                              <SelectItem value="mobile">{t('common.viewport.mobile')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </Surface>
                  </aside>
                </div>
              </div>
            ) : (
              <EvidenceCard title={t('workflow.select.title')} description={t('workflow.select.description')} />
            )}
          </main>
        </section>

      </PageBody>
    </PageShell>
  );
}
