import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Link2, PencilLine, Play, Plus, RotateCcw, Unlink, X } from 'lucide-react';

import type { ProjectDraft, SuiteAsset, SuiteRunDetail, SuiteRunRecord, VersionedTestAssetReference } from '../../../shared/studio.js';
import { createEmptySuiteAsset, findSuiteAsset, findTestCaseVersion, listLatestTestCaseVersions, resolveSuiteTestCases } from '../../../shared/studio.js';
import { StatusPill } from '../../components/StatusPill.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
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
import { EvidenceCard, OperationalEmptyState, PageBody, PageHeader, PageShell, ProjectRequiredState, Surface } from '../../components/workbench.js';
import { useI18n } from '../../i18n/index.js';

const referenceKey = (reference: VersionedTestAssetReference): string => {
  return `${reference.id}@${reference.version}`;
};

export const SuiteManagementPage = ({
  project,
  selectedSuiteReference,
  isRunning,
  activeRunId,
  lastRun,
  suiteRunRecords = [],
  onSelectSuite,
  onPublishSuite,
  onRunSuite,
  onCancelSuite,
  onOpenRun,
  onOpenProjects,
}: {
  project?: ProjectDraft;
  selectedSuiteReference?: VersionedTestAssetReference;
  isRunning: boolean;
  activeRunId?: string;
  lastRun?: SuiteRunDetail;
  suiteRunRecords?: SuiteRunRecord[];
  onSelectSuite: (reference: VersionedTestAssetReference) => void;
  onPublishSuite: (suite: SuiteAsset) => void;
  onRunSuite: (reference: VersionedTestAssetReference) => void;
  onCancelSuite?: (runId: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenProjects?: () => void;
}) => {
  const { t } = useI18n();
  const selectedSuite = project && selectedSuiteReference
    ? findSuiteAsset(project, selectedSuiteReference)
    : undefined;
  const [draft, setDraft] = useState<SuiteAsset>();
  const editorSuite = draft ?? selectedSuite;
  const durableRuns = editorSuite
    ? suiteRunRecords.filter((record) =>
      record.provenance.suite.reference.id === editorSuite.id &&
      record.provenance.suite.reference.version === editorSuite.version,
    )
    : [];
  const resolution = project && editorSuite ? resolveSuiteTestCases(project, editorSuite) : undefined;
  const preflightMessages = resolution?.issues.map((issue) => issue.message) ?? [];
  const isSavedVersion = Boolean(selectedSuite && !draft);
  const canRun = Boolean(isSavedVersion && resolution?.environment && !preflightMessages.length && !isRunning);

  useEffect(() => {
    setDraft(undefined);
  }, [project?.id, selectedSuiteReference?.id, selectedSuiteReference?.version]);

  if (!project) {
    return (
      <PageShell>
        <PageHeader title={t('suite.header.title')} />
        <PageBody>
          <ProjectRequiredState
            actionLabel={t('suite.empty.openProjects')}
            onOpenProjects={onOpenProjects}
            description={t('suite.empty.description')}
            title={t('suite.empty.title')}
          />
        </PageBody>
      </PageShell>
    );
  }

  const createDraft = () => {
    setDraft(createEmptySuiteAsset(project!, project!.suites.length + 1));
  };

  if (!project.suites.length && !draft) {
    return (
      <PageShell>
        <PageHeader title={t('suite.header.title')} />
        <PageBody>
          <OperationalEmptyState
            description={t('suite.emptyState.description')}
            primaryAction={(
              <Button onClick={createDraft} type="button">
                <Plus className="size-4" />
                {t('suite.action.create')}
              </Button>
            )}
            title={t('suite.emptyState.title')}
          />
        </PageBody>
      </PageShell>
    );
  }

  const editAsNewVersion = () => {
    if (!selectedSuite) {
      return;
    }
    const now = new Date().toISOString();
    setDraft({
      ...selectedSuite,
      version: selectedSuite.version + 1,
      tags: [...selectedSuite.tags],
      caseReferences: selectedSuite.caseReferences.map((reference) => ({
        ...reference,
        dependsOn: reference.dependsOn.map((dependency) => ({ ...dependency })),
      })),
      execution: { ...selectedSuite.execution },
      createdAt: now,
      updatedAt: now,
    });
  };

  const updateDraft = (updater: (suite: SuiteAsset) => SuiteAsset) => {
    const current = draft ?? selectedSuite;
    if (!current) {
      return;
    }
    setDraft(updater(current));
  };

  const addCase = (reference: VersionedTestAssetReference) => {
    const testCase = listLatestTestCaseVersions(project!).find((candidate) => (
      candidate.id === reference.id && (candidate.version ?? 1) === reference.version
    ));
    if (!testCase || !editorSuite || editorSuite.caseReferences.some((reference) => reference.id === testCase.id)) {
      return;
    }
    updateDraft((suite) => ({
      ...suite,
      caseReferences: [...suite.caseReferences, { id: testCase.id, version: testCase.version ?? 1, dependsOn: [] }],
    }));
  };

  const removeCase = (reference: VersionedTestAssetReference) => {
    updateDraft((suite) => ({
      ...suite,
      caseReferences: suite.caseReferences
        .filter((candidate) => referenceKey(candidate) !== referenceKey(reference))
        .map((candidate) => ({
          ...candidate,
          dependsOn: candidate.dependsOn.filter((dependency) => referenceKey(dependency) !== referenceKey(reference)),
        })),
    }));
  };

  const toggleDependency = (reference: SuiteAsset['caseReferences'][number], dependency: VersionedTestAssetReference) => {
    updateDraft((suite) => ({
      ...suite,
      caseReferences: suite.caseReferences.map((candidate) => {
        if (referenceKey(candidate) !== referenceKey(reference)) {
          return candidate;
        }
        const exists = candidate.dependsOn.some((item) => referenceKey(item) === referenceKey(dependency));
        return {
          ...candidate,
          dependsOn: exists
            ? candidate.dependsOn.filter((item) => referenceKey(item) !== referenceKey(dependency))
            : [...candidate.dependsOn, { id: dependency.id, version: dependency.version }],
        };
      }),
    }));
  };

  const publishVersion = () => {
    if (!editorSuite) {
      return;
    }
    const now = new Date().toISOString();
    const latestVersion = project!.suites
      .filter((suite) => suite.id === editorSuite.id)
      .reduce((maximum, suite) => Math.max(maximum, suite.version), 0);
    const published: SuiteAsset = {
      ...editorSuite,
      version: latestVersion ? latestVersion + 1 : 1,
      createdAt: latestVersion ? now : editorSuite.createdAt,
      updatedAt: now,
    };
    onPublishSuite(published);
    setDraft(undefined);
  };

  const selectedReferences = new Set(editorSuite?.caseReferences.map((reference) => reference.id) ?? []);
  const requestedConcurrency = editorSuite?.execution.concurrency ?? 1;
  const lastEffectiveConcurrency = editorSuite && lastRun?.suite.suiteId === editorSuite.id && lastRun.suite.suiteVersion === editorSuite.version
    ? lastRun.suite.effectiveConcurrency
    : undefined;

  return (
    <PageShell>
      <PageHeader
        action={
          <div className="flex items-center gap-2">
            <Button onClick={createDraft} type="button" variant="outline">
              <Plus className="size-4" />
              {t('suite.action.create')}
            </Button>
            {selectedSuite && !draft ? (
              <Button disabled={isRunning} onClick={editAsNewVersion} type="button" variant="outline">
                <PencilLine className="size-4" />
                {t('suite.action.editVersion')}
              </Button>
            ) : null}
            {editorSuite ? (
              <Button disabled={!draft || isRunning} onClick={publishVersion} type="button">
                <Check className="size-4" />
                {t('suite.action.publish')}
              </Button>
            ) : null}
          </div>
        }
        meta={editorSuite ? <Badge variant="outline">v{editorSuite.version}{draft ? t('suite.meta.draft') : ''}</Badge> : undefined}
        title={t('suite.header.title')}
      />
      <PageBody className="min-h-0">
        <div className="grid min-h-[34rem] gap-3 xl:grid-cols-[minmax(12rem,0.7fr)_minmax(24rem,1.55fr)_minmax(16rem,0.8fr)]">
          <Surface className="flex min-h-0 flex-col p-2" variant="panel">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div>
                <h2 className="text-sm font-semibold">{t('suite.inventory.title')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('suite.inventory.description')}</p>
              </div>
              <Badge variant="outline">{project.suites.length}</Badge>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-1">
              {suiteVersions(project.suites).map((suite) => (
                <button
                  aria-label={`选择 ${suite.name} v${suite.version}`}
                  className={`w-full rounded-[4px] border-l-2 px-3 py-2 text-left transition-colors ${selectedSuite?.id === suite.id && selectedSuite.version === suite.version && !draft ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-muted/60'}`}
                  key={referenceKey(suite)}
                  onClick={() => onSelectSuite({ id: suite.id, version: suite.version })}
                  type="button"
                >
                  <span className="block truncate text-sm font-semibold">{suite.name}</span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>v{suite.version}</span>
                    <span>{suite.caseReferences.length} {t('suite.inventory.cases')}</span>
                  </span>
                </button>
              ))}
              {!project.suites.length ? <p className="px-2 py-4 text-sm leading-6 text-muted-foreground">{t('suite.inventory.empty')}</p> : null}
            </div>
          </Surface>

          <Surface className="min-w-0 p-4" variant="panel">
            {editorSuite ? (
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <div className="grid gap-2">
                    <Label htmlFor="suite-name">{t('suite.form.name')}</Label>
                    <Input
                      disabled={!draft}
                      id="suite-name"
                      onChange={(event) => updateDraft((suite) => ({ ...suite, name: event.target.value }))}
                      value={editorSuite.name}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label id="suite-environment">{t('suite.form.environment')}</Label>
                    <Select
                      disabled={!draft}
                      onValueChange={(environmentId) => updateDraft((suite) => ({ ...suite, environmentId }))}
                      value={editorSuite.environmentId}
                    >
                      <SelectTrigger aria-labelledby="suite-environment"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {project.environments.map((environment) => <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="suite-description">{t('suite.form.description')}</Label>
                  <Textarea
                    disabled={!draft}
                    id="suite-description"
                    onChange={(event) => updateDraft((suite) => ({ ...suite, description: event.target.value }))}
                    value={editorSuite.description}
                  />
                </div>
                <SuiteExecutionControls disabled={!draft} suite={editorSuite} onChange={updateDraft} />

                <section className="border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{t('suite.members.title')}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t('suite.members.description')}</p>
                    </div>
                    <Badge variant="outline">{editorSuite.caseReferences.length}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {editorSuite.caseReferences.map((reference, index) => {
                      const testCase = findTestCaseVersion(project, reference);
                      const dependencies = editorSuite.caseReferences.filter((candidate) => referenceKey(candidate) !== referenceKey(reference));
                      return (
                        <div className="rounded-[4px] border border-border p-3" key={referenceKey(reference)}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{index + 1}. {testCase?.name ?? reference.id}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{t('suite.members.pinnedVersion', { version: reference.version })}</p>
                            </div>
                            {draft ? (
                              <Button aria-label={t('suite.members.remove', { name: testCase?.name ?? reference.id })} onClick={() => removeCase(reference)} size="icon" type="button" variant="ghost">
                                <Unlink className="size-4" />
                              </Button>
                            ) : null}
                          </div>
                          {dependencies.length ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {dependencies.map((dependency) => {
                                const dependencyCase = findTestCaseVersion(project, dependency);
                                const active = reference.dependsOn.some((item) => referenceKey(item) === referenceKey(dependency));
                                return (
                                  <Button
                                    aria-pressed={active}
                                    disabled={!draft}
                                    key={referenceKey(dependency)}
                                    onClick={() => toggleDependency(reference, dependency)}
                                    size="sm"
                                    type="button"
                                    variant={active ? 'secondary' : 'outline'}
                                  >
                                    <Link2 className="size-3.5" />
                                    {t('suite.members.dependsOn', {
                                      source: testCase?.name ?? reference.id,
                                      name: dependencyCase?.name ?? dependency.id,
                                    })}
                                  </Button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {!editorSuite.caseReferences.length ? <p className="rounded-[4px] border border-dashed border-border p-3 text-sm text-muted-foreground">{t('suite.members.empty')}</p> : null}
                  </div>
                  {draft ? (
                    <div className="mt-3 grid gap-1.5">
                      {listLatestTestCaseVersions(project).filter((testCase) => !selectedReferences.has(testCase.id)).map((testCase) => (
                        <Button aria-label={t('suite.members.add', { name: testCase.name })} className="justify-start" key={referenceKey({ id: testCase.id, version: testCase.version ?? 1 })} onClick={() => addCase({ id: testCase.id, version: testCase.version ?? 1 })} type="button" variant="ghost">
                          <Plus className="size-4 text-primary" />
                          <span className="truncate">{testCase.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">v{testCase.version ?? 1}</span>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            ) : (
              <EvidenceCard description={t('suite.editor.empty.description')} title={t('suite.editor.empty.title')} />
            )}
          </Surface>

          <aside className="grid content-start gap-3">
            <Surface className="p-4" variant="evidence">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t('suite.preflight.title')}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('suite.preflight.description')}</p>
                </div>
                {resolution ? <StatusPill tone={preflightMessages.length ? 'neutral' : 'passed'} /> : null}
              </div>
              <div className="mt-3 grid gap-2">
                {preflightMessages.map((message) => <p className="flex gap-2 text-xs leading-5 text-destructive" key={message}><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{message}</p>)}
                {resolution && !preflightMessages.length ? <p className="flex gap-2 text-xs leading-5 text-success-foreground"><Check className="mt-0.5 size-3.5 shrink-0" />{t('suite.preflight.ready')}</p> : null}
              </div>
              {editorSuite ? (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">{t('suite.preflight.requestedConcurrency', { count: requestedConcurrency })}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">
                    {lastEffectiveConcurrency === undefined
                      ? t('suite.preflight.effectiveConcurrency')
                      : t('suite.preflight.effectiveConcurrencyMeasured', { count: lastEffectiveConcurrency })}
                  </p>
                </div>
              ) : null}
              <Button className="mt-4 w-full" disabled={!canRun} onClick={() => editorSuite && onRunSuite({ id: editorSuite.id, version: editorSuite.version })} type="button">
                <Play className="size-4" />
                {isRunning ? t('suite.action.running') : t('suite.action.run')}
              </Button>
              {isRunning && activeRunId && onCancelSuite ? (
                <Button className="mt-2 w-full" onClick={() => onCancelSuite(activeRunId)} type="button" variant="outline">
                  <X className="size-4" />
                  {t('suite.action.cancel')}
                </Button>
              ) : null}
            </Surface>
            {lastRun && editorSuite && lastRun.suite.suiteId === editorSuite.id && lastRun.suite.suiteVersion === editorSuite.version ? (
              <SuiteRunSummary lastRun={lastRun} onOpenRun={onOpenRun} project={project} />
            ) : null}
            {durableRuns.map((record) => (
              <SuiteRunRecordSummary key={record.id} onOpenRun={onOpenRun} project={project} record={record} />
            ))}
          </aside>
        </div>
      </PageBody>
    </PageShell>
  );
};

const SuiteExecutionControls = ({ disabled, suite, onChange }: {
  disabled: boolean;
  suite: SuiteAsset;
  onChange: (updater: (suite: SuiteAsset) => SuiteAsset) => void;
}) => {
  const { t } = useI18n();
  return (
    <section className="grid gap-3 border-y border-border py-4 sm:grid-cols-3">
      <div className="grid gap-2">
        <Label htmlFor="suite-concurrency">{t('suite.execution.concurrency')}</Label>
        <Input disabled={disabled} id="suite-concurrency" max="10" min="1" onChange={(event) => onChange((current) => ({ ...current, execution: { ...current.execution, concurrency: clampInteger(event.target.value, 1, 10, current.execution.concurrency) } }))} type="number" value={suite.execution.concurrency} />
      </div>
      <div className="grid gap-2">
        <Label id="suite-failure-policy">{t('suite.execution.failurePolicy')}</Label>
        <Select disabled={disabled} onValueChange={(failurePolicy) => onChange((current) => ({ ...current, execution: { ...current.execution, failurePolicy: failurePolicy === 'failFast' ? 'failFast' : 'continue' } }))} value={suite.execution.failurePolicy}>
          <SelectTrigger aria-labelledby="suite-failure-policy"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="continue">{t('suite.execution.continue')}</SelectItem>
            <SelectItem value="failFast">{t('suite.execution.failFast')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="suite-retry-limit">{t('suite.execution.retryLimit')}</Label>
        <Input disabled={disabled} id="suite-retry-limit" max="3" min="0" onChange={(event) => onChange((current) => ({ ...current, execution: { ...current.execution, retryLimit: clampInteger(event.target.value, 0, 3, current.execution.retryLimit) } }))} type="number" value={suite.execution.retryLimit} />
      </div>
    </section>
  );
};

const SuiteRunSummary = ({ lastRun, onOpenRun, project }: { lastRun: SuiteRunDetail; onOpenRun: (runId: string) => void; project: ProjectDraft }) => {
  const { t } = useI18n();
  return (
    <Surface className="p-4" variant="panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{t('suite.results.title')}</p>
        <StatusPill tone={lastRun.suite.status} />
      </div>
      <div className="mt-3 grid gap-2">
        {lastRun.suite.results.map((result) => {
          const testCase = findTestCaseVersion(project, { id: result.testCaseId, version: result.testCaseVersion });
          return (
            <div className="border-t border-border pt-2 first:border-t-0 first:pt-0" key={`${result.testCaseId}@${result.testCaseVersion}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium">{testCase?.name ?? result.testCaseId}</span>
                <StatusPill tone={result.status} />
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{result.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {result.attempts > 1 ? <Badge variant="outline">{t('suite.results.attempt', { count: result.attempts })}</Badge> : null}
                {result.flaky ? <Badge variant="outline">Flaky</Badge> : null}
                {result.runId ? <Button aria-label={t('suite.results.openRun', { name: testCase?.name ?? result.testCaseId })} onClick={() => onOpenRun(result.runId!)} size="sm" type="button" variant="ghost"><RotateCcw className="size-3.5" />{t('suite.results.open')}</Button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
};

const SuiteRunRecordSummary = ({ onOpenRun, project, record }: {
  onOpenRun: (runId: string) => void;
  project: ProjectDraft;
  record: SuiteRunRecord;
}) => {
  const { t } = useI18n();
  const counts = Object.entries(record.summary)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));
  return (
    <Surface className="p-4" variant="panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{t('suite.records.title')}</p>
        <StatusPill tone={record.status} />
      </div>
      <div className="mt-3 grid gap-1 text-xs leading-5 text-muted-foreground">
        <p>{t('suite.records.startedAt')}: <span>{record.startedAt}</span></p>
        {record.finishedAt ? <p>{t('suite.records.finishedAt')}: <span>{record.finishedAt}</span></p> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {counts.map(({ status, count }) => (
          <Badge key={status} variant="outline">{t('suite.records.count', { status: t(`common.status.${status}`), count })}</Badge>
        ))}
      </div>
      <Button aria-label={t('suite.records.open')} className="mt-3 w-full" onClick={() => onOpenRun(record.id)} size="sm" type="button" variant="outline">
        <RotateCcw className="size-3.5" />
        {t('suite.records.open')}
      </Button>
      <div className="mt-3 grid gap-2 border-t border-border pt-3">
        {(record.members ?? []).map((member) => {
          const testCase = findTestCaseVersion(project, { id: member.testCaseId, version: member.testCaseVersion });
          return (
            <div className="border-t border-border pt-2 first:border-t-0 first:pt-0" key={`${member.testCaseId}@${member.testCaseVersion}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium">{testCase?.name ?? member.testCaseId}</span>
                <StatusPill tone={member.status} />
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{member.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {member.attempts > 1 ? <Badge variant="outline">{t('suite.results.attempt', { count: member.attempts })}</Badge> : null}
                {member.flaky ? <Badge variant="outline">Flaky</Badge> : null}
                {member.runId ? <Button aria-label={t('suite.results.openRun', { name: testCase?.name ?? member.testCaseId })} onClick={() => onOpenRun(member.runId!)} size="sm" type="button" variant="ghost"><RotateCcw className="size-3.5" />{t('suite.results.open')}</Button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
};

const suiteVersions = (suites: SuiteAsset[]): SuiteAsset[] => {
  return [...suites].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN') ||
    left.id.localeCompare(right.id) ||
    right.version - left.version,
  );
};

const clampInteger = (value: string, minimum: number, maximum: number, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
