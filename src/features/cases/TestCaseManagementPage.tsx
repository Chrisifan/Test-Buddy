import type {
  ProjectDraft,
  RunTone,
  TestCaseDraft,
  TestCaseRunBlocker,
  TestInputBindingTarget,
  TestInputValueBinding,
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
  Unlink,
  WandSparkles,
  Trash2,
} from 'lucide-react';

import {
  createTestCaseIntent,
  createManualStepAutomationReplacement,
  getConfirmedDeterministicTestStep,
  getConfirmedExplicitTestAssertion,
  getTestCaseFixtureOutputBindingOptions,
  getTestStepRunBlocker,
  listLatestTestCaseVersions,
  type VersionedTestAssetReference,
} from '../../../shared/studio.js';
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

const getStepTypeLabel = (type: TestStepDraft['type'], t: (key: string) => string): string => {
  const keys: Record<TestStepDraft['type'], string> = {
    ai: 'cases.step.action',
    aiAssert: 'cases.step.assert',
    aiQuery: 'cases.step.query',
    recordingReplay: 'cases.step.replay',
    manual: 'cases.step.manual',
  };
  return t(keys[type]);
};

const getSourceLabel = (testCase: TestCaseDraft, t: (key: string) => string): string => {
  return t(`cases.source.${testCase.source}`);
};

const getBlockerLabel = (blocker: TestCaseRunBlocker | undefined, t: (key: string) => string): string | undefined => {
  return blocker ? t(`cases.validation.${blocker}`) : undefined;
};

const canConfirmDeterministicAction = (step: TestStepDraft): boolean => {
  if (step.type !== 'ai' || !step.execution?.action) {
    return false;
  }

  return Boolean(getConfirmedDeterministicTestStep({
    ...step,
    execution: { ...step.execution, reviewStatus: 'confirmed' },
  }));
};

const canConfirmExplicitAssertion = (step: TestStepDraft): boolean => {
  if (step.type !== 'aiAssert' || !step.execution?.assertion) {
    return false;
  }

  return Boolean(getConfirmedExplicitTestAssertion({
    ...step,
    execution: { ...step.execution, reviewStatus: 'confirmed' },
  }));
};

const canConfirmStructuredExecution = (step: TestStepDraft): boolean => {
  return canConfirmDeterministicAction(step) || canConfirmExplicitAssertion(step);
};

const StepTypeIcon = ({ type, className }: { type: TestStepDraft['type']; className?: string }) => {
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
};

const StepTypeMenu = ({
  index,
  onCreate,
  trigger,
}: {
  index: number;
  onCreate: (type: TestStepDraft['type'], index: number) => void;
  trigger: ReactNode;
}) => {
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
};

const FlowTerminal = ({ terminal }: { terminal: 'start' | 'end' }) => {
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
};

const FlowInsertionPoint = ({
  disabled,
  dropActive,
  index,
  isEmptyFlow = false,
  onCreate,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  disabled?: boolean;
  dropActive: boolean;
  index: number;
  isEmptyFlow?: boolean;
  onCreate: (type: TestStepDraft['type'], index: number) => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: (event: DragEvent<HTMLButtonElement>, index: number) => void;
}) => {
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
            disabled={disabled}
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
};

const CaseSelector = ({
  project,
  selectedReference,
  selectedTestCase,
  onSelect,
}: {
  project: ProjectDraft;
  selectedReference?: VersionedTestAssetReference;
  selectedTestCase?: TestCaseDraft;
  onSelect: (reference: VersionedTestAssetReference) => void;
}) => {
  const { t } = useI18n();
  const latestCases = listLatestTestCaseVersions(project);
  const versions = selectedReference
    ? project.testCases
        .filter((testCase) => testCase.id === selectedReference.id)
        .sort((left, right) => (right.version ?? 1) - (left.version ?? 1))
    : [];

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t('cases.select.title')} className="max-w-56 justify-between" type="button" variant="outline">
          <span className="truncate">{selectedTestCase?.name ?? t('cases.select.title')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(28rem,calc(100vh-8rem))] min-w-72 overflow-y-auto">
        {project.groups.map((group, groupIndex) => {
          const cases = latestCases.filter((testCase) => testCase.groupId === group.id);
          if (!cases.length) {
            return null;
          }

          return (
            <DropdownMenuGroup key={group.id}>
              {groupIndex ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
              {cases.map((testCase) => (
                <DropdownMenuItem key={testCase.id} onSelect={() => onSelect({ id: testCase.id, version: testCase.version ?? 1 })}>
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
    {selectedTestCase && versions.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={t('cases.select.version')} type="button" variant="outline">
            v{selectedReference?.version ?? selectedTestCase.version ?? 1}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {versions.map((testCase) => (
            <DropdownMenuItem
              key={`${testCase.id}@${testCase.version ?? 1}`}
              onSelect={() => onSelect({ id: testCase.id, version: testCase.version ?? 1 })}
            >
              {testCase.name} · v{testCase.version ?? 1}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null}
    </>
  );
};

const CaseSettingsDialog = ({
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
}) => {
  const { t } = useI18n();
  const nameId = useId();
  const targetUrlId = useId();
  const groupLabelId = useId();
  const environmentLabelId = useId();
  const fixtureLabelId = useId();
  const flowLabelId = useId();
  const businessGoalId = useId();
  const preconditionsId = useId();
  const successCriteriaId = useId();
  const notesId = useId();

  const updateIntent = (patch: { businessGoal?: string; preconditions?: string[]; successCriteria?: string[] }) => {
    onUpdateTestCase((item) => {
      const current = item.intent ?? createTestCaseIntent(item.name.trim() || t('cases.intent.defaultBusinessGoal'));
      const intent = createTestCaseIntent(
        patch.businessGoal ?? current.businessGoal,
        {
          preconditions: patch.preconditions ?? current.preconditions,
          successCriteria: patch.successCriteria ?? current.successCriteria,
        },
      );
      if (!intent.businessGoal) {
        const { intent: _intent, ...caseWithoutIntent } = item;
        return caseWithoutIntent;
      }
      return { ...item, intent };
    });
  };

  const parseIntentLines = (value: string): string[] => {
    return Array.from(new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)));
  };

  const boundFixtureReferences = testCase.assetReferences?.fixtures ?? [];
  const boundFixtureKeys = new Set(boundFixtureReferences.map((fixture) => `${fixture.id}@${fixture.version}`));
  const availableFixtures = project.fixtures.filter((fixture) => (
    !boundFixtureKeys.has(`${fixture.id}@${fixture.version}`) &&
    (!fixture.environmentIds.length || fixture.environmentIds.includes(testCase.environmentId))
  ));

  const attachFixture = (value: string) => {
    const fixture = project.fixtures.find((candidate) => `${candidate.id}@${candidate.version}` === value);
    if (!fixture) {
      return;
    }
    onUpdateTestCase((item) => {
      const assetReferences = item.assetReferences ?? { fixtures: [], reusableFlows: [] };
      const fixtures = assetReferences.fixtures ?? [];
      if (fixtures.some((reference) => reference.id === fixture.id && reference.version === fixture.version)) {
        return item;
      }
      return {
        ...item,
        assetReferences: {
          ...assetReferences,
          fixtures: [...fixtures, { id: fixture.id, version: fixture.version }],
        },
      };
    }, 'immediate');
  };

  const removeFixture = (fixtureId: string, version: number) => {
    onUpdateTestCase((item) => {
      const assetReferences = item.assetReferences ?? { fixtures: [], reusableFlows: [] };
      return {
        ...item,
        assetReferences: {
          ...assetReferences,
          fixtures: (assetReferences.fixtures ?? []).filter((reference) => (
            reference.id !== fixtureId || reference.version !== version
          )),
        },
      };
    }, 'immediate');
  };

  const boundFlowReferences = testCase.assetReferences?.reusableFlows ?? [];
  const boundFlowIds = new Set(boundFlowReferences.map((flow) => flow.id));
  const availableFlows = project.reusableFlows.filter((flow) => !boundFlowIds.has(flow.id));

  const attachReusableFlow = (value: string) => {
    const flow = project.reusableFlows.find((candidate) => `${candidate.id}@${candidate.version}` === value);
    if (!flow) return;
    onUpdateTestCase((item) => {
      const assetReferences = item.assetReferences ?? { fixtures: [], reusableFlows: [] };
      if ((assetReferences.reusableFlows ?? []).some((reference) => reference.id === flow.id)) return item;
      return { ...item, assetReferences: { ...assetReferences, reusableFlows: [...(assetReferences.reusableFlows ?? []), { id: flow.id, version: flow.version }] } };
    }, 'immediate');
  };

  const updateReusableFlowBindings = (updater: (references: VersionedTestAssetReference[]) => VersionedTestAssetReference[]) => {
    onUpdateTestCase((item) => {
      const assetReferences = item.assetReferences ?? { fixtures: [], reusableFlows: [] };
      return { ...item, assetReferences: { ...assetReferences, reusableFlows: updater(assetReferences.reusableFlows ?? []) } };
    }, 'immediate');
  };

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
            <Label id={fixtureLabelId}>{t('cases.fixture.title')}</Label>
            <Select onValueChange={attachFixture}>
              <SelectTrigger aria-labelledby={fixtureLabelId} disabled={!availableFixtures.length}>
                <SelectValue placeholder={availableFixtures.length ? t('cases.fixture.choose') : t('cases.fixture.noAvailable')} />
              </SelectTrigger>
              <SelectContent>
                {availableFixtures.map((fixture) => (
                  <SelectItem key={`${fixture.id}@${fixture.version}`} value={`${fixture.id}@${fixture.version}`}>
                    {fixture.name} v{fixture.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {boundFixtureReferences.length ? (
              <div className="grid gap-2 rounded-[4px] border border-border bg-muted/20 p-3">
                {boundFixtureReferences.map((reference) => {
                  const fixture = project.fixtures.find((candidate) => (
                    candidate.id === reference.id && candidate.version === reference.version
                  ));
                  const name = fixture?.name ?? reference.id;
                  return (
                    <div className="flex items-center justify-between gap-3" key={`${reference.id}@${reference.version}`}>
                      <span className="min-w-0 truncate text-sm">{name} <span className="text-muted-foreground">v{reference.version}</span></span>
                      <Button
                        aria-label={t('cases.fixture.remove', { name, version: reference.version })}
                        onClick={() => removeFixture(reference.id, reference.version)}
                        size="icon"
                        title={t('cases.fixture.remove', { name, version: reference.version })}
                        type="button"
                        variant="ghost"
                      >
                        <Unlink className="size-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm leading-6 text-muted-foreground">{t('cases.fixture.noBound')}</p>}
          </div>
          <div className="grid gap-2">
            <Label id={flowLabelId}>{t('cases.flow.title')}</Label>
            <Select onValueChange={attachReusableFlow}>
              <SelectTrigger aria-labelledby={flowLabelId} disabled={!availableFlows.length}>
                <SelectValue placeholder={availableFlows.length ? t('cases.flow.choose') : t('cases.flow.noAvailable')} />
              </SelectTrigger>
              <SelectContent>
                {availableFlows.map((flow) => <SelectItem key={`${flow.id}@${flow.version}`} value={`${flow.id}@${flow.version}`}>{flow.name} v{flow.version}</SelectItem>)}
              </SelectContent>
            </Select>
            {boundFlowReferences.length ? <div className="grid gap-2 rounded-[4px] border border-border bg-muted/20 p-3">
              {boundFlowReferences.map((reference, index) => {
                const flow = project.reusableFlows.find((candidate) => candidate.id === reference.id && candidate.version === reference.version);
                const name = flow?.name ?? reference.id;
                return <div className="flex items-center justify-between gap-2" key={`${reference.id}@${reference.version}`}><span className="min-w-0 flex-1 truncate text-sm">{name} <span className="text-muted-foreground">v{reference.version}</span></span><Button aria-label={t('cases.flow.moveUp', { name })} disabled={!index} onClick={() => updateReusableFlowBindings((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })} size="icon" type="button" variant="ghost"><ArrowUp className="size-4" /></Button><Button aria-label={t('cases.flow.moveDown', { name })} disabled={index === boundFlowReferences.length - 1} onClick={() => updateReusableFlowBindings((items) => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })} size="icon" type="button" variant="ghost"><ArrowDown className="size-4" /></Button><Button aria-label={t('cases.flow.remove', { name, version: reference.version })} onClick={() => updateReusableFlowBindings((items) => items.filter((item) => item.id !== reference.id || item.version !== reference.version))} size="icon" type="button" variant="ghost"><Unlink className="size-4" /></Button></div>;
              })}
            </div> : <p className="text-sm leading-6 text-muted-foreground">{t('cases.flow.noBound')}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={businessGoalId}>{t('cases.intent.businessGoal')}</Label>
            <Textarea
              className="min-h-20"
              id={businessGoalId}
              onChange={(event) => updateIntent({ businessGoal: event.target.value })}
              value={testCase.intent?.businessGoal ?? ''}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={preconditionsId}>{t('cases.intent.preconditions')}</Label>
              <Textarea
                className="min-h-24"
                id={preconditionsId}
                onChange={(event) => updateIntent({ preconditions: parseIntentLines(event.target.value) })}
                value={testCase.intent?.preconditions.join('\n') ?? ''}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={successCriteriaId}>{t('cases.intent.successCriteria')}</Label>
              <Textarea
                className="min-h-24"
                id={successCriteriaId}
                onChange={(event) => updateIntent({ successCriteria: parseIntentLines(event.target.value) })}
                value={testCase.intent?.successCriteria.join('\n') ?? ''}
              />
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
};

const StepInspector = ({
  focusTitle,
  readOnly = false,
  onFocused,
  onUpdateTestCase,
  project,
  step,
  testCase,
}: {
  focusTitle: boolean;
  readOnly?: boolean;
  onFocused: () => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft, mode?: SaveMode) => void;
  project: ProjectDraft;
  step: TestStepDraft;
  testCase: TestCaseDraft;
}) => {
  const { t } = useI18n();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const stepTypeLabelId = useId();
  const recordingLabelId = useId();
  const inputBindingCredentialLabelId = useId();
  const inputBindingFieldLabelId = useId();
  const inputBindingFixtureOutputLabelId = useId();
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

  const updateStep = (patch: Partial<TestStepDraft>, mode: SaveMode = 'debounced') => {
    onUpdateTestCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((item) => {
        if (item.id !== step.id) {
          return item;
        }

        const changesVisibleIntent = 'title' in patch || 'body' in patch || 'type' in patch;
        const nextStep = { ...item, ...patch };
        return changesVisibleIntent && item.execution?.reviewStatus === 'confirmed'
          ? { ...nextStep, execution: { ...item.execution, reviewStatus: 'needsReview' as const } }
          : nextStep;
      }),
    }), mode);
  };

  const updateStructuredExecutionReviewStatus = (reviewStatus: 'needsReview' | 'confirmed') => {
    onUpdateTestCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((item) => {
        if (!canConfirmStructuredExecution(item) || item.id !== step.id || !item.execution) {
          return item;
        }

        return { ...item, execution: { ...item.execution, reviewStatus } };
      }),
    }), 'immediate');
  };

  const bindRecording = (recordingId: string) => {
    const recording = project.recordings.find((item) => item.id === recordingId);
    updateStep({
      recordingId,
      body: recording ? t('cases.replay.description', { name: recording.name, count: recording.steps.length }) : step.body,
    }, 'immediate');
  };

  const hasStructuredAction = step.type === 'ai' && Boolean(step.execution?.action);
  const hasStructuredAssertion = step.type === 'aiAssert' && Boolean(step.execution?.assertion);
  const action = step.execution?.action;
  const inputBindingTarget: TestInputBindingTarget | undefined = step.execution?.inputBindingTarget ??
    (action?.kind === 'input' || action?.kind === 'select'
      ? { kind: action.kind, locator: action.locator }
      : undefined);
  const inputBinding = action?.kind === 'input' || action?.kind === 'select'
    ? action.binding
    : undefined;
  const credentialBinding = inputBinding?.kind === 'credential' ? inputBinding : undefined;
  const fixtureOutputBinding = inputBinding?.kind === 'fixtureOutput' ? inputBinding : undefined;
  const fixtureOutputOptions = getTestCaseFixtureOutputBindingOptions(project, testCase);
  const hasInputBindingTarget = Boolean(inputBindingTarget);
  const hasStructuredExecution = hasStructuredAction || hasStructuredAssertion || hasInputBindingTarget;
  const supportsDeterministicExecution = canConfirmStructuredExecution(step);
  const isDeterministicActionConfirmed = supportsDeterministicExecution && step.execution?.reviewStatus === 'confirmed';

  const updateInputBinding = (binding: TestInputValueBinding) => {
    if (!inputBindingTarget) {
      return;
    }
    onUpdateTestCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((item) => {
        if (item.id !== step.id || !item.execution) {
          return item;
        }
        return {
          ...item,
          execution: {
            ...item.execution,
            reviewStatus: 'needsReview',
            inputBindingTarget,
            action: {
              kind: inputBindingTarget.kind,
              locator: inputBindingTarget.locator,
              binding,
            },
          },
        };
      }),
    }), 'immediate');
  };

  const clearInputBinding = () => {
    if (!inputBindingTarget) {
      return;
    }
    onUpdateTestCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((item) => {
        if (item.id !== step.id || !item.execution) {
          return item;
        }
        const { action: _action, ...execution } = item.execution;
        return {
          ...item,
          execution: {
            ...execution,
            reviewStatus: 'needsReview',
            inputBindingTarget,
          },
        };
      }),
    }), 'immediate');
  };

  return (
    <div className="case-step-inspector-fields grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={titleId}>{t('cases.step.title')}</Label>
        <Input
          aria-invalid={blocker === 'emptyTitle'}
          className={blocker === 'emptyTitle' ? 'border-destructive/70' : undefined}
          id={titleId}
          disabled={readOnly}
          onChange={(event) => updateStep({ title: event.target.value })}
          ref={titleInputRef}
          value={step.title}
        />
      </div>
      <div className="grid gap-2">
        <Label id={stepTypeLabelId}>{t('cases.inspector.stepType')}</Label>
        <Select
          disabled={readOnly}
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
              <Select disabled={readOnly} onValueChange={bindRecording} value={step.recordingId ?? ''}>
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
          disabled={readOnly}
          onClick={() => updateStep(createManualStepAutomationReplacement(step), 'immediate')}
          type="button"
          variant="outline"
        >
          <WandSparkles className="size-4" />
          {t('cases.manual.automate')}
        </Button>
      ) : null}

      {hasStructuredExecution ? (
        <div className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{t('cases.execution.title')}</span>
            <Badge className="case-editor-tag" variant="outline">
              {supportsDeterministicExecution
                ? t(`cases.execution.${isDeterministicActionConfirmed ? 'confirmed' : 'needsReview'}`)
                : hasInputBindingTarget
                  ? t('cases.execution.needsReview')
                  : t('cases.execution.unsupportedStatus')}
            </Badge>
          </div>
          {inputBindingTarget ? (
            <div className="grid gap-3 rounded-[4px] border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label>{t('cases.binding.title')}</Label>
                {inputBinding ? (
                  <Button
                    aria-label={t('cases.binding.clear')}
                    disabled={readOnly}
                    onClick={clearInputBinding}
                    size="icon"
                    title={t('cases.binding.clear')}
                    type="button"
                    variant="ghost"
                  >
                    <Unlink className="size-4" />
                  </Button>
                ) : null}
              </div>
              {project.credentialRefs.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label id={inputBindingCredentialLabelId}>{t('cases.binding.credential')}</Label>
                    <Select
                      disabled={readOnly}
                      onValueChange={(credentialId) => {
                        const credential = project.credentialRefs.find((item) => item.id === credentialId);
                        if (!credential) {
                          return;
                        }
                        updateInputBinding({
                          kind: 'credential',
                          credentialId,
                          field: credential.username?.trim() ? 'username' : 'secret',
                        });
                      }}
                      value={credentialBinding?.credentialId ?? ''}
                    >
                      <SelectTrigger aria-labelledby={inputBindingCredentialLabelId}>
                        <SelectValue placeholder={t('cases.binding.chooseCredential')} />
                      </SelectTrigger>
                      <SelectContent>
                        {project.credentialRefs.map((credential) => (
                          <SelectItem key={credential.id} value={credential.id}>{credential.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label id={inputBindingFieldLabelId}>{t('cases.binding.field')}</Label>
                    <Select
                      disabled={readOnly || !credentialBinding}
                      onValueChange={(field) => {
                        if (!credentialBinding || (field !== 'username' && field !== 'secret')) {
                          return;
                        }
                        updateInputBinding({ ...credentialBinding, field });
                      }}
                      value={credentialBinding?.field ?? ''}
                    >
                      <SelectTrigger aria-labelledby={inputBindingFieldLabelId}>
                        <SelectValue placeholder={t('cases.binding.chooseField')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem disabled={!project.credentialRefs.find((item) => item.id === credentialBinding?.credentialId)?.username?.trim()} value="username">
                          {t('cases.binding.username')}
                        </SelectItem>
                        <SelectItem disabled={!project.credentialRefs.find((item) => item.id === credentialBinding?.credentialId)?.hasSecret} value="secret">
                          {t('cases.binding.secret')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              {fixtureOutputOptions.length ? (
                <div className="grid gap-2">
                  <Label id={inputBindingFixtureOutputLabelId}>{t('cases.binding.fixtureOutput')}</Label>
                  <Select
                    disabled={readOnly}
                    onValueChange={(value) => {
                      const option = fixtureOutputOptions.find((candidate) => (
                        `${candidate.fixtureId}@${candidate.fixtureVersion}:${candidate.output.name}` === value
                      ));
                      if (!option) {
                        return;
                      }
                      updateInputBinding({
                        kind: 'fixtureOutput',
                        fixtureId: option.fixtureId,
                        fixtureVersion: option.fixtureVersion,
                        outputName: option.output.name,
                      });
                    }}
                    value={fixtureOutputBinding ? `${fixtureOutputBinding.fixtureId}@${fixtureOutputBinding.fixtureVersion}:${fixtureOutputBinding.outputName}` : ''}
                  >
                    <SelectTrigger aria-labelledby={inputBindingFixtureOutputLabelId}>
                      <SelectValue placeholder={t('cases.binding.chooseFixtureOutput')} />
                    </SelectTrigger>
                    <SelectContent>
                      {fixtureOutputOptions.map((option) => (
                        <SelectItem key={`${option.fixtureId}@${option.fixtureVersion}:${option.output.name}`} value={`${option.fixtureId}@${option.fixtureVersion}:${option.output.name}`}>
                          {option.fixtureName} v{option.fixtureVersion} / {option.output.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {!project.credentialRefs.length && !fixtureOutputOptions.length ? (
                <p className="text-sm text-muted-foreground">{t('cases.binding.noCredentials')} {t('cases.binding.noFixtureOutputs')}</p>
              ) : null}
            </div>
          ) : null}
          {supportsDeterministicExecution ? (
            <Button
              className="justify-start"
              disabled={readOnly}
              onClick={() => updateStructuredExecutionReviewStatus(isDeterministicActionConfirmed ? 'needsReview' : 'confirmed')}
              type="button"
              variant={isDeterministicActionConfirmed ? 'outline' : 'default'}
            >
              {isDeterministicActionConfirmed ? <RotateCcw className="size-4" /> : <ShieldCheck className="size-4" />}
              {t(
                isDeterministicActionConfirmed
                  ? 'cases.execution.revoke'
                  : hasStructuredAssertion
                    ? 'cases.execution.confirmAssertion'
                    : 'cases.execution.confirm',
              )}
            </Button>
          ) : !hasInputBindingTarget ? (
            <p className="text-sm leading-5 text-muted-foreground">{t('cases.execution.unsupported')}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={instructionId}>{t('cases.inspector.instruction')}</Label>
        <Textarea
          aria-invalid={blocker === 'emptyInstruction'}
          className={blocker === 'emptyInstruction' ? 'min-h-36 border-destructive/70' : 'min-h-36'}
          id={instructionId}
          disabled={readOnly}
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
};

const SerialStepRow = ({
  dragActive,
  index,
  readOnly = false,
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
  readOnly?: boolean;
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
}) => {
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
        disabled={readOnly}
        draggable={!readOnly}
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
          <Button aria-label={`${step.title} ${t('cases.menu.copy')}`} disabled={readOnly} size="icon" title={t('cases.menu.copy')} type="button" variant="ghost">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={readOnly || index === 0} onSelect={() => onMove(index - 1)}>
            <ArrowUp className="size-4" />
            {t('cases.menu.moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={readOnly || index === totalSteps - 1} onSelect={() => onMove(index + 2)}>
            <ArrowDown className="size-4" />
            {t('cases.menu.moveDown')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={readOnly} onSelect={onCopy}>
            <Copy className="size-4" />
            {t('cases.menu.copy')}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={readOnly} onSelect={onDelete}>
            <Trash2 className="size-4" />
            {t('cases.step.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
};

export const TestCaseManagementPage = ({
  project,
  publishedTestCase,
  draftTestCase,
  selectedReference,
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
  onEditAsNewVersion,
  onPublishCase,
  onDiscardCaseDraft,
  onRetrySave,
  onRunTestCase,
  onUpdateTestCase,
  onOpenProjects,
}: {
  project?: ProjectDraft;
  publishedTestCase?: TestCaseDraft;
  draftTestCase?: TestCaseDraft;
  selectedReference?: VersionedTestAssetReference;
  selectedTestCase?: TestCaseDraft;
  selectedTestCaseId?: string;
  runStatus: RunTone;
  isRunning: boolean;
  saveStatus: SaveStatus;
  runBlocker?: TestCaseRunBlocker;
  onSelectTestCase: (reference: VersionedTestAssetReference) => void;
  onCreateTestCase: () => void;
  onCreateStep: (type: TestStepDraft['type'], index: number) => string | undefined;
  onMoveStep: (stepId: string, index: number) => void;
  onCopyStep: (stepId: string) => string | undefined;
  onDeleteStep: (stepId: string) => void;
  onRetrySave: () => void;
  onEditAsNewVersion?: () => void;
  onPublishCase?: () => void;
  onDiscardCaseDraft?: () => void;
  onRunTestCase: (reference: VersionedTestAssetReference) => void;
  onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft, mode?: SaveMode) => void;
  onOpenProjects?: () => void;
}) => {
  const { t } = useI18n();
  const versionedMode = Boolean(publishedTestCase || selectedReference);
  const selectedCase = draftTestCase ?? publishedTestCase ?? selectedTestCase;
  const isDraftOpen = Boolean(draftTestCase);
  const isEditable = !versionedMode || isDraftOpen;
  const currentReference = selectedReference ?? (selectedCase ? { id: selectedCase.id, version: selectedCase.version ?? 1 } : undefined);
  const [selectedStepId, setSelectedStepId] = useState(() => selectedCase?.steps[0]?.id);
  const [draggedStepId, setDraggedStepId] = useState<string>();
  const [dropIndex, setDropIndex] = useState<number>();
  const [focusStepId, setFocusStepId] = useState<string>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [deleteStepId, setDeleteStepId] = useState<string>();
  const stepRowRefs = useRef(new Map<string, HTMLElement>());
  const selectedStep = selectedCase?.steps.find((step) => step.id === selectedStepId);
  const deleteStep = selectedCase?.steps.find((step) => step.id === deleteStepId);

  useEffect(() => {
    const steps = selectedCase?.steps ?? [];
    setSelectedStepId((current) => (steps.some((step) => step.id === current) ? current : steps[0]?.id));
  }, [selectedCase?.id, selectedCase?.steps]);

  useEffect(() => {
    if (!focusStepId) {
      return;
    }

    stepRowRefs.current.get(focusStepId)?.scrollIntoView?.({ block: 'nearest' });
  }, [focusStepId, selectedCase?.id, selectedCase?.steps]);

  const createStep = (type: TestStepDraft['type'], index: number) => {
    if (!isEditable) {
      return;
    }
    const stepId = onCreateStep(type, index);
    if (!stepId) {
      return;
    }

    setSelectedStepId(stepId);
    setFocusStepId(stepId);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, stepId: string) => {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/testbuddy-step', stepId);
    }
    setDraggedStepId(stepId);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    const stepId = event.dataTransfer?.getData('text/testbuddy-step') || draggedStepId;
    const sourceIndex = selectedCase?.steps.findIndex((step) => step.id === stepId) ?? -1;
    if (isEditable && stepId && sourceIndex >= 0 && index !== sourceIndex && index !== sourceIndex + 1) {
      onMoveStep(stepId, index);
    }
    setDraggedStepId(undefined);
    setDropIndex(undefined);
  };

  const confirmDelete = () => {
    if (!isEditable || !deleteStepId || !selectedCase) {
      return;
    }

    const deletedIndex = selectedCase.steps.findIndex((step) => step.id === deleteStepId);
    const nextStepId = selectedCase.steps[deletedIndex + 1]?.id ?? selectedCase.steps[deletedIndex - 1]?.id;
    onDeleteStep(deleteStepId);
    setSelectedStepId(nextStepId);
    setDeleteStepId(undefined);
  };

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
            {selectedCase && isEditable ? (
              <Button onClick={() => setIsSettingsOpen(true)} type="button" variant="outline">
                <Settings2 className="size-4" />
                {t('cases.action.settings')}
              </Button>
            ) : null}
            {versionedMode && publishedTestCase && !draftTestCase ? (
              <Button onClick={onEditAsNewVersion} type="button" variant="outline">
                {t('cases.action.editVersion')}
              </Button>
            ) : null}
            {versionedMode && draftTestCase ? (
              <>
                <Button onClick={onDiscardCaseDraft} type="button" variant="outline">
                  {t('cases.action.discardDraft')}
                </Button>
                <Button onClick={onPublishCase} type="button">
                  {t('cases.action.publishVersion')}
                </Button>
              </>
            ) : null}
            <StepTypeMenu
              index={selectedCase?.steps.length ?? 0}
              onCreate={createStep}
              trigger={
                <Button disabled={!selectedCase || !isEditable} type="button">
                  <Plus className="size-4" />
                  {t('cases.action.addStep')}
                </Button>
              }
            />
            <Button
              disabled={!publishedTestCase && !selectedTestCase || Boolean(runBlocker) || isRunning || isDraftOpen}
              onClick={() => currentReference && onRunTestCase(currentReference)}
              title={blockerLabel}
              type="button"
            >
              <Play className="size-4" />
              {isRunning ? t('cases.action.running') : t('cases.action.run')}
            </Button>
          </>
        }
        meta={
          <>
            <CaseSelector onSelect={onSelectTestCase} project={project} selectedReference={currentReference} selectedTestCase={selectedCase} />
            {selectedCase ? <Badge className="case-editor-tag" variant="outline">{t('cases.status.source')} · {getSourceLabel(selectedCase, t)}</Badge> : null}
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
        {!selectedCase ? (
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
                {selectedCase.steps.length ? (
                  <>
                    {selectedCase.steps.map((step, index) => (
                      <div className="contents" key={step.id}>
                        <FlowInsertionPoint
                          disabled={!isEditable}
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
                          readOnly={!isEditable}
                          onCopy={() => {
                            const stepId = isEditable ? onCopyStep(step.id) : undefined;
                            if (stepId) {
                              setSelectedStepId(stepId);
                              setFocusStepId(stepId);
                            }
                          }}
                          onDelete={() => isEditable && setDeleteStepId(step.id)}
                          onDragEnd={() => {
                            setDraggedStepId(undefined);
                            setDropIndex(undefined);
                          }}
                          onDragStart={(event) => handleDragStart(event, step.id)}
                          onMove={(targetIndex) => isEditable && onMoveStep(step.id, targetIndex)}
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
                          totalSteps={selectedCase.steps.length}
                        />
                      </div>
                    ))}
                    <FlowInsertionPoint
                      disabled={!isEditable}
                      dropActive={dropIndex === selectedCase.steps.length}
                      index={selectedCase.steps.length}
                      onCreate={createStep}
                      onDragEnd={() => setDropIndex(undefined)}
                      onDragOver={() => setDropIndex(selectedCase.steps.length)}
                      onDrop={handleDrop}
                    />
                    <FlowTerminal terminal="end" />
                  </>
                ) : (
                  <>
                    <FlowInsertionPoint
                      disabled={!isEditable}
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
                    readOnly={!isEditable}
                    onFocused={() => setFocusStepId(undefined)}
                    onUpdateTestCase={(updater, mode) => isEditable && onUpdateTestCase(updater, mode)}
                    project={project}
                    step={selectedStep}
                    testCase={selectedCase}
                  />
                ) : (
                  <EvidenceCard description={t('cases.empty.noStepsDescription')} title={t('cases.empty.noStepsTitle')} />
                )}
              </div>
            </aside>
          </section>
        )}
      </PageBody>

      {selectedCase && isEditable ? (
        <CaseSettingsDialog
          onOpenChange={setIsSettingsOpen}
          onUpdateTestCase={(updater, mode) => isEditable && onUpdateTestCase(updater, mode)}
          open={isSettingsOpen}
          project={project}
          testCase={selectedCase}
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
};
