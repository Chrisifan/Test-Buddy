import { useMemo, useState, type ReactNode } from 'react';
import type { ProjectDraft, RunDetail, RunSummary, RunTone } from '../../../shared/studio.js';

import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  Gauge,
  Layers3,
  MonitorDot,
  PackageOpen,
  RefreshCcw,
  Table2,
  TerminalSquare,
} from 'lucide-react';

import { StatusPill } from '../../components/StatusPill.js';
import { ActionListItem, EvidenceCard, MetricTile, PageHeader, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '../../i18n/index.js';
import { exportArtifact, openArtifact } from '../../lib/runtime.js';

type Bucket = {
  label: string;
  total: number;
  failed: number;
};

type Translator = (key: string, replacements?: Record<string, string | number>) => string;

function getRunGroupName(project: ProjectDraft | undefined, run: RunSummary, t: Translator): string {
  if (!project) {
    return t('runs.value.unassigned');
  }

  const testCase = project.testCases.find((item) => item.id === run.testCaseId);
  const group = project.groups.find((item) => item.id === testCase?.groupId);
  return group?.name ?? t('runs.value.ungrouped');
}

function getRunEnvironmentName(project: ProjectDraft | undefined, run: RunSummary, t: Translator): string {
  if (run.environmentName) {
    return run.environmentName;
  }

  return project?.environments.find((environment) => environment.id === run.environmentId)?.name ?? t('runs.value.environmentMissing');
}

function getHealthLabel(total: number, failed: number, running: number, t: Translator): string {
  if (!total) {
    return t('runs.health.waiting');
  }

  if (failed > 0 && failed >= Math.max(1, total - failed - running)) {
    return t('runs.health.highRisk');
  }

  if (running > 0) {
    return t('runs.health.observing');
  }

  return failed > 0 ? t('runs.health.attention') : t('runs.health.stable');
}

function getWorstBucket(buckets: Bucket[]): Bucket | null {
  return buckets
    .filter((bucket) => bucket.total > 0)
    .sort((left, right) => right.failed - left.failed || right.total - left.total)[0] ?? null;
}

function formatTableTitle(caption: string | undefined, index: number, t: Translator): string {
  return t('runs.agent.tableTitle', { title: caption || `#${index}` });
}

function formatChartTitle(title: string | undefined, index: number, t: Translator): string {
  return t('runs.agent.chartTitle', { title: title || `#${index}` });
}

function formatChartMeta(chart: {
  kind: string;
  width?: number;
  height?: number;
  rendered?: boolean;
  legends?: string[];
}, t: Translator): string {
  const size = chart.width && chart.height ? `${chart.width}x${chart.height}` : t('runs.agent.sizeMissing');
  const rendered = chart.rendered === undefined
    ? t('runs.agent.renderUnknown')
    : chart.rendered ? t('runs.agent.rendered') : t('runs.agent.notRendered');
  const legends = chart.legends?.length
    ? t('runs.agent.legends', { legends: chart.legends.join(' / ') })
    : t('runs.agent.legendsMissing');
  return `${chart.kind} · ${size} · ${rendered} · ${legends}`;
}

function formatAgentRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function RunRecordsPage({
  project,
  recentRuns,
  runDetails,
  selectedRunId,
  onSelectRun,
}: {
  project?: ProjectDraft;
  recentRuns: RunSummary[];
  runDetails: RunDetail[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}) {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'passed' | 'failed' | 'neutral'>('all');
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const projectRuns = project
    ? recentRuns.filter((run) => !run.projectId || run.projectId === project.id)
    : recentRuns;
  const visibleRuns = useMemo(
    () =>
      projectRuns.filter((run) => {
        if (statusFilter !== 'all' && run.status !== statusFilter) {
          return false;
        }
        if (environmentFilter !== 'all' && run.environmentId !== environmentFilter) {
          return false;
        }
        if (!project || groupFilter === 'all') {
          return true;
        }

        const testCase = project.testCases.find((item) => item.id === run.testCaseId);
        return testCase?.groupId === groupFilter;
      }),
    [environmentFilter, groupFilter, project, projectRuns, statusFilter],
  );
  const selectedRun =
    runDetails.find((run) => run.id === selectedRunId) ??
    runDetails.find((run) => run.id === visibleRuns[0]?.id);
  const selectedAgentRun = selectedRun?.agentRun;
  const selectedObservation = selectedAgentRun?.events.find((event) => event.type === 'agent:observation-created')?.observation;
  const selectedVerification = selectedAgentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
  const selectedEvidenceArtifacts = selectedRun?.artifacts.filter((artifact) =>
    ['screenshot', 'snapshot', 'trace', 'report'].includes(artifact.type),
  ) ?? [];
  const runStats = useMemo(
    () => ({
      total: visibleRuns.length,
      passed: visibleRuns.filter((run) => run.status === 'passed').length,
      failed: visibleRuns.filter((run) => run.status === 'failed').length,
      running: visibleRuns.filter((run) => run.status === 'running').length,
    }),
    [visibleRuns],
  );
  const runAnalytics = useMemo(() => {
    const groupBuckets = new Map<string, Bucket>();
    const environmentBuckets = new Map<string, Bucket>();

    visibleRuns.forEach((run) => {
      const groupName = getRunGroupName(project, run, t);
      const environmentName = getRunEnvironmentName(project, run, t);
      const groupBucket = groupBuckets.get(groupName) ?? { label: groupName, total: 0, failed: 0 };
      const environmentBucket = environmentBuckets.get(environmentName) ?? {
        label: environmentName,
        total: 0,
        failed: 0,
      };

      groupBucket.total += 1;
      environmentBucket.total += 1;

      if (run.status === 'failed') {
        groupBucket.failed += 1;
        environmentBucket.failed += 1;
      }

      groupBuckets.set(groupName, groupBucket);
      environmentBuckets.set(environmentName, environmentBucket);
    });

    const passRate = runStats.total ? Math.round((runStats.passed / runStats.total) * 100) : 0;
    const failedRunIds = new Set(visibleRuns.filter((run) => run.status === 'failed').map((run) => run.id));
    const latestFailure = runDetails.find((detail) => failedRunIds.has(detail.id) && detail.failureReason);

    return {
      passRate,
      healthLabel: getHealthLabel(runStats.total, runStats.failed, runStats.running, t),
      latestFailureReason: latestFailure?.failureReason ?? '',
      worstGroup: getWorstBucket([...groupBuckets.values()]),
      worstEnvironment: getWorstBucket([...environmentBuckets.values()]),
    };
  }, [project, runDetails, runStats.failed, runStats.passed, runStats.running, runStats.total, t, visibleRuns]);

  return (
    <PageShell>
      <PageHeader
        description={t('runs.header.description')}
        eyebrow={t('runs.header.eyebrow')}
        meta={[
          t('runs.meta.total', { count: runStats.total }),
          t('runs.meta.passed', { count: runStats.passed }),
          t('runs.meta.failed', { count: runStats.failed }),
          t('runs.meta.running', { count: runStats.running }),
        ].map((item) => (
          <Badge className="rounded-[4px] px-3 py-1.5" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('runs.header.title')}
      />

      <PageBody>
      <section className="designer-split run-workbench" aria-label={t('runs.aria.workbench')}>
        <aside className="designer-panel">
          <div className="designer-panel-header grid gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">{t('runs.list.eyebrow')}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">{t('runs.list.title')}</h2>
              </div>
              <FileSearch className="h-5 w-5 text-primary" />
            </div>
            <Select onValueChange={(value) => setStatusFilter(value as typeof statusFilter)} value={statusFilter}>
              <SelectTrigger className="rounded-[4px]"><SelectValue placeholder={t('runs.filter.status')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('runs.filter.allStatuses')}</SelectItem>
                <SelectItem value="running">{t('common.status.running')}</SelectItem>
                <SelectItem value="passed">{t('common.status.passed')}</SelectItem>
                <SelectItem value="failed">{t('common.status.failed')}</SelectItem>
                <SelectItem value="neutral">{t('runs.filter.neutral')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Select onValueChange={(value) => setGroupFilter(value)} value={groupFilter}>
                <SelectTrigger className="rounded-[4px]"><SelectValue placeholder={t('runs.filter.group')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('runs.filter.allGroups')}</SelectItem>
                  {project?.groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select onValueChange={(value) => setEnvironmentFilter(value)} value={environmentFilter}>
                <SelectTrigger className="rounded-[4px]"><SelectValue placeholder={t('runs.filter.environment')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('runs.filter.allEnvironments')}</SelectItem>
                  {project?.environments.map((environment) => (
                    <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="designer-panel-body grid gap-2">
            {visibleRuns.map((run) => (
              <button
                className={`designer-case-row ${run.id === selectedRunId ? 'is-active' : ''}`}
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                type="button"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">{run.name}</span>
                  <StatusPill tone={run.status} />
                </span>
                <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{run.summary}</span>
              </button>
            ))}
            {!visibleRuns.length ? (
              <EvidenceCard title={t('runs.empty.title')} description={t('runs.empty.description')} />
            ) : null}
          </div>
        </aside>

        <section className="designer-panel designer-detail-stage run-detail-stage min-w-0">
          <div className="grid gap-3 md:grid-cols-5">
            <Surface className="p-5 md:col-span-2" variant="stat">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t('runs.quality.eyebrow')}</p>
                  <p className="mt-2 text-5xl font-semibold tracking-[-0.065em]">{runAnalytics.passRate}%</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t('runs.quality.summary', { total: runStats.total, failed: runStats.failed })}</p>
                </div>
                <StatusPill tone={runStats.failed ? 'failed' : runStats.running ? 'running' : 'passed'} />
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-background/80">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${runAnalytics.passRate}%` }} />
              </div>
            </Surface>
            <MetricTile label={t('runs.metric.total')} value={`${runStats.total}`} />
            <MetricTile label={t('runs.metric.failed')} value={`${runStats.failed}`} tone={runStats.failed ? 'failed' : 'neutral'} />
            <MetricTile label={t('runs.metric.health')} value={runAnalytics.healthLabel} tone={runStats.failed ? 'failed' : 'passed'} />
          </div>
          {selectedRun ? (
            <div className="mt-5 grid gap-5">
              <div className="grid gap-3 md:grid-cols-3">
                  <InsightCard
                    icon={<Gauge className="h-4 w-4" />}
                    label={t('runs.metric.health')}
                    tone={runStats.failed ? 'failed' : runStats.running ? 'running' : 'passed'}
                    value={runAnalytics.healthLabel}
                  />
                  <InsightCard
                    icon={<Layers3 className="h-4 w-4" />}
                    label={t('runs.insight.group')}
                    tone={runAnalytics.worstGroup?.failed ? 'failed' : 'neutral'}
                    value={
                      runAnalytics.worstGroup
                        ? t('runs.insight.failureCount', {
                            label: runAnalytics.worstGroup.label,
                            failed: runAnalytics.worstGroup.failed,
                            total: runAnalytics.worstGroup.total,
                          })
                        : t('runs.insight.noSamples')
                    }
                  />
                  <InsightCard
                    icon={<AlertTriangle className="h-4 w-4" />}
                    label={t('runs.insight.environment')}
                    tone={runAnalytics.worstEnvironment?.failed ? 'failed' : 'neutral'}
                    value={
                      runAnalytics.worstEnvironment
                        ? t('runs.insight.failureCount', {
                            label: runAnalytics.worstEnvironment.label,
                            failed: runAnalytics.worstEnvironment.failed,
                            total: runAnalytics.worstEnvironment.total,
                          })
                        : t('runs.insight.noSamples')
                    }
                  />
              </div>

              {runAnalytics.latestFailureReason ? (
                <div className="rounded-[6px] bg-destructive/10 p-4 text-sm leading-7 text-foreground">
                  {t('runs.failure.latest', { reason: runAnalytics.latestFailureReason })}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-4">
                <MetricTile label={t('runs.metric.status')} value={t(`common.status.${selectedRun.status}`)} />
                <MetricTile label={t('runs.metric.duration')} value={selectedRun.duration} />
                <MetricTile label={t('runs.metric.steps')} value={`${selectedRun.steps.length}`} />
                <MetricTile label={t('runs.metric.artifacts')} value={`${selectedRun.artifacts.length}`} />
              </div>
              {selectedRun.failureReason ? (
                <div className="rounded-[6px] bg-destructive/10 p-4 text-sm text-foreground">
                  {t('runs.failure.current', { reason: selectedRun.failureReason })}
                </div>
              ) : null}
              {selectedAgentRun ? (
                <section className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-primary">{t('runs.agent.eyebrow')}</p>
                      <h3 className="mt-1 text-base font-semibold tracking-[-0.03em]">{t('runs.agent.title')}</h3>
                    </div>
                    <StatusPill tone={selectedAgentRun.status} />
                  </div>
                  {selectedAgentRun.metrics ? (
                    <div
                      aria-label={t('runs.agent.metrics')}
                      className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 text-primary" />
                        {selectedAgentRun.metrics.durationMs} ms
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5 text-primary" />
                        {t('runs.agent.modelCalls', { count: selectedAgentRun.metrics.calls })}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Database className="h-3.5 w-3.5 text-primary" />
                        {selectedAgentRun.metrics.totalTokens} tokens
                      </span>
                      <span>{t('runs.agent.modelDuration', { duration: selectedAgentRun.metrics.modelTimeCostMs })}</span>
                      {selectedAgentRun.metrics.cachedInputTokens ? (
                        <span>{t('runs.agent.cachedTokens', { count: selectedAgentRun.metrics.cachedInputTokens })}</span>
                      ) : null}
                      {selectedAgentRun.metrics.replanningCycleLimit ? (
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCcw className="h-3.5 w-3.5 text-primary" />
                          {t('runs.agent.replanningLimit', { count: selectedAgentRun.metrics.replanningCycleLimit })}
                        </span>
                      ) : null}
                      {selectedAgentRun.metrics.replanningCycles ? (
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCcw className="h-3.5 w-3.5 text-primary" />
                          {t('runs.agent.replanned', { count: selectedAgentRun.metrics.replanningCycles })}
                        </span>
                      ) : null}
                      {selectedAgentRun.metrics.retryAttempts ? (
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCcw className="h-3.5 w-3.5 text-primary" />
                          {t('runs.agent.retried', { count: selectedAgentRun.metrics.retryAttempts })}
                        </span>
                      ) : null}
                      {selectedAgentRun.metrics.dynamicWaitAttempts ? (
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCcw className="h-3.5 w-3.5 text-primary" />
                          {t('runs.agent.dynamicWait', { count: selectedAgentRun.metrics.dynamicWaitAttempts })}
                        </span>
                      ) : null}
                      {selectedAgentRun.metrics.selectorFallbackAttempts ? (
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCcw className="h-3.5 w-3.5 text-primary" />
                          {t('runs.agent.selectorFallback', {
                            count: selectedAgentRun.metrics.selectorFallbackAttempts,
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedAgentRun.modelAssignments?.length ? (
                    <Surface className="p-4" variant="subtle">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="inline-flex items-center gap-2 text-sm font-medium">
                          <BrainCircuit className="h-4 w-4 text-primary" />
                          <span>{t('runs.agent.models')}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedAgentRun.modelAssignments.map((assignment) => (
                            <span
                              className="rounded-[4px] bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground"
                              key={assignment.role}
                              title={`${assignment.provider === 'reuseMidscene' ? t('runs.agent.reuseMidscene') : t('runs.agent.independentModel')} · ${
                                assignment.hasApiKey ? t('runs.agent.keyConfigured') : t('runs.agent.keyMissing')
                              }`}
                            >
                              <span className="font-medium text-foreground">
                                {formatAgentRole(assignment.role)} · {assignment.modelName || t('common.notConfigured')}
                              </span>
                              <span className="ml-2">
                                {assignment.source === 'midscene' ? 'MidScene' : t('runs.agent.independent')}
                                {assignment.enabled ? '' : ` / ${t('common.paused')}`}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </Surface>
                  ) : null}
                  <div className="grid gap-3 lg:grid-cols-3">
                    <EvidencePanel
                      icon={<MonitorDot className="h-4 w-4" />}
                      title={t('runs.agent.observation')}
                      meta={selectedObservation?.title || selectedObservation?.url || t('runs.agent.pageTitleMissing')}
                    >
                      <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
                        {selectedObservation?.textSummary || selectedObservation?.domSummary || t('runs.agent.summaryMissing')}
                      </p>
                      {selectedObservation?.interactiveElements?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedObservation.interactiveElements.slice(0, 6).map((item) => (
                            <span className="rounded-[4px] bg-primary/10 px-2 py-1 text-[11px] text-primary" key={item}>
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {selectedObservation?.tables?.length || selectedObservation?.charts?.length ? (
                        <div className="mt-4 grid gap-3">
                          {selectedObservation.tables?.slice(0, 3).map((table) => (
                            <div className="grid gap-1 rounded-[4px] bg-background/65 p-3" key={`table-${table.index}`}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="inline-flex min-w-0 items-center gap-2 truncate text-xs font-medium">
                                  <Table2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span className="truncate">{formatTableTitle(table.caption, table.index, t)}</span>
                                </p>
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                  {t('runs.agent.tableDimensions', { rows: table.rowCount, columns: table.columnCount })}
                                </span>
                              </div>
                              {table.headers.length ? (
                                <p className="truncate text-[11px] text-muted-foreground">{table.headers.join(' · ')}</p>
                              ) : null}
                              {table.sortStates?.length ? (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {t('runs.agent.sort', { states: table.sortStates.map((state) => `${state.column} ${state.direction}`).join(' / ') })}
                                </p>
                              ) : null}
                              {table.sampleRows[0]?.length ? (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {table.sampleRows[0].join(' · ')}
                                </p>
                              ) : null}
                            </div>
                          ))}
                          {selectedObservation.charts?.slice(0, 3).map((chart) => (
                            <div className="grid gap-1 rounded-[4px] bg-background/65 p-3" key={`chart-${chart.index}`}>
                              <p className="inline-flex min-w-0 items-center gap-2 truncate text-xs font-medium">
                                <BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary" />
                                <span className="truncate">{formatChartTitle(chart.title, chart.index, t)}</span>
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">{formatChartMeta(chart, t)}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </EvidencePanel>
                    <EvidencePanel
                      icon={<CheckCircle2 className="h-4 w-4" />}
                      title={t('runs.agent.assertionResult')}
                      meta={selectedVerification?.status ?? selectedAgentRun.status}
                    >
                      <p className="text-sm leading-6 text-muted-foreground">
                        {selectedVerification?.summary || t('runs.agent.assertionMissing')}
                      </p>
                      {selectedVerification?.evidence ? (
                        <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {t('runs.agent.evidence', { evidence: selectedVerification.evidence })}
                        </p>
                      ) : null}
                    </EvidencePanel>
                    <EvidencePanel
                      icon={<PackageOpen className="h-4 w-4" />}
                      title={t('runs.agent.artifacts')}
                      meta={t('runs.agent.fileCount', { count: selectedEvidenceArtifacts.length })}
                    >
                      <div className="grid gap-2">
                        {selectedEvidenceArtifacts.slice(0, 4).map((artifact) => (
                          <div className="rounded-[6px] bg-background/70 p-2" key={artifact.id}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-xs font-medium">{artifact.label}</p>
                              {artifact.type === 'report' && !artifact.path.startsWith('memory://') ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    aria-label={t('runs.agent.openArtifact', { name: artifact.label })}
                                    className="inline-flex h-7 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                                    onClick={() => {
                                      void openArtifact(artifact.path);
                                    }}
                                    title={t('runs.agent.openArtifact', { name: artifact.label })}
                                    type="button"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <span>{t('runs.agent.open')}</span>
                                  </button>
                                  <button
                                    aria-label={t('runs.agent.exportArtifact', { name: artifact.label })}
                                    className="inline-flex h-7 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                                    onClick={() => {
                                      void exportArtifact(artifact.path);
                                    }}
                                    title={t('runs.agent.exportArtifact', { name: artifact.label })}
                                    type="button"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    <span>{t('runs.agent.export')}</span>
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">{artifact.path}</p>
                            {artifact.type === 'screenshot' || artifact.type === 'snapshot' ? (
                              <img
                                alt={artifact.label}
                                className="mt-2 aspect-video w-full rounded-[4px] object-cover"
                                src={`file://${artifact.path}`}
                              />
                            ) : null}
                          </div>
                        ))}
                        {!selectedEvidenceArtifacts.length ? (
                          <p className="text-sm text-muted-foreground">{t('runs.agent.noArtifacts')}</p>
                        ) : null}
                      </div>
                    </EvidencePanel>
                  </div>
                  {selectedObservation?.consoleMessages?.length || selectedObservation?.networkHints?.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <SignalList emptyLabel={t('runs.agent.noSignals')} title={t('runs.agent.consoleSignals')} items={selectedObservation.consoleMessages ?? []} />
                      <SignalList emptyLabel={t('runs.agent.noSignals')} title={t('runs.agent.networkSignals')} items={selectedObservation.networkHints ?? []} />
                    </div>
                  ) : null}
                  <Surface className="p-4" variant="subtle">
                    <div className="flex items-center gap-2">
                      <TerminalSquare className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">{t('runs.agent.events')}</p>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {selectedAgentRun.events.map((event) => (
                        <div className="grid gap-1 rounded-[6px] bg-background/70 p-3" key={event.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="rounded-[4px]" variant="outline">{event.type}</Badge>
                            <StatusPill tone={event.status} />
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">{event.message}</p>
                        </div>
                      ))}
                    </div>
                  </Surface>
                </section>
              ) : null}
              <div className="grid gap-3">
                {selectedRun.steps.map((step) => (
                  <article className="rounded-[8px] border border-border bg-card p-4" key={step.id}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">{step.title}</p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.message}</p>
                      </div>
                      <StatusPill tone={step.status} />
                    </div>
                    {step.screenshotPath ? (
                      <div className="mt-3 grid gap-3">
                        <img
                          alt={t('runs.screenshot.alt', { title: step.title })}
                          className="aspect-video w-full rounded-[6px] border border-border object-cover"
                          src={`file://${step.screenshotPath}`}
                        />
                        <p className="truncate text-xs text-muted-foreground">{t('runs.screenshot.path', { path: step.screenshotPath })}</p>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              <div className="designer-terminal p-4">
                <p className="text-sm font-medium text-white">{t('runs.debugLog')}</p>
                <div className="mt-3 grid gap-2">
                  {selectedRun.logs.map((line) => (
                    <code className="whitespace-pre-wrap text-xs leading-6 text-gray-300" key={line}>
                      {line}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <EvidenceCard title={t('runs.emptyResult.title')} description={t('runs.emptyResult.description')} />
            </div>
          )}
        </section>
      </section>
      </PageBody>
    </PageShell>
  );
}

function EvidencePanel({
  children,
  icon,
  meta,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <Surface className="p-4" variant="subtle">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <p className="text-sm font-medium">{title}</p>
        </div>
        <span className="max-w-[45%] truncate text-xs text-muted-foreground">{meta}</span>
      </div>
      {children}
    </Surface>
  );
}

function SignalList({ emptyLabel, items, title }: { emptyLabel: string; items: string[]; title: string }) {
  return (
    <Surface className="p-4" variant="subtle">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-3 grid gap-2">
        {items.slice(0, 6).map((item) => (
          <code className="rounded-[4px] bg-background/70 px-2 py-1 text-xs leading-5 text-muted-foreground" key={item}>
            {item}
          </code>
        ))}
        {!items.length ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : null}
      </div>
    </Surface>
  );
}

function InsightCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: RunTone;
}) {
  return (
    <Surface className="flex items-start gap-3 p-4" variant="subtle">
      <span className="mt-0.5 text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <StatusPill tone={tone} />
        </div>
        <p className="mt-2 truncate text-sm font-medium">{value}</p>
      </div>
    </Surface>
  );
}
