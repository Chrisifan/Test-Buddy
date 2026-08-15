import { useMemo, useState, type ReactNode } from 'react';
import {
  canCreateReporterFixDraft,
  deriveRunCoverageRisk,
  type ProjectAssetBinding,
  type ProjectDraft,
  type RunArtifact,
  type RunDetail,
  type RunSummary,
  type RunTone,
} from '../../../shared/studio.js';
import type { AgentArtifact, AgentExecutionMetrics, AgentReporterSummary, AgentRunEvent, AgentRunResult } from '../../../shared/agent.js';

import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FilePenLine,
  FileSearch,
  Gauge,
  GitCompareArrows,
  Image,
  Layers3,
  LocateFixed,
  MonitorDot,
  PackageOpen,
  Paperclip,
  RefreshCcw,
  ShieldAlert,
  Table2,
  TerminalSquare,
  TrendingDown,
  TrendingUp,
  X,
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

type FailureCluster = {
  reason: string;
  count: number;
};

type FailureTrend = {
  direction: 'rising' | 'falling' | 'steady';
  delta: number;
};

type RunComparison = {
  changedSteps: number;
  totalComparableSteps: number;
  artifactDelta: number;
};

type Translator = (key: string, replacements?: Record<string, string | number>) => string;

function formatEventMetrics(metrics: AgentExecutionMetrics, t: Translator): string {
  const values = [
    metrics.calls ? t('runs.agent.modelCalls', { count: metrics.calls }) : '',
    metrics.totalTokens ? t('runs.agent.tokens', { count: metrics.totalTokens }) : '',
    metrics.modelTimeCostMs ? t('runs.agent.modelDuration', { duration: metrics.modelTimeCostMs }) : '',
  ].filter(Boolean);

  return values.join(' · ');
}

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

function getRunPrdDocumentName(
  project: ProjectDraft | undefined,
  run: Pick<RunSummary, 'documentId'>,
): string | undefined {
  return run.documentId
    ? project?.documents.find((document) => document.id === run.documentId)?.name
    : undefined;
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

function getFailureReason(detail: RunDetail): string {
  return (
    detail.failureReason ??
    detail.agentRun?.failureReason ??
    detail.agentRun?.events.find((event) => event.verification?.failureReason)?.verification?.failureReason ??
    detail.summary
  ).trim();
}

function normalizeFailureReason(reason: string): string {
  return reason.trim().toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[。.!！]+$/g, '');
}

function getFailureTrend(runs: RunSummary[]): FailureTrend | undefined {
  const chronologicalRuns = runs
    .map((run) => ({ run, timestamp: run.startedAt ? Date.parse(run.startedAt) : Number.NaN }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (chronologicalRuns.length < 4) {
    return undefined;
  }
  const midpoint = Math.floor(chronologicalRuns.length / 2);
  const earlierRuns = chronologicalRuns.slice(0, midpoint);
  const recentRuns = chronologicalRuns.slice(midpoint);
  const failureRate = (entries: typeof chronologicalRuns) => entries.filter((entry) => entry.run.status === 'failed').length / entries.length;
  const delta = Math.round((failureRate(recentRuns) - failureRate(earlierRuns)) * 100);
  if (Math.abs(delta) < 15) {
    return { direction: 'steady', delta: 0 };
  }
  return { direction: delta > 0 ? 'rising' : 'falling', delta: Math.abs(delta) };
}

function getRunTimestamp(run: Pick<RunDetail, 'startedAt'>): number {
  const timestamp = Date.parse(run.startedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareRuns(current: RunDetail, baseline: RunDetail): RunComparison {
  const baselineSteps = new Map(baseline.steps.map((step) => [step.stepId, step]));
  const comparableSteps = current.steps.filter((step) => baselineSteps.has(step.stepId));
  const changedSteps = comparableSteps.filter((step) => baselineSteps.get(step.stepId)?.status !== step.status).length;

  return {
    changedSteps,
    totalComparableSteps: comparableSteps.length,
    artifactDelta: current.artifacts.length - baseline.artifacts.length,
  };
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

function formatChartEvidence(chart: {
  tooltip?: string;
  dataPoints?: Array<{ series?: string; label?: string; value: number }>;
  seriesTrends?: Array<{ series: string; trend: 'rising' | 'falling' | 'flat' | 'mixed' }>;
  trend?: 'rising' | 'falling' | 'flat' | 'mixed';
}, t: Translator): string | undefined {
  const signals = [
    chart.tooltip ? t('runs.agent.chartTooltip', { tooltip: chart.tooltip }) : undefined,
    chart.dataPoints?.length
      ? t('runs.agent.chartData', {
          points: chart.dataPoints
            .map((point) => `${point.series ? `${point.series} / ` : ''}${point.label ? `${point.label} = ` : ''}${point.value}`)
            .join(' / '),
        })
      : undefined,
    chart.seriesTrends?.length
      ? t('runs.agent.chartSeriesTrends', {
          trends: chart.seriesTrends
            .map((seriesTrend) => `${seriesTrend.series} ${t(`runs.agent.chartTrend.${seriesTrend.trend}`)}`)
            .join(' / '),
        })
      : undefined,
    chart.trend ? t('runs.agent.chartTrend', { trend: t(`runs.agent.chartTrend.${chart.trend}`) }) : undefined,
  ].filter(Boolean);
  return signals.length ? signals.join(' · ') : undefined;
}

function formatAgentRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getAgentSourceLabel(agentRun: AgentRunResult, t: Translator): string {
  return t(`runs.agent.source.${agentRun.intent.source}`);
}

function getLinkedArtifacts(event: AgentRunEvent, agentRun: AgentRunResult): AgentArtifact[] {
  const seen = new Set<string>();
  const relatedEvents = agentRun.events.filter((candidate) =>
    candidate.artifact && (candidate.id === event.id || (event.stepId && candidate.stepId === event.stepId)),
  );

  return relatedEvents.flatMap((candidate) => (candidate.artifact ? [candidate.artifact] : [])).filter((artifact) => {
    if (seen.has(artifact.id)) {
      return false;
    }

    seen.add(artifact.id);
    return true;
  });
}

function getLinkedEvidence(events: AgentRunEvent[], selected: AgentRunEvent): {
  observation?: AgentRunEvent['observation'];
  verification?: AgentRunEvent['verification'];
  browserSession?: AgentRunEvent['browserSession'];
} {
  const relatedEvents = selected.stepId
    ? events.filter((event) => event.stepId === selected.stepId)
    : [selected];

  return {
    observation: selected.observation ?? relatedEvents.find((event) => event.observation)?.observation,
    verification: selected.verification ?? relatedEvents.find((event) => event.verification)?.verification,
    browserSession: selected.browserSession ?? relatedEvents.find((event) => event.browserSession)?.browserSession,
  };
}

function getEvidencePreviewPath(event: AgentRunEvent, artifacts: AgentArtifact[]): string | undefined {
  if (event.browserSession?.screenshotPath) {
    return event.browserSession.screenshotPath;
  }

  return artifacts.find((artifact) => artifact.type === 'screenshot' || artifact.type === 'snapshot')?.path;
}

export function RunRecordsPage({
  project,
  projectAssetBinding,
  recentRuns,
  runDetails,
  selectedRunId,
  onSelectRun,
  onCreateReporterFixDraft,
  onExportProjectReport,
  onCancelRun,
  onRerunTestCase,
  isRunning = false,
  onAttachManualEvidence,
  onCaptureManualEvidence,
  onConfirmManualStep = () => {},
}: {
  project?: ProjectDraft;
  projectAssetBinding?: ProjectAssetBinding;
  recentRuns: RunSummary[];
  runDetails: RunDetail[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  onCreateReporterFixDraft?: (run: RunDetail, reporter: AgentReporterSummary) => void;
  onExportProjectReport?: () => Promise<void>;
  onCancelRun?: (runId: string) => Promise<void>;
  onRerunTestCase?: (run: RunDetail) => void;
  isRunning?: boolean;
  onAttachManualEvidence?: (runId: string, stepId: string) => Promise<RunArtifact | undefined>;
  onCaptureManualEvidence?: (runId: string, stepId: string) => Promise<string | undefined>;
  onConfirmManualStep?: (
    runId: string,
    stepId: string,
    status: 'passed' | 'failed',
    note: string,
    screenshotPath?: string,
    attachments?: RunArtifact[],
  ) => void;
}) {
  const { t } = useI18n();
  const isProjectBound = Boolean(project && projectAssetBinding?.projectId === project.id);
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'passed' | 'failed' | 'neutral'>('all');
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [testCaseFilter, setTestCaseFilter] = useState<string>('all');
  const [comparisonRunId, setComparisonRunId] = useState<string>('');
  const [selectedEvidenceEventId, setSelectedEvidenceEventId] = useState<string>('');
  const [selectedAgentRunId, setSelectedAgentRunId] = useState<string>('');
  const [manualNotes, setManualNotes] = useState<Record<string, string>>({});
  const [manualEvidenceSnapshots, setManualEvidenceSnapshots] = useState<Record<string, string>>({});
  const [manualEvidenceAttachments, setManualEvidenceAttachments] = useState<Record<string, RunArtifact[]>>({});
  const [attachingManualEvidence, setAttachingManualEvidence] = useState<Record<string, boolean>>({});
  const [capturingManualEvidence, setCapturingManualEvidence] = useState<Record<string, boolean>>({});
  const [isExportingProjectReport, setIsExportingProjectReport] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string>('');
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
        if (testCaseFilter !== 'all' && run.testCaseId !== testCaseFilter) {
          return false;
        }
        if (!project || groupFilter === 'all') {
          return true;
        }

        const testCase = project.testCases.find((item) => item.id === run.testCaseId);
        return testCase?.groupId === groupFilter;
      }),
    [environmentFilter, groupFilter, project, projectRuns, statusFilter, testCaseFilter],
  );
  const selectedRun =
    runDetails.find((run) => run.id === selectedRunId) ??
    runDetails.find((run) => run.id === visibleRuns[0]?.id);
  const activeRun = projectRuns.find((run) => run.status === 'running');
  const selectedPrdDocumentName = selectedRun ? getRunPrdDocumentName(project, selectedRun) : undefined;
  const rerunTestCase = selectedRun
    ? project?.testCases.find((testCase) => testCase.id === selectedRun.testCaseId)
    : undefined;
  const isSelectedRunRerunnable = Boolean(
    rerunTestCase && project?.environments.some((environment) => environment.id === selectedRun?.environmentId),
  );
  const selectedAgentRuns = [
    ...(selectedRun?.agentRun ? [selectedRun.agentRun] : []),
    ...(selectedRun?.agentRuns ?? []),
  ];
  const selectedAgentRun = selectedAgentRuns.find((agentRun) => agentRun.runId === selectedAgentRunId)
    ?? selectedAgentRuns[0];
  const reporterFixDraftSource = selectedRun
    ? project?.testCases.find((testCase) => testCase.id === selectedRun.testCaseId)
    : undefined;
  const reporterFixDraft = selectedAgentRun?.reporter;
  const canCreateRecoveryDraft = canCreateReporterFixDraft(reporterFixDraftSource, reporterFixDraft);
  const selectedEvidenceEvent = selectedAgentRun?.events.find((event) => event.id === selectedEvidenceEventId)
    ?? selectedAgentRun?.events.find((event) => event.observation || event.verification || event.artifact || event.browserSession);
  const linkedEvidenceArtifacts = selectedAgentRun && selectedEvidenceEvent
    ? getLinkedArtifacts(selectedEvidenceEvent, selectedAgentRun)
    : [];
  const linkedEvidence = selectedAgentRun && selectedEvidenceEvent
    ? getLinkedEvidence(selectedAgentRun.events, selectedEvidenceEvent)
    : {};
  const evidencePreviewPath = linkedEvidence.browserSession?.screenshotPath
    ?? (selectedEvidenceEvent ? getEvidencePreviewPath(selectedEvidenceEvent, linkedEvidenceArtifacts) : undefined);
  const selectedObservation = selectedAgentRun?.events.find((event) => event.type === 'agent:observation-created')?.observation;
  const selectedVerification = selectedAgentRun?.events.find((event) => event.type === 'agent:assertion-result')?.verification;
  const selectedEvidenceArtifacts = (selectedAgentRun?.artifacts ?? selectedRun?.artifacts ?? []).filter((artifact) =>
    ['screenshot', 'snapshot', 'trace', 'report', 'attachment'].includes(artifact.type),
  );
  const comparisonCandidates = useMemo(
    () =>
      selectedRun
        ? runDetails
            .filter(
              (run) =>
                run.id !== selectedRun.id &&
                run.projectId === selectedRun.projectId &&
                run.testCaseId === selectedRun.testCaseId &&
                run.environmentId === selectedRun.environmentId,
            )
            .sort((left, right) => getRunTimestamp(right) - getRunTimestamp(left))
        : [],
    [runDetails, selectedRun],
  );
  const comparisonRun = comparisonCandidates.find((run) => run.id === comparisonRunId) ?? comparisonCandidates[0];
  const runComparison = selectedRun && comparisonRun ? compareRuns(selectedRun, comparisonRun) : undefined;
  const manualStepIds = new Set(
    project?.testCases
      .find((testCase) => testCase.id === selectedRun?.testCaseId)
      ?.steps.filter((step) => step.type === 'manual')
      .map((step) => step.id) ?? [],
  );
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
    const clusters = new Map<string, FailureCluster>();
    runDetails
      .filter((detail) => failedRunIds.has(detail.id))
      .forEach((detail) => {
        const reason = getFailureReason(detail);
        if (!reason) {
          return;
        }
        const key = normalizeFailureReason(reason);
        const cluster = clusters.get(key) ?? { reason, count: 0 };
        cluster.count += 1;
        clusters.set(key, cluster);
      });

    return {
      passRate,
      healthLabel: getHealthLabel(runStats.total, runStats.failed, runStats.running, t),
      latestFailureReason: latestFailure?.failureReason ?? '',
      worstGroup: getWorstBucket([...groupBuckets.values()]),
      worstEnvironment: getWorstBucket([...environmentBuckets.values()]),
      failureClusters: [...clusters.values()].sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)).slice(0, 3),
      failureTrend: getFailureTrend(visibleRuns),
    };
  }, [project, runDetails, runStats.failed, runStats.passed, runStats.running, runStats.total, t, visibleRuns]);
  const coverageRisk = useMemo(
    () => (project ? deriveRunCoverageRisk(project, recentRuns) : undefined),
    [project, recentRuns],
  );

  return (
    <PageShell>
      <PageHeader
        action={
          onExportProjectReport || (activeRun && onCancelRun) || (selectedRun && onRerunTestCase && isSelectedRunRerunnable) ? (
            <div className="flex items-center gap-2">
              {onExportProjectReport ? (
                <button
                  aria-label={t('runs.exportProjectReport')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
                  disabled={isExportingProjectReport}
                  onClick={() => {
                    setIsExportingProjectReport(true);
                    void onExportProjectReport().finally(() => setIsExportingProjectReport(false));
                  }}
                  title={t('runs.exportProjectReport')}
                  type="button"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isExportingProjectReport ? t('runs.exportProjectReportWorking') : t('runs.exportProjectReport')}
                </button>
              ) : null}
              {activeRun && onCancelRun ? (
                <button
                  aria-label={t('runs.cancelRun')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-destructive/35 px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-45"
                  disabled={Boolean(cancellingRunId)}
                  onClick={() => {
                    setCancellingRunId(activeRun.id);
                    void onCancelRun(activeRun.id).finally(() => setCancellingRunId(''));
                  }}
                  title={t('runs.cancelRun')}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                  {cancellingRunId === activeRun.id ? t('runs.cancelRunWorking') : t('runs.cancelRun')}
                </button>
              ) : null}
              {selectedRun && onRerunTestCase && isSelectedRunRerunnable ? (
                <button
                  aria-label={t('runs.rerun.currentCaseLegacy')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
                  disabled={isRunning || selectedRun.status === 'running'}
                  onClick={() => onRerunTestCase(selectedRun)}
                  title={t('runs.rerun.currentCaseLegacy')}
                  type="button"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t('runs.rerun.currentCaseLegacy')}
                </button>
              ) : null}
            </div>
          ) : undefined
        }
        meta={[
          t('runs.meta.total', { count: runStats.total }),
          t('runs.meta.passed', { count: runStats.passed }),
          t('runs.meta.failed', { count: runStats.failed }),
          t('runs.meta.running', { count: runStats.running }),
          ...(project && !isProjectBound ? [t('project.assets.legacy')] : []),
        ].map((item) => (
          <Badge className="page-header-meta" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('runs.header.title')}
      />

      <PageBody>
      {selectedRun && onRerunTestCase ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('runs.rerun.legacyUnavailable')}
        </p>
      ) : null}
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
            <div className="run-filter-pair grid min-w-0 gap-2">
              <Select onValueChange={(value) => setGroupFilter(value)} value={groupFilter}>
                <SelectTrigger aria-label={t('runs.filter.group')} className="rounded-[4px]"><SelectValue placeholder={t('runs.filter.group')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('runs.filter.allGroups')}</SelectItem>
                  {project?.groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select onValueChange={(value) => setEnvironmentFilter(value)} value={environmentFilter}>
                <SelectTrigger aria-label={t('runs.filter.environment')} className="rounded-[4px]"><SelectValue placeholder={t('runs.filter.environment')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('runs.filter.allEnvironments')}</SelectItem>
                  {project?.environments.map((environment) => (
                    <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select onValueChange={(value) => setTestCaseFilter(value)} value={testCaseFilter}>
              <SelectTrigger aria-label={t('runs.filter.testCase')} className="rounded-[4px]"><SelectValue placeholder={t('runs.filter.testCase')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('runs.filter.allTestCases')}</SelectItem>
                {project?.testCases.map((testCase) => (
                  <SelectItem key={testCase.id} value={testCase.id}>{testCase.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                {getRunPrdDocumentName(project, run) ? (
                  <span className="mt-1.5 inline-flex">
                    <Badge className="rounded-[4px]" variant="outline">
                      {t('runs.prd.source', { name: getRunPrdDocumentName(project, run)! })}
                    </Badge>
                  </span>
                ) : null}
              </button>
            ))}
            {!visibleRuns.length ? (
              <EvidenceCard title={t('runs.empty.title')} description={t('runs.empty.description')} />
            ) : null}
          </div>
        </aside>

        <section className="designer-panel designer-detail-stage run-detail-stage min-w-0">
          <div className="run-quality-grid grid gap-3">
            <Surface className="run-quality-primary p-5" variant="stat">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t('runs.quality.eyebrow')}</p>
                  <p className="run-quality-value mt-2 font-semibold">{runAnalytics.passRate}%</p>
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
          {project && coverageRisk ? (
            <Surface aria-label={t('runs.coverage.title')} className="mt-5 p-4" variant="subtle">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-2 text-xs font-medium text-primary">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t('runs.coverage.eyebrow')}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold">{t('runs.coverage.title')}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {t('runs.coverage.verified', { verified: coverageRisk.verified, total: coverageRisk.total })}
                  </Badge>
                  <Badge variant="outline">{t('runs.coverage.atRisk', { count: coverageRisk.risks.length })}</Badge>
                </div>
              </div>
              {coverageRisk.risks.length ? (
                <div className="mt-3 grid gap-2">
                  {coverageRisk.risks.map((risk) => {
                    const testCase = project.testCases.find((item) => item.id === risk.testCaseId);
                    const group = project.groups.find((item) => item.id === risk.groupId);
                    const environment = project.environments.find((item) => item.id === risk.environmentId);
                    const statusLabel = risk.latestRun
                      ? t(`common.status.${risk.latestRun.status}`)
                      : t('runs.coverage.neverExecuted');
                    return (
                      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border/70 pt-2 first:border-t-0 first:pt-0" key={`${risk.testCaseId}-${risk.environmentId}`}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{testCase?.name ?? risk.testCaseId}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t('runs.coverage.scope', {
                              group: group?.name ?? t('runs.value.ungrouped'),
                              environment: environment?.name ?? t('runs.value.environmentMissing'),
                            })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{t('runs.coverage.latest', { status: statusLabel })}</span>
                          <StatusPill tone={risk.status === 'neverExecuted' ? 'neutral' : risk.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{t('runs.coverage.empty')}</p>
              )}
            </Surface>
          ) : null}
          {selectedRun ? (
            <div className="mt-5 grid gap-5">
              <div className="grid gap-3 md:grid-cols-4">
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
                  <InsightCard
                    icon={
                      runAnalytics.failureTrend?.direction === 'falling'
                        ? <TrendingDown className="h-4 w-4" />
                        : runAnalytics.failureTrend?.direction === 'rising'
                          ? <TrendingUp className="h-4 w-4" />
                          : <Gauge className="h-4 w-4" />
                    }
                    label={t('runs.insight.failureTrend')}
                    tone={
                      runAnalytics.failureTrend?.direction === 'rising'
                        ? 'failed'
                        : runAnalytics.failureTrend?.direction === 'falling'
                          ? 'passed'
                          : 'neutral'
                    }
                    value={
                      runAnalytics.failureTrend
                        ? t(`runs.trend.${runAnalytics.failureTrend.direction}`, { delta: runAnalytics.failureTrend.delta })
                        : t('runs.trend.insufficient')
                    }
                  />
              </div>

              {runAnalytics.latestFailureReason ? (
                <div className="rounded-[6px] bg-destructive/10 p-4 text-sm leading-7 text-foreground">
                  {t('runs.failure.latest', { reason: runAnalytics.latestFailureReason })}
                </div>
              ) : null}

              {runAnalytics.failureClusters.length ? (
                <section aria-label={t('runs.failure.clusters')} className="border-y border-border/70 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      {t('runs.failure.clusters')}
                    </p>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {t('runs.failure.clusterCount', { count: runAnalytics.failureClusters.length })}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2">
                    {runAnalytics.failureClusters.map((cluster) => (
                      <div className="flex min-w-0 items-start justify-between gap-4" key={normalizeFailureReason(cluster.reason)}>
                        <p className="min-w-0 truncate text-sm text-foreground" title={cluster.reason}>{cluster.reason}</p>
                        <span className="shrink-0 rounded-[4px] bg-destructive/10 px-2 py-0.5 font-mono text-[11px] text-destructive">
                          {t('runs.failure.clusterOccurrences', { count: cluster.count })}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="grid gap-3 md:grid-cols-4">
                <MetricTile label={t('runs.metric.status')} value={t(`common.status.${selectedRun.status}`)} />
                <MetricTile label={t('runs.metric.duration')} value={selectedRun.duration} />
                <MetricTile label={t('runs.metric.steps')} value={`${selectedRun.steps.length}`} />
                <MetricTile label={t('runs.metric.artifacts')} value={`${selectedRun.artifacts.length}`} />
              </div>
              {selectedPrdDocumentName ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('runs.prd.source', { name: selectedPrdDocumentName })}
                </p>
              ) : null}
              {comparisonRun && runComparison ? (
                <Surface aria-label={t('runs.compare.aria')} className="p-4" variant="subtle">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="inline-flex items-center gap-2 text-xs font-medium text-primary">
                        <GitCompareArrows className="h-3.5 w-3.5" />
                        {t('runs.compare.eyebrow')}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold">{t('runs.compare.title')}</h3>
                    </div>
                    {comparisonCandidates.length > 1 ? (
                      <Select onValueChange={setComparisonRunId} value={comparisonRun.id}>
                        <SelectTrigger aria-label={t('runs.compare.select')} className="w-52 rounded-[4px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {comparisonCandidates.map((run) => (
                            <SelectItem key={run.id} value={run.id}>
                              {t('runs.compare.option', { title: run.title, duration: run.duration })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[4px] border border-border/70 bg-background/55 p-3">
                      <p className="text-xs text-muted-foreground">{t('runs.compare.current')}</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium">{selectedRun.title}</p>
                        <StatusPill tone={selectedRun.status} />
                      </div>
                    </div>
                    <div className="rounded-[4px] border border-border/70 bg-background/55 p-3">
                      <p className="text-xs text-muted-foreground">{t('runs.compare.baseline')}</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium">{comparisonRun.title}</p>
                        <StatusPill tone={comparisonRun.status} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <p>{t('runs.compare.status', { before: t(`common.status.${comparisonRun.status}`), after: t(`common.status.${selectedRun.status}`) })}</p>
                    <p>{t('runs.compare.steps', { changed: runComparison.changedSteps, total: runComparison.totalComparableSteps })}</p>
                    <p>{t('runs.compare.artifacts', { delta: runComparison.artifactDelta })}</p>
                    <p className="sm:col-span-3">{t('runs.compare.duration', { before: comparisonRun.duration, after: selectedRun.duration })}</p>
                  </div>
                </Surface>
              ) : null}
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
                  {selectedAgentRuns.length > 1 ? (
                    <div aria-label={t('runs.agent.segments')} className="flex flex-wrap gap-2" role="tablist">
                      {selectedAgentRuns.map((agentRun, index) => {
                        const selected = agentRun.runId === selectedAgentRun.runId;
                        const parentRun = agentRun.runId === selectedRun?.agentRun?.runId;
                        return (
                          <button
                            aria-selected={selected}
                            className={`inline-flex h-8 items-center gap-2 rounded-[4px] border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 ${
                              selected
                                ? 'border-primary/45 bg-primary/10 text-primary'
                                : 'border-border bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}
                            key={agentRun.runId}
                            onClick={() => {
                              setSelectedAgentRunId(agentRun.runId);
                              setSelectedEvidenceEventId('');
                            }}
                            role="tab"
                            type="button"
                          >
                            <span>{parentRun ? t('runs.agent.parentSegment') : t('runs.agent.segment', { index: selectedRun?.agentRun ? index : index + 1 })}</span>
                            <span className="max-w-32 truncate">{getAgentSourceLabel(agentRun, t)}</span>
                            <StatusPill tone={agentRun.status} />
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
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
                  {reporterFixDraft ? (
                    <Surface className="p-4" variant="evidence">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="inline-flex items-center gap-2 text-xs font-medium text-primary">
                            <BrainCircuit className="h-3.5 w-3.5" />
                            {t('runs.reporter.eyebrow')}
                          </p>
                          <h4 className="mt-1 text-sm font-semibold">{t('runs.reporter.title')}</h4>
                        </div>
                        {onCreateReporterFixDraft && canCreateRecoveryDraft ? (
                          <button
                            aria-label={t('runs.reporter.createFixDraft')}
                            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                            onClick={() => onCreateReporterFixDraft(selectedRun!, reporterFixDraft)}
                            title={t('runs.reporter.createFixDraft')}
                            type="button"
                          >
                            <FilePenLine className="h-3.5 w-3.5" />
                            {t('runs.reporter.createFixDraft')}
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">{reporterFixDraft.failureAnalysis}</p>
                      {reporterFixDraft.recoveryPlan ? (
                        <div className="mt-3 grid gap-1.5 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{t('runs.reporter.recoveryPlan')}</span>
                            <Badge variant="outline">
                              {t(`runs.reporter.recovery.${reporterFixDraft.recoveryPlan.strategy}`)}
                            </Badge>
                          </div>
                          <p>{t('runs.reporter.recoverySource')}</p>
                          <p>{t('runs.reporter.recoveryReason', { reason: reporterFixDraft.recoveryPlan.reason })}</p>
                          {reporterFixDraft.recoveryPlan.selector || reporterFixDraft.recoveryPlan.urlPattern ? (
                            <p>
                              {t('runs.reporter.recoveryTarget', {
                                target: reporterFixDraft.recoveryPlan.selector ?? reporterFixDraft.recoveryPlan.urlPattern ?? '',
                              })}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-3 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
                          {t('runs.reporter.recoveryUnavailable')}
                        </p>
                      )}
                      {reporterFixDraft.suggestedFixes.length ? (
                        <ul className="mt-3 grid gap-1.5 border-t border-border/70 pt-3 text-sm leading-6 text-foreground">
                          {reporterFixDraft.suggestedFixes.map((fix, index) => (
                            <li className="flex gap-2" key={`${index}-${fix}`}>
                              <span className="font-mono text-xs text-primary">{String(index + 1).padStart(2, '0')}</span>
                              <span>{fix}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
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
                              {table.filters?.length ? (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {t('runs.agent.filters', { states: table.filters.map((filter) => `${filter.label} = ${filter.value}`).join(' / ') })}
                                </p>
                              ) : null}
                              {table.pagination ? (
                                <p className="truncate font-mono text-[11px] text-muted-foreground">
                                  {t('runs.agent.pagination', {
                                    currentPage: table.pagination.currentPage ?? '-',
                                    totalPages: table.pagination.totalPages ?? '-',
                                    totalItems: table.pagination.totalItems ?? '-',
                                    pageSize: table.pagination.pageSize ?? '-',
                                  })}
                                </p>
                              ) : null}
                              {table.aggregates?.length ? (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {t('runs.agent.aggregates', {
                                    states: table.aggregates.map((aggregate) => `${aggregate.label} = ${aggregate.value}`).join(' / '),
                                  })}
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
                              {formatChartEvidence(chart, t) ? (
                                <p className="truncate font-mono text-[11px] text-muted-foreground">{formatChartEvidence(chart, t)}</p>
                              ) : null}
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
                  {selectedEvidenceEvent ? (
                    <Surface className="p-4" variant="evidence">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">{t('runs.agent.trailEyebrow')}</p>
                          <h4 className="mt-1 text-sm font-semibold">{t('runs.agent.trailTitle')}</h4>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedEvidenceEvent.message}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="rounded-[4px]" variant="outline">{selectedEvidenceEvent.type}</Badge>
                          <StatusPill tone={selectedEvidenceEvent.status} />
                        </div>
                      </div>
                      {selectedEvidenceEvent.metrics && formatEventMetrics(selectedEvidenceEvent.metrics, t) ? (
                        <div className="mt-3 inline-flex items-center gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                          <Cpu className="h-3.5 w-3.5 text-primary" />
                          <span className="font-medium text-foreground">{t('runs.agent.eventMetrics')}</span>
                          <span>{formatEventMetrics(selectedEvidenceEvent.metrics, t)}</span>
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(208px,0.62fr)]">
                        <div className="grid content-start gap-3">
                          {linkedEvidence.observation ? (
                            <EvidenceTrailBlock
                              label={t('runs.agent.trailObservation')}
                              value={
                                linkedEvidence.observation.textSummary ||
                                linkedEvidence.observation.domSummary ||
                                t('runs.agent.summaryMissing')
                              }
                            />
                          ) : null}
                          {linkedEvidence.verification ? (
                            <EvidenceTrailBlock
                              label={t('runs.agent.trailVerification')}
                              value={linkedEvidence.verification.evidence || linkedEvidence.verification.summary}
                            />
                          ) : null}
                          {linkedEvidence.browserSession?.currentUrl ? (
                            <EvidenceTrailBlock label={t('runs.agent.trailBrowser')} value={linkedEvidence.browserSession.currentUrl} />
                          ) : null}
                          {linkedEvidenceArtifacts.length ? (
                            <div className="grid gap-2">
                              <p className="text-xs font-medium text-muted-foreground">{t('runs.agent.trailFiles')}</p>
                              <div className="flex flex-wrap gap-2">
                                {linkedEvidenceArtifacts.map((artifact) => (
                                  <ArtifactActions artifact={artifact} key={artifact.id} t={t} />
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {!linkedEvidence.observation && !linkedEvidence.verification && !linkedEvidence.browserSession && !linkedEvidenceArtifacts.length ? (
                            <p className="text-sm text-muted-foreground">{t('runs.agent.trailNoDetail')}</p>
                          ) : null}
                        </div>
                        {evidencePreviewPath ? (
                          <img
                            alt={t('runs.agent.trailPreview')}
                            className="aspect-video w-full rounded-[6px] border border-border bg-background object-cover"
                            src={`file://${evidencePreviewPath}`}
                          />
                        ) : (
                          <div className="flex aspect-video items-center justify-center rounded-[6px] border border-dashed border-border bg-background/60 text-muted-foreground">
                            <Image className="h-5 w-5" aria-hidden="true" />
                            <span className="sr-only">{t('runs.agent.trailNoPreview')}</span>
                          </div>
                        )}
                      </div>
                    </Surface>
                  ) : null}
                  <Surface className="p-4" variant="subtle">
                    <div className="flex items-center gap-2">
                      <TerminalSquare className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">{t('runs.agent.events')}</p>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {selectedAgentRun.events.map((event) => (
                        <button
                          aria-label={t('runs.agent.inspectEvent', { type: event.type })}
                          className={`grid gap-1 rounded-[6px] bg-background/70 p-3 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 ${selectedEvidenceEvent?.id === event.id ? 'ring-1 ring-primary/45' : ''}`}
                          key={event.id}
                          onClick={() => setSelectedEvidenceEventId(event.id)}
                          type="button"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="rounded-[4px]" variant="outline">{event.type}</Badge>
                            <StatusPill tone={event.status} />
                            <LocateFixed className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">{event.message}</p>
                          {event.metrics && formatEventMetrics(event.metrics, t) ? (
                            <p className="font-mono text-[11px] leading-4 text-muted-foreground">
                              {t('runs.agent.eventMetrics')} · {formatEventMetrics(event.metrics, t)}
                            </p>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </Surface>
                </section>
              ) : null}
              <div className="grid gap-3">
                {selectedRun.steps.map((step) => {
                  const manualEvidence = selectedRun.manualEvidence?.find((evidence) => evidence.stepId === step.stepId);
                  const isManualStep = manualStepIds.has(step.stepId);
                  const manualEvidenceKey = `${selectedRun.id}:${step.stepId}`;
                  const note = manualNotes[step.stepId] ?? '';
                  const screenshotPath = manualEvidence?.screenshotPath ?? manualEvidenceSnapshots[manualEvidenceKey];
                  const isCapturingEvidence = capturingManualEvidence[manualEvidenceKey] ?? false;
                  const attachments = manualEvidence?.attachments ?? manualEvidenceAttachments[manualEvidenceKey] ?? [];
                  const isAttachingEvidence = attachingManualEvidence[manualEvidenceKey] ?? false;
                  const isPreparingEvidence = isCapturingEvidence || isAttachingEvidence;
                  const submitManualConfirmation = (status: 'passed' | 'failed') => {
                    if (attachments.length) {
                      onConfirmManualStep(selectedRun.id, step.stepId, status, note.trim(), screenshotPath, attachments);
                    } else if (screenshotPath) {
                      onConfirmManualStep(selectedRun.id, step.stepId, status, note.trim(), screenshotPath);
                    } else {
                      onConfirmManualStep(selectedRun.id, step.stepId, status, note.trim());
                    }
                    setManualEvidenceSnapshots((current) => {
                      const next = { ...current };
                      delete next[manualEvidenceKey];
                      return next;
                    });
                    setManualEvidenceAttachments((current) => {
                      const next = { ...current };
                      delete next[manualEvidenceKey];
                      return next;
                    });
                  };
                  return (
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
                    {isManualStep ? (
                      <div className="mt-3 border-t border-border/70 pt-3">
                        {manualEvidence ? (
                          <div className="grid gap-3">
                            <p className="text-xs leading-5 text-muted-foreground">
                              {t('runs.manual.confirmed', { status: t(`common.status.${manualEvidence.status}`), note: manualEvidence.note })}
                            </p>
                            {manualEvidence.screenshotPath ? (
                              <div className="grid gap-2">
                                <img
                                  alt={t('runs.manual.snapshotAlt', { title: step.title })}
                                  className="aspect-video w-full rounded-[6px] border border-border object-cover"
                                  src={`file://${manualEvidence.screenshotPath}`}
                                />
                                <p className="truncate text-xs text-muted-foreground" title={manualEvidence.screenshotPath}>{manualEvidence.screenshotPath}</p>
                              </div>
                            ) : null}
                            {manualEvidence.attachments?.length ? (
                              <div className="grid gap-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                  {t('runs.manual.attachments', { count: manualEvidence.attachments.length })}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {manualEvidence.attachments.map((attachment) => (
                                    <ArtifactActions artifact={attachment} key={attachment.id} t={t} />
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : step.status === 'neutral' ? (
                          <div className="grid gap-2">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <textarea
                                aria-label={t('runs.manual.noteLabel', { title: step.title })}
                                className="min-h-9 flex-1 resize-y rounded-[4px] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/35"
                                onChange={(event) => setManualNotes((current) => ({ ...current, [step.stepId]: event.target.value }))}
                                placeholder={t('runs.manual.notePlaceholder')}
                                value={note}
                              />
                              <div className="flex shrink-0 gap-2">
                                {onCaptureManualEvidence ? (
                                  <button
                                    className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
                                    disabled={isPreparingEvidence}
                                    onClick={() => {
                                      setCapturingManualEvidence((current) => ({ ...current, [manualEvidenceKey]: true }));
                                      void onCaptureManualEvidence(selectedRun.id, step.stepId)
                                        .then((capturedPath) => {
                                          if (capturedPath) {
                                            setManualEvidenceSnapshots((current) => ({ ...current, [manualEvidenceKey]: capturedPath }));
                                          }
                                        })
                                        .catch(() => undefined)
                                        .finally(() => {
                                          setCapturingManualEvidence((current) => ({ ...current, [manualEvidenceKey]: false }));
                                        });
                                    }}
                                    type="button"
                                  >
                                    <Camera className="h-3.5 w-3.5" />
                                    {isCapturingEvidence ? t('runs.manual.capturing') : t('runs.manual.capture')}
                                  </button>
                                ) : null}
                                {onAttachManualEvidence ? (
                                  <button
                                    aria-label={t('runs.manual.attach')}
                                    className="inline-flex size-9 items-center justify-center rounded-[4px] border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
                                    disabled={isPreparingEvidence}
                                    onClick={() => {
                                      setAttachingManualEvidence((current) => ({ ...current, [manualEvidenceKey]: true }));
                                      void onAttachManualEvidence(selectedRun.id, step.stepId)
                                        .then((attachment) => {
                                          if (attachment) {
                                            setManualEvidenceAttachments((current) => {
                                              const existing = current[manualEvidenceKey] ?? [];
                                              return existing.some((item) => item.id === attachment.id)
                                                ? current
                                                : { ...current, [manualEvidenceKey]: [...existing, attachment] };
                                            });
                                          }
                                        })
                                        .catch(() => undefined)
                                        .finally(() => {
                                          setAttachingManualEvidence((current) => ({ ...current, [manualEvidenceKey]: false }));
                                        });
                                    }}
                                    title={t('runs.manual.attach')}
                                    type="button"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                                <button
                                  className="inline-flex h-9 items-center gap-1.5 rounded-[4px] bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-45"
                                  disabled={!note.trim() || isPreparingEvidence}
                                  onClick={() => submitManualConfirmation('passed')}
                                  type="button"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {t('runs.manual.pass')}
                                </button>
                                <button
                                  className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-destructive/30 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-45"
                                  disabled={!note.trim() || isPreparingEvidence}
                                  onClick={() => submitManualConfirmation('failed')}
                                  type="button"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {t('runs.manual.fail')}
                                </button>
                              </div>
                            </div>
                            {screenshotPath ? (
                              <div className="grid gap-2 rounded-[4px] border border-border/70 bg-background/50 p-2">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Camera className="h-3.5 w-3.5 text-primary" />
                                  {t('runs.manual.snapshotReady')}
                                </div>
                                <img
                                  alt={t('runs.manual.snapshotAlt', { title: step.title })}
                                  className="aspect-video w-full rounded-[4px] border border-border object-cover"
                                  src={`file://${screenshotPath}`}
                                />
                              </div>
                            ) : null}
                            {attachments.length ? (
                              <div className="grid gap-2 rounded-[4px] border border-border/70 bg-background/50 p-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                  {t('runs.manual.attachments', { count: attachments.length })}
                                </p>
                                <div className="grid gap-1.5">
                                  {attachments.map((attachment) => (
                                    <div className="flex min-w-0 items-center gap-2" key={attachment.id}>
                                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={attachment.path}>
                                        {attachment.label}
                                      </span>
                                      <button
                                        aria-label={t('runs.manual.removeAttachment', { name: attachment.label })}
                                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                                        onClick={() => {
                                          setManualEvidenceAttachments((current) => ({
                                            ...current,
                                            [manualEvidenceKey]: (current[manualEvidenceKey] ?? []).filter((item) => item.id !== attachment.id),
                                          }));
                                        }}
                                        title={t('runs.manual.removeAttachment', { name: attachment.label })}
                                        type="button"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                  );
                })}
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

        <aside className="designer-panel run-evidence-rail" aria-label={t('runs.agent.evidenceNavigator')}>
          <header className="designer-panel-header">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{t('runs.agent.evidenceNavigator')}</h2>
              {selectedAgentRun ? <StatusPill tone={selectedAgentRun.status} /> : null}
            </div>
          </header>
          <div className="run-evidence-body">
            {selectedAgentRun?.events.slice(0, 5).map((event, index) => (
              <button
                className={`run-evidence-event ${event.id === selectedEvidenceEventId ? 'is-selected' : ''}`}
                key={event.id}
                onClick={() => setSelectedEvidenceEventId(event.id)}
                type="button"
              >
                <span className="run-evidence-index">{index + 1}</span>
                <span>
                  <strong>{event.type}</strong>
                  <small>{event.message}</small>
                </span>
              </button>
            ))}
            {!selectedAgentRun?.events.length ? (
              <EvidenceCard title={t('runs.emptyResult.title')} description={t('runs.emptyResult.description')} />
            ) : null}

            <section className="run-evidence-artifacts">
              <p>{t('runs.agent.artifacts')}</p>
              {selectedEvidenceArtifacts.slice(0, 4).map((artifact) => (
                <span key={artifact.id}>{artifact.label}</span>
              ))}
              {!selectedEvidenceArtifacts.length ? <small>{t('runs.agent.noArtifacts')}</small> : null}
            </section>
          </div>
        </aside>
      </section>
      </PageBody>
    </PageShell>
  );
}

function EvidenceTrailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-[4px] bg-background/65 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="break-words text-xs leading-5 text-foreground">{value}</p>
    </div>
  );
}

function ArtifactActions({ artifact, t }: { artifact: AgentArtifact | RunArtifact; t: Translator }) {
  const isManagedArtifact = !artifact.path.startsWith('memory://');

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-[4px] border border-border bg-background/70 py-1 pl-2 pr-1">
      <span className="max-w-44 truncate text-xs text-foreground" title={artifact.path}>{artifact.label}</span>
      {isManagedArtifact ? (
        <>
          <button
            aria-label={t('runs.agent.openArtifact', { name: artifact.label })}
            className="inline-flex size-6 items-center justify-center rounded-[3px] text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            onClick={() => {
              void openArtifact(artifact.path);
            }}
            title={t('runs.agent.openArtifact', { name: artifact.label })}
            type="button"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label={t('runs.agent.exportArtifact', { name: artifact.label })}
            className="inline-flex size-6 items-center justify-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            onClick={() => {
              void exportArtifact(artifact.path);
            }}
            title={t('runs.agent.exportArtifact', { name: artifact.label })}
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
    </div>
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
