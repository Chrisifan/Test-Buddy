import type {
  BrowserSessionState,
  ProjectEnvironment,
  ProjectDraft,
  ProjectGroup,
  RunTone,
  TestCaseDraft,
  TestStepDraft,
} from '../../../shared/studio.js';

import { Layers3, Plus, Play, Route, Trash2 } from 'lucide-react';

import { StatusPill } from '../../components/StatusPill.js';
import { BrowserSessionPanel } from '../../components/BrowserSessionPanel.js';
import { ActionListItem, EvidenceCard, MetricTile, PageHeader, Surface, PageBody, PageShell } from '../../components/workbench.js';
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
  const groupCases = project?.testCases.filter((testCase) => testCase.groupId === selectedGroup?.id) ?? [];
  const selectedCaseEnvironment = project?.environments.find(
    (environment) => environment.id === selectedTestCase?.environmentId,
  );

  if (!project) {
    return (
      <PageShell>
        <PageHeader
          description={t('cases.header.emptyDescription')}
          eyebrow={t('cases.header.eyebrow')}
          title={t('cases.header.title')}
        />
        <PageBody>
        <EvidenceCard
          title={t('cases.empty.noProject')}
          description={t('cases.empty.noProjectDescription')}
        />
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
        description={t('cases.header.description')}
        eyebrow={t('cases.header.eyebrow')}
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

        <section className="designer-panel is-muted flex flex-col">
          <div className="designer-panel-header flex items-start justify-between gap-4 bg-card">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-xl font-semibold tracking-[-0.03em]">
                  {selectedTestCase?.name ?? t('cases.select.title')}
                </h2>
                {selectedTestCase ? <Badge variant="outline">{selectedTestCase.source}</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedTestCase?.notes || t('cases.select.description')}
              </p>
            </div>
            <Button disabled={!selectedTestCase || isRunning} onClick={onRunTestCase} type="button">
              <Play className="h-4 w-4" />
              {isRunning ? t('cases.action.running') : t('cases.action.run')}
            </Button>
          </div>

          {selectedTestCase ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-3 border-b border-border bg-card p-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t('cases.form.name')}</Label>
                  <Input
                    onChange={(event) => onUpdateTestCase((testCase) => ({ ...testCase, name: event.target.value }))}
                    value={selectedTestCase.name}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t('cases.form.targetUrl')}</Label>
                  <Input
                    onChange={(event) => onUpdateTestCase((testCase) => ({ ...testCase, url: event.target.value }))}
                    value={selectedTestCase.url}
                  />
                </div>
              </div>

              <div className="designer-step-timeline">
                {selectedTestCase.steps.map((step, index) => (
                  <CaseStepEditor
                    index={index}
                    key={step.id}
                    onDeleteStep={onDeleteStep}
                    onUpdateTestCase={onUpdateTestCase}
                    project={project}
                    step={step}
                  />
                ))}
                <div className="ml-12 flex flex-wrap gap-2 rounded-[8px] border-2 border-dashed border-border bg-card p-4">
                  <Button onClick={() => onAppendStep('ai')} type="button" variant="outline">{t('cases.add.action')}</Button>
                  <Button onClick={() => onAppendStep('aiAssert')} type="button" variant="outline">{t('cases.add.assert')}</Button>
                  <Button onClick={() => onAppendStep('aiQuery')} type="button" variant="outline">{t('cases.add.query')}</Button>
                  <Button onClick={() => onAppendStep('recordingReplay')} type="button" variant="outline">{t('cases.add.replay')}</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <EvidenceCard title={t('cases.select.emptyTitle')} description={t('cases.select.emptyDescription')} />
            </div>
          )}
        </section>

        <aside className="designer-panel flex flex-col">
          <div className="flex border-b border-border">
            <span className="flex-1 border-b-2 border-primary py-4 text-center text-[11px] font-bold uppercase text-primary">
              {t('cases.tab.settings')}
            </span>
            <span className="flex-1 py-4 text-center text-[11px] font-medium uppercase text-muted-foreground">
              {t('cases.tab.preview')}
            </span>
          </div>
          <div className="designer-panel-body grid gap-4">
            <div className="grid gap-2">
              <Label>{t('cases.form.group')}</Label>
              {selectedTestCase ? (
                <Select
                  onValueChange={(value) => onUpdateTestCase((testCase) => ({ ...testCase, groupId: value }))}
                  value={selectedTestCase.groupId}
                >
                  <SelectTrigger className="rounded-[4px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {project.groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label>{t('cases.form.environment')}</Label>
              {selectedTestCase ? (
                <Select
                  onValueChange={(value) => onUpdateTestCase((testCase) => ({ ...testCase, environmentId: value }))}
                  value={selectedTestCase.environmentId}
                >
                  <SelectTrigger className="rounded-[4px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {project.environments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <div className="rounded-[4px] bg-muted p-3">
              <p className="text-sm font-semibold">{t('cases.status.title')}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('cases.status.run')}</span>
                <StatusPill tone={runStatus} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('cases.status.environment')}</span>
                <span className="text-xs font-medium">{selectedCaseEnvironment?.name ?? '-'}</span>
              </div>
            </div>
          </div>
          <div className="mt-auto border-t border-border p-3">
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
        </aside>
      </section>
      </PageBody>
    </PageShell>
  );
}

function CaseStepEditor({
  index,
  project,
  step,
  onDeleteStep,
  onUpdateTestCase,
}: {
  index: number;
  project: ProjectDraft;
  step: TestStepDraft;
  onDeleteStep: (stepId: string) => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft) => void;
}) {
  const { t } = useI18n();
  const boundRecording = project.recordings.find((recording) => recording.id === step.recordingId);
  const boundGroup = project.groups.find((group) => group.id === boundRecording?.groupId);
  const boundEnvironment = project.environments.find((environment) => environment.id === boundRecording?.environmentId);

  function updateStep(patch: Partial<TestStepDraft>) {
    onUpdateTestCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((item) => (item.id === step.id ? { ...item, ...patch } : item)),
    }));
  }

  function bindRecording(recordingId: string) {
    const recording = project.recordings.find((item) => item.id === recordingId);
    updateStep({
      recordingId,
      body: recording
        ? t('cases.replay.description', { name: recording.name, count: recording.steps.length })
        : step.body,
    });
  }

  return (
    <article className="designer-step">
      <div className="designer-step-index">
        {String(index + 1).padStart(2, '0')}
      </div>
      <div className="designer-step-card grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-primary">
            <Route className="h-3.5 w-3.5 text-primary" />
            {getStepTypeLabel(step.type, t)}
          </div>
          <Button onClick={() => onDeleteStep(step.id)} size="sm" type="button" variant="ghost">
            <Trash2 className="h-4 w-4" />
            {t('cases.step.delete')}
          </Button>
        </div>
        <div className="step-editor-grid">
          <Input
            aria-label={t('cases.step.title')}
            onChange={(event) => updateStep({ title: event.target.value })}
            value={step.title}
          />
          <Select
            onValueChange={(value) =>
              updateStep({
                type: value as TestStepDraft['type'],
                recordingId: value === 'recordingReplay' ? step.recordingId : undefined,
              })
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
              <SelectItem value="recordingReplay">{t('cases.step.replay')}</SelectItem>
              <SelectItem value="manual">{t('cases.step.manual')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {step.type === 'recordingReplay' ? (
          <div className="replay-binding-panel">
            <div className="grid gap-2 sm:max-w-[520px]">
              <Label>{t('cases.replay.bind')}</Label>
              {project.recordings.length ? (
                <Select onValueChange={bindRecording} value={step.recordingId ?? project.recordings[0].id}>
                  <SelectTrigger className="rounded-[4px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {project.recordings.map((recording) => (
                      <SelectItem key={recording.id} value={recording.id}>
                        {recording.name} · {t('cases.replay.nodeCount', { count: recording.steps.length })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-[4px] bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  {t('cases.replay.noAssets')}
                </p>
              )}
            </div>
            {boundRecording ? (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{t('cases.replay.nodeCount', { count: boundRecording.steps.length })}</Badge>
                <Badge variant="outline">{boundGroup?.name ?? t('cases.replay.ungrouped')}</Badge>
                <Badge variant="outline">{boundEnvironment?.name ?? t('cases.replay.noEnvironment')}</Badge>
                <span className="basis-full leading-6">{boundRecording.summary || boundRecording.comparisonGoal}</span>
              </div>
            ) : project.recordings.length ? (
              <p className="rounded-[4px] bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t('cases.replay.missingBinding')}
              </p>
            ) : null}
          </div>
        ) : null}

        <Textarea
          className="step-editor-body"
          onChange={(event) => updateStep({ body: event.target.value })}
          value={step.body}
        />
      </div>
    </article>
  );
}
