import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type {
  BrowserSessionState,
  ProjectDraft,
  RunSummary,
  RuntimeInfo,
} from '../../../shared/studio.js';
import type { AppPage } from '../../app/pageMeta.js';

import {
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  FileText,
  MousePointerClick,
  Plus,
  ScanSearch,
  ShieldCheck,
  Rocket,
  TerminalSquare,
  GitBranch,
  ServerCog,
} from 'lucide-react';

import { StatusPill } from '../../components/StatusPill.js';
import { PageBody, PageHeader, PageShell, Surface } from '../../components/workbench.js';
import { useI18n } from '../../i18n/index.js';

const getSignalSummary = (recentRuns: RunSummary[], t: (key: string) => string) => {
  const passed = recentRuns.filter((run) => run.status === 'passed').length;
  const failed = recentRuns.filter((run) => run.status === 'failed').length;
  const running = recentRuns.filter((run) => run.status === 'running').length;

  if (!recentRuns.length) {
    return {
      badge: t('home.signal.insufficient'),
      description: t('home.signal.insufficientDescription'),
      passed,
      failed,
      running,
    };
  }

  if (failed > passed) {
    return {
      badge: t('home.signal.risky'),
      description: t('home.signal.riskyDescription'),
      passed,
      failed,
      running,
    };
  }

  return {
    badge: t('home.signal.stable'),
    description: t('home.signal.stableDescription'),
    passed,
    failed,
    running,
  };
};

const getCoverageIndex = (projects: ProjectDraft[], runs: RunSummary[]): number => {
  const assetScore = projects.reduce(
    (total, project) =>
      total +
      project.groups.length * 6 +
      project.testCases.length * 8 +
      project.recordings.length * 10 +
      project.documents.length * 8,
    0,
  );
  const passScore = runs.length
    ? Math.round((runs.filter((run) => run.status === 'passed').length / runs.length) * 30)
    : 0;

  return Math.min(98, Math.max(12, assetScore + passScore));
};

const DashboardCard = ({
  children,
  className = '',
  action,
  ...props
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
} & ComponentPropsWithoutRef<'section'>) => {
  return (
    <section className={`home-stat-card ${className}`} {...props}>
      {children}
      {action ? <div className="mt-auto pt-4">{action}</div> : null}
    </section>
  );
};

const StatGlyph = ({
  children,
  tone = 'neutral',
  testId,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'risk';
  testId?: string;
}) => {
  return (
    <span className={`home-glyph home-glyph-${tone} flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border`} data-testid={testId}>
      {children}
    </span>
  );
};

const CompactStat = ({ label, value }: { label: string; value: string }) => {
  return (
    <span className="home-compact-stat rounded-[4px] px-3 py-2">
      <span className="home-compact-label block text-[11px]">{label}</span>
      <span className="home-compact-value mt-0.5 block truncate font-mono text-sm font-semibold">{value}</span>
    </span>
  );
};

export const HomePage = ({
  projects,
  browserSession,
  recentRuns,
  runtimeInfo,
  onCreateProject,
  onGoToPage,
}: {
  projects: ProjectDraft[];
  browserSession: BrowserSessionState;
  recentRuns: RunSummary[];
  runtimeInfo?: RuntimeInfo;
  onCreateProject: () => void;
  onGoToPage: (page: AppPage) => void;
}) => {
  const { t } = useI18n();
  const signal = getSignalSummary(recentRuns, t);

  if (!projects.length) {
    return (
      <section aria-label={t('home.empty.aria')} className="home-empty-shell">
        <main className="home-empty-main">
          <section className="home-empty-hero">
            <div className="home-empty-orb" aria-hidden="true">
              <div className="home-empty-rocket">
                <Rocket className="h-20 w-20" strokeWidth={2.4} />
              </div>
            </div>
            <p className="home-empty-kicker">{t('home.empty.kicker')}</p>
            <h1 className="home-empty-title">{t('home.empty.title')}</h1>
            <p className="home-empty-description">{t('home.empty.description')}</p>
            <button className="home-empty-cta" onClick={onCreateProject} type="button">
              <Plus className="h-5 w-5" />
              {t('home.empty.create')}
            </button>
          </section>

          <section className="home-empty-grid" aria-label={t('home.empty.discovery')}>
            {[
              {
                icon: FileText,
                title: t('home.empty.prd.title'),
                description: t('home.empty.prd.description'),
                action: t('home.empty.prd.action'),
                tone: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200',
                page: 'documents' as AppPage,
              },
              {
                icon: ServerCog,
                title: t('home.empty.nl.title'),
                description: t('home.empty.nl.description'),
                action: t('home.empty.nl.action'),
                tone: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
                page: 'nl' as AppPage,
              },
              {
                icon: MousePointerClick,
                title: t('home.empty.recording.title'),
                description: t('home.empty.recording.description'),
                action: t('home.empty.recording.action'),
                tone: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200',
                page: 'recording' as AppPage,
              },
            ].map((item) => {
              const FeatureIcon = item.icon;
              return (
                <button className="home-empty-card cursor-pointer text-left" key={item.title} onClick={() => onGoToPage(item.page)} type="button">
                  <span className={`home-empty-icon ${item.tone}`}>
                    <FeatureIcon className="h-6 w-6" />
                  </span>
                  <span className="home-empty-card-title block">{item.title}</span>
                  <span className="home-empty-card-copy block">{item.description}</span>
                  <span className="home-empty-link">
                    {item.action}
                    <span aria-hidden="true">→</span>
                  </span>
                </button>
              );
            })}
          </section>

          <section className="home-empty-trust" aria-label={t('home.empty.capabilities')}>
            {[
              [TerminalSquare, t('home.empty.electron')],
              [ShieldCheck, t('home.empty.audit')],
              [GitBranch, t('home.empty.cicd')],
            ].map(([Icon, label]) => {
              const TrustIcon = Icon as typeof TerminalSquare;
              return (
                <div className="flex items-center gap-3" key={label as string}>
                  <TrustIcon className="h-5 w-5" />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">{label as string}</span>
                </div>
              );
            })}
          </section>
        </main>
      </section>
    );
  }

  const workspaceAssets = projects.reduce(
    (total, project) => ({
      groups: total.groups + project.groups.length,
      environments: total.environments + project.environments.length,
      testCases: total.testCases + project.testCases.length,
      recordings: total.recordings + project.recordings.length,
      documents: total.documents + project.documents.length,
      generatedPaths: total.generatedPaths + project.documents.reduce(
        (pathTotal, document) => pathTotal + document.generatedPaths.length,
        0,
      ),
    }),
    { groups: 0, environments: 0, testCases: 0, recordings: 0, documents: 0, generatedPaths: 0 },
  );
  const coverageIndex = getCoverageIndex(projects, recentRuns);
  const passRate = recentRuns.length
    ? Math.round((recentRuns.filter((run) => run.status === 'passed').length / recentRuns.length) * 100)
    : 0;
  const latestRun = recentRuns[0];
  const pipeline = [
    {
      icon: <FileText className="h-4 w-4" />,
      title: t('home.pipeline.prd'),
      description: t('home.pipeline.prdDescription', { count: workspaceAssets.documents }),
      page: 'documents' as AppPage,
    },
    {
      icon: <Bot className="h-4 w-4" />,
      title: t('home.pipeline.nl'),
      description: t('home.pipeline.nlDescription'),
      page: 'nl' as AppPage,
    },
    {
      icon: <MousePointerClick className="h-4 w-4" />,
      title: t('home.pipeline.recording'),
      description: t('home.pipeline.recordingDescription', { count: workspaceAssets.recordings }),
      page: 'recording' as AppPage,
    },
  ];
  const optimizationCards = [
    {
      icon: <ScanSearch className="h-6 w-6" />,
      title: t('home.optimization.chart.title'),
      description: t('home.optimization.chart.description'),
      tone: 'primary' as const,
    },
    {
      icon: <Clock3 className="h-6 w-6" />,
      title: t('home.optimization.duration.title'),
      description: latestRun ? `${latestRun.name} · ${latestRun.duration}` : t('home.optimization.duration.description'),
      tone: 'neutral' as const,
    },
    {
      icon: <CheckCircle2 className="h-6 w-6" />,
      title: t('home.optimization.assets.title'),
      description: t('home.optimization.assets.description', {
        cases: workspaceAssets.testCases,
        recordings: workspaceAssets.recordings,
      }),
      tone: 'neutral' as const,
    },
  ];
  const metricCards = [
    {
      label: t('home.overview.title'),
      value: t('home.overview.projectCount', { count: projects.length }),
      description: t('home.overview.assetCount', {
        groups: workspaceAssets.groups,
        environments: workspaceAssets.environments,
        documents: workspaceAssets.documents,
      }),
      Icon: DatabaseZap,
      tone: 'neutral' as const,
    },
    {
      label: t('home.health.title'),
      value: signal.badge,
      description: t('home.health.projectCount', { count: projects.length }),
      Icon: ShieldCheck,
      tone: signal.failed > signal.passed ? 'risk' as const : 'primary' as const,
    },
    {
      label: t('home.health.passRate'),
      value: `${passRate}%`,
      description: t('home.health.assetCount', {
        groups: workspaceAssets.groups,
        cases: workspaceAssets.testCases,
      }),
      Icon: CheckCircle2,
      tone: 'primary' as const,
    },
    {
      label: t('home.health.coverage'),
      value: `${coverageIndex}`,
      description: t('home.asset.pathsDescription'),
      Icon: ScanSearch,
      tone: 'primary' as const,
    },
  ];
  const recentRunHistory = recentRuns.slice(0, 3);

  return (
    <PageShell className="home-dashboard figma-overview-page">
      <PageHeader title={t('home.header.title')} />

      <PageBody>
        <section aria-label={t('home.aria.workbench')} className="home-dashboard-layout figma-overview-canvas">
          <div className="home-summary-grid home-metric-grid grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {metricCards.map(({ label, value, description, Icon, tone }) => (
              <DashboardCard className="home-summary-card home-metric-card p-4" key={label}>
                <div className="flex items-start justify-between gap-3">
                  <p className="home-faint font-mono text-[11px] uppercase tracking-[0.1em]">{label}</p>
                  <StatGlyph testId="home-summary-icon" tone={tone}><Icon className="h-5 w-5" /></StatGlyph>
                </div>
                <div className="mt-3 flex min-w-0 items-center gap-2">
                  <p className="home-text min-w-0 truncate text-[24px] font-bold leading-none tracking-[-0.04em]">{value}</p>
                </div>
                <p className="home-muted mt-2 line-clamp-2 text-xs leading-5">{description}</p>
              </DashboardCard>
            ))}
          </div>

          <div className="home-main-band grid min-w-0 gap-4 lg:grid-cols-12">
            <div className="home-main-content grid min-w-0 gap-4 lg:col-span-8">
              <Surface className="home-entry-panel p-5" variant="panel">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="home-faint font-mono text-[11px] uppercase tracking-[0.1em]">{t('home.pipeline.eyebrow')}</p>
                    <h2 className="mt-1 text-lg font-semibold">{t('home.pipeline.title')}</h2>
                  </div>
                </div>
                <div className="home-entry-grid mt-4 grid gap-3 md:grid-cols-3">
                  {pipeline.map((item) => (
                    <button
                      className="home-route-row home-entry-card cursor-pointer rounded-[6px] border border-border text-left"
                      key={item.title}
                      onClick={() => onGoToPage(item.page)}
                      type="button"
                    >
                      <span className="home-mini-icon flex h-8 w-8 items-center justify-center rounded-[4px]">{item.icon}</span>
                      <span className="min-w-0">
                        <span className="home-text block truncate text-sm font-semibold">{item.title}</span>
                        <span className="home-faint mt-1 block line-clamp-2 text-xs leading-5">{item.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Surface>

              <Surface
                aria-label={t('home.aria.timeline')}
                className="home-insights-panel p-5"
                variant="panel"
              >
                <div className="home-risk-summary flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <StatGlyph tone={signal.failed > signal.passed ? 'risk' : 'primary'}><ShieldCheck className="h-5 w-5" /></StatGlyph>
                    <div className="min-w-0">
                      <h2 className="home-text text-sm font-semibold">{t('home.baseline.title')}</h2>
                      <p className="home-muted mt-1 line-clamp-2 text-xs leading-5">{signal.description}</p>
                    </div>
                  </div>
                  <div className="home-run-signal-grid grid shrink-0 grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-border">
                    <CompactStat label={t('common.status.passed')} value={`${signal.passed}`} />
                    <CompactStat label={t('home.health.failed')} value={`${signal.failed}`} />
                    <CompactStat label={t('home.health.running')} value={`${signal.running}`} />
                  </div>
                </div>

                <div className="home-insight-grid mt-4 grid gap-3 md:grid-cols-3">
                  {optimizationCards.map((item) => (
                    <div className="home-insight-card flex min-h-0 items-start gap-3 rounded-[6px] border border-border p-3" key={item.title}>
                      <StatGlyph tone={item.tone}>{item.icon}</StatGlyph>
                      <div className="min-w-0">
                        <p className="home-text text-sm font-semibold">{item.title}</p>
                        <p className="home-muted mt-1 line-clamp-3 text-xs leading-5">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="home-baseline-grid mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] bg-border sm:grid-cols-3">
                  <CompactStat label={t('home.baseline.environment')} value={`${workspaceAssets.environments}`} />
                  <CompactStat label={t('home.baseline.browser')} value={browserSession.status} />
                  <CompactStat label={t('home.baseline.runtime')} value={runtimeInfo?.platform ?? 'browser'} />
                </div>
              </Surface>
            </div>

            <Surface className="home-recent-runs-panel flex min-w-0 flex-col p-5 lg:col-span-4" variant="panel">
              <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
                <h2 className="text-base font-semibold">{t('home.latest.title')}</h2>
                <button className="home-link cursor-pointer text-sm font-semibold transition" onClick={() => onGoToPage('runs')} type="button">
                  {t('home.pipeline.viewRuns')}
                </button>
              </div>

              {recentRunHistory.length ? (
                <div className="home-run-history-list divide-y divide-border">
                  {recentRunHistory.map((run) => (
                    <button
                      className="home-run-history-row grid w-full cursor-pointer gap-3 py-4 text-left"
                      key={run.id}
                      onClick={() => onGoToPage('runs')}
                      type="button"
                    >
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="home-text min-w-0 truncate text-sm font-semibold">{run.name}</span>
                        <StatusPill tone={run.status} />
                      </span>
                      <span className="home-muted line-clamp-2 text-xs leading-5">{run.summary}</span>
                      <span className="home-faint font-mono text-[11px]">{run.duration}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="home-run-history-empty flex min-h-40 flex-1 flex-col items-center justify-center px-6 text-center">
                  <Clock3 className="home-accent-text h-6 w-6" />
                  <p className="home-text mt-3 text-sm font-semibold">{t('home.latest.empty')}</p>
                  <p className="home-muted mt-1 max-w-64 text-xs leading-5">{t('home.latest.description')}</p>
                </div>
              )}
            </Surface>
          </div>
        </section>
      </PageBody>
    </PageShell>
  );
};
