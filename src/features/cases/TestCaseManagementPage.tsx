import type {
  ProjectDraft,
  RunTone,
  TestCaseDraft,
  TestCaseRunBlocker,
  TestStepDraft,
} from '../../../shared/studio.js';

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Copy,
  Flag,
  GripVertical,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  ScanSearch,
  Settings2,
  ShieldCheck,
  WandSparkles,
  Trash2,
} from 'lucide-react';

import { createManualStepAutomationReplacement, getTestStepRunBlocker } from '../../../shared/studio.js';
import { StatusPill } from '../../components/StatusPill.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { EvidenceCard, PageBody, PageHeader, PageShell, ProjectRequiredState } from '../../components/workbench.js';
import { useI18n } from '../../i18n/index.js';

type SaveMode = 'debounced' | 'immediate';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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

function getSourceLabel(testCase: TestCaseDraft, t: (key: string) => string): string {
  return t(`cases.source.${testCase.source}`);
}

function getBlockerLabel(blocker: TestCaseRunBlocker | undefined, t: (key: string) => string): string | undefined {
  return blocker ? t(`cases.validation.${blocker}`) : undefined;
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

function StepTypeMenu({
  index,
  onCreate,
  trigger,
}: {
  index: number;
  onCreate: (type: TestStepDraft['type'], index: number) => void;
  trigger: ReactNode;
}) {
  const { t } = useI18n();
  const options: Array<{ type: TestStepDraft['type']; label: string }> = [
    { type: 'ai', label: t('cases.step.action') },
    { type: 'aiAssert', label: t('cases.step.assert') },
    { type: 'aiQuery', label: t('cases.step.query') },
    { type: 'recordingReplay', label: t('cases.step.replay') },
    { type: 'manual', label: t('cases.step.manual') },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
        {options.map((option) => (
          <DropdownMenuItem key={option.type} onSelect={() => onCreate(option.type, index)}>
            <StepTypeIcon className="size-4 text-primary" type={option.type} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FlowTerminal({ terminal }: { terminal: 'start' | 'end' }) {
  const { t } = useI18n();
  const isStart = terminal === 'start';

  return (
    <div
      className={`case-flow-terminal case-flow-terminal-${terminal}`}
      data-flow-terminal={terminal}
    >
      {isStart ? <Play className="size-3.5" /> : <Flag className="size-3.5" />}
      <span>{t(`cases.canvas.${terminal}`)}</span>
    </div>
  );
}

function FlowInsertionPoint({
  dropActive,
  index,
  isEmptyFlow = false,
  onCreate,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  dropActive: boolean;
  index: number;
  isEmptyFlow?: boolean;
  onCreate: (type: TestStepDraft['type'], index: number) => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: (event: DragEvent<HTMLButtonElement>, index: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="case-flow-connector">
      <StepTypeMenu
        index={index}
        onCreate={onCreate}
        trigger={
          <button
            aria-label={t('cases.aria.insertBefore', { index: index + 1 })}
            className="case-insertion-zone"
            data-drop-target={dropActive}
            data-empty-flow={isEmptyFlow}
            onDragEnter={onDragOver}
            onDragLeave={onDragEnd}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, index)}
            type="button"
          >
            <Plus className="size-3" />
            <span>{t('cases.menu.insert')}</span>
          </button>
        }
      />
    </div>
  );
}

function CaseSelector({
  project,
  selectedTestCase,
  onSelect,
}: {
  project: ProjectDraft;
  selectedTestCase?: TestCaseDraft;
  onSelect: (testCaseId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t('cases.select.title')} className="max-w-56 justify-between" type="button" variant="outline">
          <span className="truncate">{selectedTestCase?.name ?? t('cases.select.title')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(28rem,calc(100vh-8rem))] min-w-72 overflow-y-auto">
        {project.groups.map((group, groupIndex) => {
          const cases = project.testCases.filter((testCase) => testCase.groupId === group.id);
          if (!cases.length) {
            return null;
          }

          return (
            <DropdownMenuGroup key={group.id}>
              {groupIndex ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
              {cases.map((testCase) => (
                <DropdownMenuItem key={testCase.id} onSelect={() => onSelect(testCase.id)}>
                  <span className="min-w-0 flex-1 truncate">{testCase.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('cases.steps.count', { count: testCase.steps.length })}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CaseSettingsDialog({
  open,
  onOpenChange,
  onUpdateTestCase,
  project,
  testCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft, mode?: SaveMode) => void;
  project: ProjectDraft;
  testCase: TestCaseDraft;
}) {
  const { t } = useI18n();
  const nameId = useId();
  const targetUrlId = useId();
  const groupLabelId = useId();
  const environmentLabelId = useId();
  const notesId = useId();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t('cases.action.settings')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={nameId}>{t('cases.form.name')}</Label>
            <Input
              id={nameId}
              onChange={(event) => onUpdateTestCase((item) => ({ ...item, name: event.target.value }))}
              value={testCase.name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={targetUrlId}>{t('cases.form.targetUrl')}</Label>
            <Input
              id={targetUrlId}
              onChange={(event) => onUpdateTestCase((item) => ({ ...item, url: event.target.value }))}
              value={testCase.url}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label id={groupLabelId}>{t('cases.form.group')}</Label>
              <Select
                onValueChange={(value) => onUpdateTestCase((item) => ({ ...item, groupId: value }), 'immediate')}
                value={testCase.groupId}
              >
                <SelectTrigger aria-labelledby={groupLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {project.groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label id={environmentLabelId}>{t('cases.form.environment')}</Label>
              <Select
                onValueChange={(value) => onUpdateTestCase((item) => ({ ...item, environmentId: value }), 'immediate')}
                value={testCase.environmentId}
              >
                <SelectTrigger aria-labelledby={environmentLabelId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {project.environments.map((environment) => <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={notesId}>{t('cases.form.notes')}</Label>
            <Textarea
              className="min-h-28"
              id={notesId}
              onChange={(event) => onUpdateTestCase((item) => ({ ...item, notes: event.target.value }))}
              value={testCase.notes}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepInspector({
  focusTitle,
  onFocused,
  onUpdateTestCase,
  project,
  step,
}: {
  focusTitle: boolean;
  onFocused: () => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft, mode?: SaveMode) => void;
  project: ProjectDraft;
  step: TestStepDraft;
}) {
  const { t } = useI18n();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const stepTypeLabelId = useId();
  const recordingLabelId = useId();
  const instructionId = useId();
  const blocker = getTestStepRunBlocker(step, project.recordings);
  const boundRecording = project.recordings.find((recording) => recording.id === step.recordingId);
  const boundGroup = project.groups.find((group) => group.id === boundRecording?.groupId);
  const boundEnvironment = project.environments.find((environment) => environment.id === boundRecording?.environmentId);

  useEffect(() => {
    if (!focusTitle) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      onFocused();
    });

    return () => {
      cancelled = true;
    };
  }, [focusTitle, onFocused]);

  function updateStep(patch: Partial<TestStepDraft>, mode: SaveMode = 'debounced') {
    onUpdateTestCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((item) => (item.id === step.id ? { ...item, ...patch } : item)),
    }), mode);
  }

  function bindRecording(recordingId: string) {
    const recording = project.recordings.find((item) => item.id === recordingId);
    updateStep({
      recordingId,
      body: recording ? t('cases.replay.description', { name: recording.name, count: recording.steps.length }) : step.body,
    }, 'immediate');
  }

  return (
    <div className="case-step-inspector-fields grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={titleId}>{t('cases.step.title')}</Label>
        <Input
          aria-invalid={blocker === 'emptyTitle'}
          className={blocker === 'emptyTitle' ? 'border-destructive/70' : undefined}
          id={titleId}
          onChange={(event) => updateStep({ title: event.target.value })}
          ref={titleInputRef}
          value={step.title}
        />
      </div>
      <div className="grid gap-2">
        <Label id={stepTypeLabelId}>{t('cases.inspector.stepType')}</Label>
        <Select
          onValueChange={(value) => updateStep({
            type: value as TestStepDraft['type'],
            recordingId: value === 'recordingReplay' ? step.recordingId : undefined,
          }, 'immediate')}
          value={step.type}
        >
          <SelectTrigger aria-labelledby={stepTypeLabelId}><SelectValue /></SelectTrigger>
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
        <div className="case-replay-binding grid gap-3">
          <div className="grid gap-2">
            <Label id={recordingLabelId}>{t('cases.replay.bind')}</Label>
            {project.recordings.length ? (
              <Select onValueChange={bindRecording} value={step.recordingId ?? ''}>
                <SelectTrigger aria-invalid={blocker === 'missingRecording'} aria-labelledby={recordingLabelId} className={blocker === 'missingRecording' ? 'border-destructive/70' : undefined}>
                  <SelectValue placeholder={t('cases.replay.choose')} />
                </SelectTrigger>
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
          ) : null}
        </div>
      ) : null}

      {step.type === 'manual' ? (
        <Button
          className="justify-start"
          onClick={() => updateStep(createManualStepAutomationReplacement(step), 'immediate')}
          type="button"
          variant="outline"
        >
          <WandSparkles className="size-4" />
          {t('cases.manual.automate')}
        </Button>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={instructionId}>{t('cases.inspector.instruction')}</Label>
        <Textarea
          aria-invalid={blocker === 'emptyInstruction'}
          className={blocker === 'emptyInstruction' ? 'min-h-36 border-destructive/70' : 'min-h-36'}
          id={instructionId}
          onChange={(event) => updateStep({ body: event.target.value })}
          value={step.body}
        />
      </div>
      {blocker ? (
        <p className="flex items-start gap-2 text-sm leading-5 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {getBlockerLabel(blocker, t)}
        </p>
      ) : null}
    </div>
  );
}

function SerialStepRow({
  dragActive,
  index,
  onCopy,
  onDelete,
  onDragEnd,
  onDragStart,
  onMove,
  onRowRef,
  onSelect,
  project,
  selected,
  step,
  totalSteps,
}: {
  dragActive: boolean;
  index: number;
  onCopy: () => void;
  onDelete: () => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onMove: (index: number) => void;
  onRowRef: (element: HTMLElement | null) => void;
  onSelect: () => void;
  project: ProjectDraft;
  selected: boolean;
  step: TestStepDraft;
  totalSteps: number;
}) {
  const { t } = useI18n();
  const blocker = getTestStepRunBlocker(step, project.recordings);
  const summary =
    step.type === 'recordingReplay'
      ? blocker === 'missingRecording'
        ? t('cases.canvas.replayMissing')
        : t('cases.canvas.replayBound')
      : step.body || t('cases.canvas.emptyStep');

  return (
    <article
      className={`case-step-row ${dragActive ? 'is-dragging' : ''}`}
      data-selected={selected}
      ref={onRowRef}
      role="listitem"
    >
      <button
        aria-label={t('cases.aria.dragStep', { title: step.title })}
        className="case-step-drag"
        draggable
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        title={t('cases.canvas.dragStep')}
        type="button"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        aria-label={t('cases.canvas.stepNode', { index: index + 1, title: step.title })}
        className="case-step-select"
        data-selected={selected}
        onClick={onSelect}
        type="button"
      >
        <span className="case-step-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="case-step-icon"><StepTypeIcon className="size-4" type={step.type} /></span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold text-foreground" title={step.title}>{step.title || t('cases.canvas.emptyStep')}</span>
          <span className="mt-1 block truncate text-xs leading-4 text-muted-foreground" title={summary}>{summary}</span>
        </span>
        <span className="case-step-type">{getStepTypeLabel(step.type, t)}</span>
        {blocker ? <AlertTriangle aria-label={getBlockerLabel(blocker, t)} className="size-4 shrink-0 text-destructive" /> : null}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={`${step.title} ${t('cases.menu.copy')}`} size="icon" title={t('cases.menu.copy')} type="button" variant="ghost">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>
            <ArrowUp className="size-4" />
            {t('cases.menu.moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === totalSteps - 1} onSelect={() => onMove(index + 2)}>
            <ArrowDown className="size-4" />
            {t('cases.menu.moveDown')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCopy}>
            <Copy className="size-4" />
            {t('cases.menu.copy')}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
            <Trash2 className="size-4" />
            {t('cases.step.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

export function TestCaseManagementPage({
  project,
  selectedTestCase,
  selectedTestCaseId,
  runStatus,
  isRunning,
  saveStatus,
  runBlocker,
  onSelectTestCase,
  onCreateTestCase,
  onCreateStep,
  onMoveStep,
  onCopyStep,
  onDeleteStep,
  onRetrySave,
  onRunTestCase,
  onUpdateTestCase,
  onOpenProjects,
}: {
  project?: ProjectDraft;
  selectedTestCase?: TestCaseDraft;
  selectedTestCaseId: string;
  runStatus: RunTone;
  isRunning: boolean;
  saveStatus: SaveStatus;
  runBlocker?: TestCaseRunBlocker;
  onSelectTestCase: (testCaseId: string) => void;
  onCreateTestCase: () => void;
  onCreateStep: (type: TestStepDraft['type'], index: number) => string | undefined;
  onMoveStep: (stepId: string, index: number) => void;
  onCopyStep: (stepId: string) => string | undefined;
  onDeleteStep: (stepId: string) => void;
  onRetrySave: () => void;
  onRunTestCase: () => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft, mode?: SaveMode) => void;
  onOpenProjects?: () => void;
}) {
  const { t } = useI18n();
  const [selectedStepId, setSelectedStepId] = useState(() => selectedTestCase?.steps[0]?.id);
  const [draggedStepId, setDraggedStepId] = useState<string>();
  const [dropIndex, setDropIndex] = useState<number>();
  const [focusStepId, setFocusStepId] = useState<string>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [deleteStepId, setDeleteStepId] = useState<string>();
  const stepRowRefs = useRef(new Map<string, HTMLElement>());
  const selectedStep = selectedTestCase?.steps.find((step) => step.id === selectedStepId);
  const deleteStep = selectedTestCase?.steps.find((step) => step.id === deleteStepId);

  useEffect(() => {
    const steps = selectedTestCase?.steps ?? [];
    setSelectedStepId((current) => (steps.some((step) => step.id === current) ? current : steps[0]?.id));
  }, [selectedTestCase?.id, selectedTestCase?.steps]);

  useEffect(() => {
    if (!focusStepId) {
      return;
    }

    stepRowRefs.current.get(focusStepId)?.scrollIntoView?.({ block: 'nearest' });
  }, [focusStepId, selectedTestCase?.id, selectedTestCase?.steps]);

  function createStep(type: TestStepDraft['type'], index: number) {
    const stepId = onCreateStep(type, index);
    if (!stepId) {
      return;
    }

    setSelectedStepId(stepId);
    setFocusStepId(stepId);
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, stepId: string) {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/testbuddy-step', stepId);
    }
    setDraggedStepId(stepId);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    const stepId = event.dataTransfer?.getData('text/testbuddy-step') || draggedStepId;
    const sourceIndex = selectedTestCase?.steps.findIndex((step) => step.id === stepId) ?? -1;
    if (stepId && sourceIndex >= 0 && index !== sourceIndex && index !== sourceIndex + 1) {
      onMoveStep(stepId, index);
    }
    setDraggedStepId(undefined);
    setDropIndex(undefined);
  }

  function confirmDelete() {
    if (!deleteStepId || !selectedTestCase) {
      return;
    }

    const deletedIndex = selectedTestCase.steps.findIndex((step) => step.id === deleteStepId);
    const nextStepId = selectedTestCase.steps[deletedIndex + 1]?.id ?? selectedTestCase.steps[deletedIndex - 1]?.id;
    onDeleteStep(deleteStepId);
    setSelectedStepId(nextStepId);
    setDeleteStepId(undefined);
  }

  if (!project) {
    return (
      <PageShell>
        <PageHeader title={t('cases.header.title')} />
        <PageBody className="flex min-h-0">
          <ProjectRequiredState
            actionLabel={t('app.nav.projects')}
            description={t('cases.empty.noProjectDescription')}
            onOpenProjects={onOpenProjects}
            title={t('cases.empty.noProject')}
          />
        </PageBody>
      </PageShell>
    );
  }

  const blockerLabel = getBlockerLabel(runBlocker, t);

  return (
    <PageShell className="figma-case-page">
      <PageHeader
        action={
          <>
            {selectedTestCase ? (
              <Button onClick={() => setIsSettingsOpen(true)} type="button" variant="outline">
                <Settings2 className="size-4" />
                {t('cases.action.settings')}
              </Button>
            ) : null}
            <StepTypeMenu
              index={selectedTestCase?.steps.length ?? 0}
              onCreate={createStep}
              trigger={
                <Button disabled={!selectedTestCase} type="button">
                  <Plus className="size-4" />
                  {t('cases.action.addStep')}
                </Button>
              }
            />
            <Button disabled={!selectedTestCase || Boolean(runBlocker) || isRunning} onClick={onRunTestCase} title={blockerLabel} type="button">
              <Play className="size-4" />
              {isRunning ? t('cases.action.running') : t('cases.action.run')}
            </Button>
          </>
        }
        meta={
          <>
            <CaseSelector onSelect={onSelectTestCase} project={project} selectedTestCase={selectedTestCase} />
            {selectedTestCase ? <Badge className="case-editor-tag" variant="outline">{t('cases.status.source')} · {getSourceLabel(selectedTestCase, t)}</Badge> : null}
            <StatusPill tone={runStatus} />
            {saveStatus !== 'idle' ? <Badge className="case-editor-tag" variant="outline">{t(`cases.save.${saveStatus === 'error' ? 'failed' : saveStatus}`)}</Badge> : null}
            {saveStatus === 'error' ? (
              <Button aria-label={t('cases.action.retrySave')} onClick={onRetrySave} size="icon" title={t('cases.action.retrySave')} type="button" variant="ghost">
                <RotateCcw className="size-4" />
              </Button>
            ) : null}
          </>
        }
        title={t('cases.header.title')}
      />

      <PageBody className="flex min-h-0 flex-col overflow-hidden py-2">
        {blockerLabel ? (
          <p className="case-run-blocker flex shrink-0 items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {blockerLabel}
          </p>
        ) : null}
        {!selectedTestCase ? (
          <EvidenceCard
            action={
              <Button onClick={onCreateTestCase} type="button">
                <Plus className="size-4" />
                {t('cases.action.create')}
              </Button>
            }
            description={t('cases.select.emptyDescription')}
            title={t('cases.select.emptyTitle')}
          />
        ) : (
          <section className="case-workbench figma-case-workbench flex-1" aria-label={t('cases.aria.workbench')}>
            <div className="case-step-list" role="list">
              <div className="case-step-flow-sequence">
                <FlowTerminal terminal="start" />
                {selectedTestCase.steps.length ? (
                  <>
                    {selectedTestCase.steps.map((step, index) => (
                      <div className="contents" key={step.id}>
                        <FlowInsertionPoint
                          dropActive={dropIndex === index}
                          index={index}
                          onCreate={createStep}
                          onDragEnd={() => setDropIndex(undefined)}
                          onDragOver={() => setDropIndex(index)}
                          onDrop={handleDrop}
                        />
                        <SerialStepRow
                          dragActive={draggedStepId === step.id}
                          index={index}
                          onCopy={() => {
                            const stepId = onCopyStep(step.id);
                            if (stepId) {
                              setSelectedStepId(stepId);
                              setFocusStepId(stepId);
                            }
                          }}
                          onDelete={() => setDeleteStepId(step.id)}
                          onDragEnd={() => {
                            setDraggedStepId(undefined);
                            setDropIndex(undefined);
                          }}
                          onDragStart={(event) => handleDragStart(event, step.id)}
                          onMove={(targetIndex) => onMoveStep(step.id, targetIndex)}
                          onRowRef={(element) => {
                            if (element) {
                              stepRowRefs.current.set(step.id, element);
                            } else {
                              stepRowRefs.current.delete(step.id);
                            }
                          }}
                          onSelect={() => setSelectedStepId(step.id)}
                          project={project}
                          selected={selectedStepId === step.id}
                          step={step}
                          totalSteps={selectedTestCase.steps.length}
                        />
                      </div>
                    ))}
                    <FlowInsertionPoint
                      dropActive={dropIndex === selectedTestCase.steps.length}
                      index={selectedTestCase.steps.length}
                      onCreate={createStep}
                      onDragEnd={() => setDropIndex(undefined)}
                      onDragOver={() => setDropIndex(selectedTestCase.steps.length)}
                      onDrop={handleDrop}
                    />
                    <FlowTerminal terminal="end" />
                  </>
                ) : (
                  <>
                    <FlowInsertionPoint
                      dropActive={dropIndex === 0}
                      index={0}
                      isEmptyFlow
                      onCreate={createStep}
                      onDragEnd={() => setDropIndex(undefined)}
                      onDragOver={() => setDropIndex(0)}
                      onDrop={handleDrop}
                    />
                    <FlowTerminal terminal="end" />
                  </>
                )}
              </div>
            </div>

            <aside className="case-step-inspector" aria-label={t('cases.inspector.step')}>
              <div className="case-step-inspector-header">
                <span className="text-sm font-semibold text-foreground">{t('cases.inspector.step')}</span>
                {selectedStep ? <Badge className="case-editor-tag" variant="outline">{getStepTypeLabel(selectedStep.type, t)}</Badge> : null}
              </div>
              <div className="case-step-inspector-body">
                {selectedStep ? (
                  <StepInspector
                    focusTitle={focusStepId === selectedStep.id}
                    onFocused={() => setFocusStepId(undefined)}
                    onUpdateTestCase={onUpdateTestCase}
                    project={project}
                    step={selectedStep}
                  />
                ) : (
                  <EvidenceCard description={t('cases.empty.noStepsDescription')} title={t('cases.empty.noStepsTitle')} />
                )}
              </div>
            </aside>
          </section>
        )}
      </PageBody>

      {selectedTestCase ? (
        <CaseSettingsDialog
          onOpenChange={setIsSettingsOpen}
          onUpdateTestCase={onUpdateTestCase}
          open={isSettingsOpen}
          project={project}
          testCase={selectedTestCase}
        />
      ) : null}

      <Dialog onOpenChange={(open) => !open && setDeleteStepId(undefined)} open={Boolean(deleteStep)}>
        <DialogContent aria-describedby={undefined} className="max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('cases.confirm.deleteTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">{t('cases.confirm.deleteDescription')}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteStepId(undefined)} type="button" variant="outline">{t('cases.confirm.cancel')}</Button>
            <Button onClick={confirmDelete} type="button" variant="destructive">
              <Trash2 className="size-4" />
              {t('cases.confirm.deleteAction')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
