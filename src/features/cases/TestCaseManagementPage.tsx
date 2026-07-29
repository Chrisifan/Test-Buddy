import type {
  BrowserSessionState,
  ProjectEnvironment,
  ProjectDraft,
  ProjectGroup,
  RunTone,
  TestCaseDraft,
  TestStepDraft,
} from '../../../shared/studio.js';

import { useEffect, useState, type DragEvent } from 'react';
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  GripVertical,
  Layers3,
  MousePointer2,
  Play,
  Plus,
  Repeat2,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { StatusPill } from '../../components/StatusPill.js';
import { BrowserSessionPanel } from '../../components/BrowserSessionPanel.js';
import { EvidenceCard, PageBody, PageHeader, PageShell } from '../../components/workbench.js';
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

function getStepTypeLabel(type: TestStepDraft['type'], t: (key: string) => string): string {
  const keys: Record<TestStepDraft['type'], string> = {
    ai: 'cases.step.action',
    aiAssert: 'cases.step.assert',
    aiQuery: 'cases.step.query',
    recordingReplay: 'cases.step.replay',
    manual: 'cases.step.manual',
  };
  return t(keys[type]);
}

function StepTypeIcon({ type, className }: { type: TestStepDraft['type']; className?: string }) {
  const Icon =
    type === 'ai'
      ? MousePointer2
      : type === 'aiAssert'
        ? ShieldCheck
        : type === 'aiQuery'
          ? ScanSearch
          : type === 'recordingReplay'
            ? Repeat2
            : ClipboardCheck;

  return <Icon className={className} />;
}

function updateStepDraft(
  stepId: string,
  patch: Partial<TestStepDraft>,
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft) => void,
) {
  onUpdateTestCase((testCase) => ({
    ...testCase,
    steps: testCase.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
  }));
}

export function TestCaseManagementPage({
  project,
  selectedGroup,
  selectedTestCase,
  selectedTestCaseId,
  runStatus,
  isRunning,
  browserSession,
  selectedEnvironment,
  navigateUrl,
  isBrowserBusy,
  onSelectGroup,
  onSelectTestCase,
  onCreateTestCase,
  onAppendStep,
  onDeleteStep,
  onRunTestCase,
  onUpdateTestCase,
  onChangeNavigateUrl,
  onStartBrowserSession,
  onNavigateBrowser,
  onCaptureBrowser,
}: {
  project?: ProjectDraft;
  selectedGroup?: ProjectGroup;
  selectedTestCase?: TestCaseDraft;
  selectedTestCaseId: string;
  runStatus: RunTone;
  isRunning: boolean;
  browserSession: BrowserSessionState;
  selectedEnvironment?: ProjectEnvironment;
  navigateUrl: string;
  isBrowserBusy: boolean;
  onSelectGroup: (groupId: string) => void;
  onSelectTestCase: (testCaseId: string) => void;
  onCreateTestCase: () => void;
  onAppendStep: (type?: TestStepDraft['type']) => void;
  onDeleteStep: (stepId: string) => void;
  onRunTestCase: () => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft) => void;
  onChangeNavigateUrl: (value: string) => void;
  onStartBrowserSession: () => void;
  onNavigateBrowser: () => void;
  onCaptureBrowser: () => void;
}) {
  const { t } = useI18n();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [draggedStepId, setDraggedStepId] = useState<string>();
  const groupCases = project?.testCases.filter((testCase) => testCase.groupId === selectedGroup?.id) ?? [];
  const selectedCaseEnvironment = project?.environments.find(
    (environment) => environment.id === selectedTestCase?.environmentId,
  );
  const selectedStep = selectedTestCase?.steps.find((step) => step.id === selectedStepId);

  useEffect(() => {
    if (selectedStepId && !selectedTestCase?.steps.some((step) => step.id === selectedStepId)) {
      setSelectedStepId(undefined);
    }
  }, [selectedStepId, selectedTestCase?.id, selectedTestCase?.steps]);

  function reorderSteps(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      return;
    }

    onUpdateTestCase((testCase) => {
      const sourceIndex = testCase.steps.findIndex((step) => step.id === sourceId);
      const targetIndex = testCase.steps.findIndex((step) => step.id === targetId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return testCase;
      }

      const nextSteps = [...testCase.steps];
      const [source] = nextSteps.splice(sourceIndex, 1);
      const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      nextSteps.splice(insertionIndex, 0, source);
      return { ...testCase, steps: nextSteps };
    });
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/testbuddy-step') || draggedStepId;
    if (sourceId) {
      reorderSteps(sourceId, targetId);
    }
    setDraggedStepId(undefined);
  }

  if (!project) {
    return (
      <PageShell>
        <PageHeader title={t('cases.header.title')} />
        <PageBody>
          <EvidenceCard title={t('cases.empty.noProject')} description={t('cases.empty.noProjectDescription')} />
        </PageBody>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        action={
          <Button className="rounded-[4px] px-4" onClick={onCreateTestCase} type="button">
            <Plus className="h-4 w-4" />
            {t('cases.action.create')}
          </Button>
        }
        meta={[
          t('cases.meta.project', { name: project.name }),
          t('cases.meta.group', { name: selectedGroup?.name ?? t('cases.meta.notSelected') }),
          t('cases.meta.groupCases', { count: groupCases.length }),
        ].map((item) => (
          <Badge className="rounded-[4px] px-3 py-1.5" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('cases.header.title')}
      />

      <PageBody>
        <section className="designer-split case-workbench" aria-label={t('cases.aria.workbench')}>
          <aside className="designer-panel">
            <div className="designer-panel-header">
              <div className="designer-library-search">
                <Layers3 className="h-4 w-4" />
                <span className="text-sm">{t('cases.search')}</span>
              </div>
            </div>
            <div className="designer-panel-body">
              {project.groups.map((group) => {
                const cases = project.testCases.filter((testCase) => testCase.groupId === group.id);

                return (
                  <details className="group mb-2" key={group.id} open={group.id === selectedGroup?.id}>
                    <summary
                      className="flex cursor-pointer list-none items-center gap-2 rounded-[4px] p-2 text-sm font-semibold transition hover:bg-accent"
                      onClick={(event) => {
                        event.preventDefault();
                        onSelectGroup(group.id);
                      }}
                    >
                      <Layers3 className="h-4 w-4 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{group.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{cases.length}</span>
                    </summary>
                    <div className="ml-4 mt-1 grid gap-1 border-l border-border pl-2">
                      {cases.map((testCase) => (
                        <button
                          className={`designer-case-row ${testCase.id === selectedTestCaseId ? 'is-active' : ''}`}
                          key={testCase.id}
                          onClick={() => onSelectTestCase(testCase.id)}
                          type="button"
                        >
                          <span className="block truncate text-sm font-medium">{testCase.name}</span>
                          <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                            {testCase.source} · {t('cases.steps.count', { count: testCase.steps.length })}
                          </span>
                        </button>
                      ))}
                      {!cases.length ? (
                        <button className="designer-case-row text-muted-foreground" onClick={onCreateTestCase} type="button">
                          {t('cases.group.createCase')}
                        </button>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </aside>

          <section className="designer-panel is-muted case-canvas-panel flex min-w-0 flex-col">
            <div className="designer-panel-header case-canvas-header flex items-center justify-between gap-4 bg-card">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {selectedTestCase?.name ?? t('cases.select.title')}
                  </h2>
                  {selectedTestCase ? <Badge className="case-source-tag" variant="outline">{selectedTestCase.source}</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('cases.canvas.sequence')}</p>
              </div>
              <Button disabled={!selectedTestCase || isRunning} onClick={onRunTestCase} type="button">
                <Play className="h-4 w-4" />
                {isRunning ? t('cases.action.running') : t('cases.action.run')}
              </Button>
            </div>

            {selectedTestCase ? (
              <div className="case-canvas-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="case-canvas" role="list" aria-label={t('cases.canvas.aria')}>
                  <div className="case-flow-terminal case-flow-start">
                    <Bot className="h-4 w-4" />
                    <span>{t('cases.canvas.start')}</span>
                  </div>

                  {selectedTestCase.steps.map((step, index) => (
                    <CaseFlowNode
                      dragActive={draggedStepId === step.id}
                      index={index}
                      key={step.id}
                      onDragEnd={() => setDraggedStepId(undefined)}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/testbuddy-step', step.id);
                        setDraggedStepId(step.id);
                      }}
                      onDrop={handleDrop}
                      onSelect={() => setSelectedStepId(step.id)}
                      selected={selectedStepId === step.id}
                      step={step}
                      t={t}
                    />
                  ))}

                  <div className="case-add-step" aria-label={t('cases.canvas.addStep')}>
                    <span className="case-flow-line" aria-hidden="true" />
                    <div className="case-add-step-actions">
                      <Button aria-label={t('cases.add.action')} onClick={() => onAppendStep('ai')} size="icon" title={t('cases.add.action')} type="button" variant="outline">
                        <MousePointer2 className="h-4 w-4" />
                      </Button>
                      <Button aria-label={t('cases.add.assert')} onClick={() => onAppendStep('aiAssert')} size="icon" title={t('cases.add.assert')} type="button" variant="outline">
                        <ShieldCheck className="h-4 w-4" />
                      </Button>
                      <Button aria-label={t('cases.add.query')} onClick={() => onAppendStep('aiQuery')} size="icon" title={t('cases.add.query')} type="button" variant="outline">
                        <ScanSearch className="h-4 w-4" />
                      </Button>
                      <Button aria-label={t('cases.add.replay')} onClick={() => onAppendStep('recordingReplay')} size="icon" title={t('cases.add.replay')} type="button" variant="outline">
                        <Repeat2 className="h-4 w-4" />
                      </Button>
                      <Button aria-label={t('cases.add.manual')} onClick={() => onAppendStep('manual')} size="icon" title={t('cases.add.manual')} type="button" variant="outline">
                        <ClipboardCheck className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="case-flow-terminal case-flow-end">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{t('cases.canvas.end')}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <EvidenceCard title={t('cases.select.emptyTitle')} description={t('cases.select.emptyDescription')} />
              </div>
            )}
          </section>

          <aside className="designer-panel case-inspector-panel flex min-w-0 flex-col">
            <div className="case-inspector-header">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {selectedStep ? t('cases.inspector.step') : t('cases.inspector.case')}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selectedStep ? t('cases.inspector.stepHint') : t('cases.inspector.caseHint')}
                </p>
              </div>
              {selectedStep ? <Badge className="rounded-[4px]" variant="outline">{getStepTypeLabel(selectedStep.type, t)}</Badge> : null}
            </div>

            <div className="designer-panel-body case-inspector-body">
              {selectedTestCase ? (
                selectedStep ? (
                  <StepInspector
                    onDelete={() => {
                      setSelectedStepId(undefined);
                      onDeleteStep(selectedStep.id);
                    }}
                    onUpdateTestCase={onUpdateTestCase}
                    project={project}
                    step={selectedStep}
                  />
                ) : (
                  <CaseInspector
                    environment={selectedCaseEnvironment}
                    onUpdateTestCase={onUpdateTestCase}
                    project={project}
                    runStatus={runStatus}
                    testCase={selectedTestCase}
                  />
                )
              ) : (
                <EvidenceCard title={t('cases.select.emptyTitle')} description={t('cases.select.emptyDescription')} />
              )}
            </div>

            {selectedTestCase ? (
              <details className="case-browser-session">
                <summary>{t('cases.inspector.browser')}</summary>
                <div className="border-t border-border p-3">
                  <BrowserSessionPanel
                    environment={selectedEnvironment}
                    isBusy={isBrowserBusy}
                    navigateUrl={navigateUrl}
                    onCapture={onCaptureBrowser}
                    onChangeNavigateUrl={onChangeNavigateUrl}
                    onNavigate={onNavigateBrowser}
                    onStartSession={onStartBrowserSession}
                    project={project}
                    session={browserSession}
                  />
                </div>
              </details>
            ) : null}
          </aside>
        </section>
      </PageBody>
    </PageShell>
  );
}

function CaseFlowNode({
  dragActive,
  index,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
  selected,
  step,
  t,
}: {
  dragActive: boolean;
  index: number;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>, targetId: string) => void;
  onSelect: () => void;
  selected: boolean;
  step: TestStepDraft;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const stepSummary = step.type === 'recordingReplay'
    ? step.recordingId
      ? t('cases.canvas.replayBound')
      : t('cases.canvas.replayMissing')
    : step.body;

  return (
    <div className="case-flow-node-wrap" role="listitem">
      <span className="case-flow-line" aria-hidden="true" />
      <article
        aria-label={t('cases.canvas.stepNode', { index: index + 1, title: step.title })}
        className={`case-flow-node ${selected ? 'is-selected' : ''} ${dragActive ? 'is-dragging' : ''}`}
        draggable
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        onDrop={(event) => onDrop(event, step.id)}
      >
        <button className="case-flow-node-select" onClick={onSelect} type="button">
          <span className="case-flow-node-order">{String(index + 1).padStart(2, '0')}</span>
          <span className="case-flow-node-icon"><StepTypeIcon className="h-4 w-4" type={step.type} /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-semibold text-foreground">{step.title}</span>
            <span className="mt-1 block truncate text-xs leading-4 text-muted-foreground">{stepSummary || t('cases.canvas.emptyStep')}</span>
          </span>
          {step.type === 'recordingReplay' && !step.recordingId ? <span className="case-node-warning" aria-label={t('cases.canvas.replayMissing')}>!</span> : null}
        </button>
        <span aria-label={t('cases.canvas.dragStep')} className="case-flow-node-drag" title={t('cases.canvas.dragStep')}>
          <GripVertical className="h-4 w-4" />
        </span>
      </article>
    </div>
  );
}

function CaseInspector({
  environment,
  onUpdateTestCase,
  project,
  runStatus,
  testCase,
}: {
  environment?: ProjectEnvironment;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft) => void;
  project: ProjectDraft;
  runStatus: RunTone;
  testCase: TestCaseDraft;
}) {
  const { t } = useI18n();

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>{t('cases.form.name')}</Label>
        <Input onChange={(event) => onUpdateTestCase((item) => ({ ...item, name: event.target.value }))} value={testCase.name} />
      </div>
      <div className="grid gap-2">
        <Label>{t('cases.form.targetUrl')}</Label>
        <Input onChange={(event) => onUpdateTestCase((item) => ({ ...item, url: event.target.value }))} value={testCase.url} />
      </div>
      <div className="grid gap-2">
        <Label>{t('cases.form.group')}</Label>
        <Select onValueChange={(value) => onUpdateTestCase((item) => ({ ...item, groupId: value }))} value={testCase.groupId}>
          <SelectTrigger className="rounded-[4px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {project.groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>{t('cases.form.environment')}</Label>
        <Select onValueChange={(value) => onUpdateTestCase((item) => ({ ...item, environmentId: value }))} value={testCase.environmentId}>
          <SelectTrigger className="rounded-[4px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {project.environments.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>{t('cases.form.notes')}</Label>
        <Textarea className="min-h-24" onChange={(event) => onUpdateTestCase((item) => ({ ...item, notes: event.target.value }))} value={testCase.notes} />
      </div>
      <div className="case-status-summary">
        <div className="flex items-center justify-between gap-3">
          <span>{t('cases.status.run')}</span>
          <StatusPill tone={runStatus} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span>{t('cases.status.environment')}</span>
          <span className="truncate font-medium text-foreground">{environment?.name ?? '-'}</span>
        </div>
      </div>
    </div>
  );
}

function StepInspector({
  onDelete,
  onUpdateTestCase,
  project,
  step,
}: {
  onDelete: () => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft) => void;
  project: ProjectDraft;
  step: TestStepDraft;
}) {
  const { t } = useI18n();
  const boundRecording = project.recordings.find((recording) => recording.id === step.recordingId);
  const boundGroup = project.groups.find((group) => group.id === boundRecording?.groupId);
  const boundEnvironment = project.environments.find((environment) => environment.id === boundRecording?.environmentId);

  function updateStep(patch: Partial<TestStepDraft>) {
    updateStepDraft(step.id, patch, onUpdateTestCase);
  }

  function bindRecording(recordingId: string) {
    const recording = project.recordings.find((item) => item.id === recordingId);
    updateStep({
      recordingId,
      body: recording ? t('cases.replay.description', { name: recording.name, count: recording.steps.length }) : step.body,
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>{t('cases.step.title')}</Label>
        <Input onChange={(event) => updateStep({ title: event.target.value })} value={step.title} />
      </div>
      <div className="grid gap-2">
        <Label>{t('cases.inspector.stepType')}</Label>
        <Select
          onValueChange={(value) => updateStep({
            type: value as TestStepDraft['type'],
            recordingId: value === 'recordingReplay' ? step.recordingId : undefined,
          })}
          value={step.type}
        >
          <SelectTrigger className="rounded-[4px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ai">{t('cases.step.action')}</SelectItem>
            <SelectItem value="aiAssert">{t('cases.step.assert')}</SelectItem>
            <SelectItem value="aiQuery">{t('cases.step.query')}</SelectItem>
            <SelectItem value="recordingReplay">{t('cases.step.replay')}</SelectItem>
            <SelectItem value="manual">{t('cases.step.manual')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {step.type === 'recordingReplay' ? (
        <div className="replay-binding-panel">
          <div className="grid gap-2">
            <Label>{t('cases.replay.bind')}</Label>
            {project.recordings.length ? (
              <Select onValueChange={bindRecording} value={step.recordingId ?? ''}>
                <SelectTrigger className="rounded-[4px]"><SelectValue placeholder={t('cases.replay.choose')} /></SelectTrigger>
                <SelectContent>
                  {project.recordings.map((recording) => (
                    <SelectItem key={recording.id} value={recording.id}>
                      {recording.name} · {t('cases.replay.nodeCount', { count: recording.steps.length })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : <p className="text-sm leading-6 text-muted-foreground">{t('cases.replay.noAssets')}</p>}
          </div>
          {boundRecording ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{t('cases.replay.nodeCount', { count: boundRecording.steps.length })}</Badge>
              <Badge variant="outline">{boundGroup?.name ?? t('cases.replay.ungrouped')}</Badge>
              <Badge variant="outline">{boundEnvironment?.name ?? t('cases.replay.noEnvironment')}</Badge>
              <span className="basis-full leading-5">{boundRecording.summary || boundRecording.comparisonGoal}</span>
            </div>
          ) : project.recordings.length ? <p className="text-sm leading-6 text-destructive">{t('cases.replay.missingBinding')}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label>{t('cases.inspector.instruction')}</Label>
        <Textarea className="min-h-36" onChange={(event) => updateStep({ body: event.target.value })} value={step.body} />
      </div>
      <Button className="justify-start text-destructive hover:text-destructive" onClick={onDelete} type="button" variant="ghost">
        <Trash2 className="h-4 w-4" />
        {t('cases.step.delete')}
      </Button>
    </div>
  );
}
