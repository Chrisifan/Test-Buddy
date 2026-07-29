import type {
  RuntimeProfile,
  RunTone,
  WorkflowDraft,
  WorkflowStepDraft,
} from '../../../shared/studio.js';

import { PlayCircle, Plus, Settings2, Trash2 } from 'lucide-react';

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
        title={t('workflow.header.title')}
      />

      <PageBody>
        <section className="workflow-studio" aria-label={t('workflow.header.title')}>
          <main className="workflow-editor">
            {selectedWorkflow ? (
              <>
                <header className="workflow-editor-header">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="rounded-[4px]" variant="outline">
                        {selectedWorkflow.category || t('workflow.detail.defaultCategory')}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t('workflow.detail.stepCount', { count: selectedWorkflow.steps.length, browser: runtimeProfile.browser })}
                      </span>
                    </div>
                    <h2>{selectedWorkflow.name}</h2>
                    <p>{selectedWorkflow.notes || t('workflow.detail.defaultDescription')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => onAppendStep('ai')} size="sm" type="button" variant="outline">
                      <Plus className="h-4 w-4" />
                      {t('workflow.action.addStep')}
                    </Button>
                    <Button disabled={isRunning} onClick={onRunWorkflow} size="sm" type="button">
                      <PlayCircle className="h-4 w-4" />
                      {isRunning ? t('workflow.action.running') : t('workflow.action.run')}
                    </Button>
                  </div>
                </header>

                <details className="workflow-config-disclosure">
                  <summary>
                    <Settings2 className="h-4 w-4" />
                    {t('workflow.config.title')}
                  </summary>
                  <div className="workflow-config-fields">
                    <div className="form-field">
                      <Label>{t('workflow.form.name')}</Label>
                      <Input
                        onChange={(event) => onUpdateWorkflow((workflow) => ({ ...workflow, name: event.target.value }))}
                        value={selectedWorkflow.name}
                      />
                    </div>
                    <div className="form-field">
                      <Label>{t('workflow.form.category')}</Label>
                      <Input
                        onChange={(event) => onUpdateWorkflow((workflow) => ({ ...workflow, category: event.target.value }))}
                        value={selectedWorkflow.category}
                      />
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
                        className="min-h-[72px]"
                        onChange={(event) => onUpdateWorkflow((workflow) => ({ ...workflow, notes: event.target.value }))}
                        value={selectedWorkflow.notes}
                      />
                    </div>
                  </div>
                </details>

                <section className="workflow-timeline" aria-label={t('workflow.sequence.title')}>
                  {selectedWorkflow.steps.map((step, index) => (
                    <article className="workflow-step-card" key={step.id}>
                      <span className="workflow-step-node">{String(index + 1).padStart(2, '0')}</span>
                      <div className="workflow-step-content">
                        <div className="workflow-step-heading">
                          <div className="min-w-0">
                            <p>{t('workflow.sequence.step', { index: String(index + 1).padStart(2, '0'), type: getStepTypeLabel(step.type, t) })}</p>
                            <Input
                              aria-label={t('workflow.form.stepTitle')}
                              className="workflow-step-title"
                              onChange={(event) =>
                                onUpdateWorkflow((workflow) => ({
                                  ...workflow,
                                  steps: workflow.steps.map((item) => item.id === step.id ? { ...item, title: event.target.value } : item),
                                }))
                              }
                              value={step.title}
                            />
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Select
                              onValueChange={(value) =>
                                onUpdateWorkflow((workflow) => ({
                                  ...workflow,
                                  steps: workflow.steps.map((item) => item.id === step.id ? { ...item, type: value as WorkflowStepDraft['type'] } : item),
                                }))
                              }
                              value={step.type}
                            >
                              <SelectTrigger className="h-8 w-[110px] rounded-[4px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ai">{t('cases.step.action')}</SelectItem>
                                <SelectItem value="aiAssert">{t('cases.step.assert')}</SelectItem>
                                <SelectItem value="aiQuery">{t('cases.step.query')}</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button aria-label={t('workflow.action.delete')} onClick={() => onDeleteStep(step.id)} size="icon" type="button" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          className="workflow-step-body"
                          onChange={(event) =>
                            onUpdateWorkflow((workflow) => ({
                              ...workflow,
                              steps: workflow.steps.map((item) => item.id === step.id ? { ...item, body: event.target.value } : item),
                            }))
                          }
                          rows={2}
                          value={step.body}
                        />
                        <Button onClick={() => onDuplicateStepType(step.type)} size="sm" type="button" variant="ghost">
                          {t('workflow.action.duplicateType')}
                        </Button>
                      </div>
                    </article>
                  ))}
                  <Button className="workflow-add-step" onClick={() => onAppendStep('ai')} size="sm" type="button" variant="outline">
                    <Plus className="h-4 w-4" />
                    {t('workflow.action.addStep')}
                  </Button>
                </section>
              </>
            ) : (
              <EvidenceCard title={t('workflow.select.title')} description={t('workflow.select.description')} />
            )}
          </main>

          <aside className="workflow-sidebar">
            <section className="workflow-library">
              <div className="workflow-library-header">
                <div>
                  <p>{t('workflow.library.eyebrow')}</p>
                  <h2>{t('workflow.library.title')}</h2>
                </div>
                <Button onClick={onCreateWorkflow} size="icon" type="button" variant="outline">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="workflow-library-list">
                {workflows.map((workflow) => (
                  <button
                    className={`workflow-library-item ${workflow.id === selectedWorkflowId ? 'is-active' : ''}`}
                    key={workflow.id}
                    onClick={() => onSelectWorkflow(workflow.id)}
                    type="button"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <strong>{workflow.name}</strong>
                        <small>{workflow.notes || t('workflow.detail.defaultDescription')}</small>
                      </span>
                      <Badge className="rounded-[4px]" variant="outline">{workflow.steps.length}</Badge>
                    </span>
                    <span className="workflow-library-item-meta">
                      {getWorkflowKindLabel(workflow, t)} · {workflow.category || t('workflow.detail.defaultCategory')}
                    </span>
                  </button>
                ))}
                {!workflows.length ? <EvidenceCard title={t('workflow.empty.title')} description={t('workflow.empty.description')} /> : null}
              </div>
            </section>

            <Surface className="workflow-runtime-card" variant="plain">
              <div className="flex items-center justify-between gap-3">
                <h3>{t('workflow.runtime.title')}</h3>
                <StatusPill tone={runStatus} />
              </div>
              <div className="workflow-runtime-metrics">
                <MetricTile label={t('workflow.health.currentStatus')} tone={runStatus === 'passed' ? 'passed' : runStatus === 'failed' ? 'failed' : runStatus === 'running' ? 'running' : 'neutral'} value={t(`common.status.${runStatus}`)} />
                <MetricTile label={t('workflow.health.logCount')} value={`${runLogs.length}`} />
              </div>
              <div className="workflow-runtime-grid">
                <div className="form-field">
                  <Label>Base URL</Label>
                  <Input onChange={(event) => onUpdateRuntimeProfile({ baseUrl: event.target.value })} value={runtimeProfile.baseUrl} />
                </div>
                <div className="form-field">
                  <Label>{t('workflow.runtime.browser')}</Label>
                  <Select onValueChange={(value) => onUpdateRuntimeProfile({ browser: value as RuntimeProfile['browser'] })} value={runtimeProfile.browser}>
                    <SelectTrigger className="rounded-[4px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chromium">Chromium</SelectItem>
                      <SelectItem value="firefox">Firefox</SelectItem>
                      <SelectItem value="webkit">WebKit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {runTitle || runLogs.length ? (
                <div className="workflow-log-panel">
                  <p>{runTitle || t('workflow.observer.title')}</p>
                  {runLogs.slice(-3).map((line) => <code key={line}>{line}</code>)}
                </div>
              ) : null}
            </Surface>
          </aside>
        </section>
      </PageBody>
    </PageShell>
  );
}
