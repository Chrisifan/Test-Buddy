import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type {
  BrowserSessionState,
  ProjectDraft,
  RunSummary,
  RuntimeInfo,
} from '../../../shared/studio.js';
import type { AppPage } from '../../app/pageMeta.js';

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  FileText,
  MousePointerClick,
  Plus,
  RadioTower,
  Route,
  ScanSearch,
  ShieldCheck,
  Rocket,
  TerminalSquare,
  GitBranch,
  ServerCog,
} from 'lucide-react';

import { StatusPill } from '../../components/StatusPill.js';
import { PageBody, PageHeader, PageShell, Surface } from '../../components/workbench.js';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '../../i18n/index.js';

function getSignalSummary(recentRuns: RunSummary[], t: (key: string) => string) {
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
}

function getCoverageIndex(project: ProjectDraft, runs: RunSummary[]): number {
  const assetScore =
    project.groups.length * 6 +
    project.testCases.length * 8 +
    project.recordings.length * 10 +
    project.documents.length * 8;
  const passScore = runs.length
    ? Math.round((runs.filter((run) => run.status === 'passed').length / runs.length) * 30)
    : 0;

  return Math.min(98, Math.max(12, assetScore + passScore));
}

function DashboardCard({
  children,
  className = '',
  action,
  ...props
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
} & ComponentPropsWithoutRef<'section'>) {
  return (
    <section className={`home-stat-card ${className}`} {...props}>
      {children}
      {action ? <div className="mt-auto pt-4">{action}</div> : null}
    </section>
  );
}

function StatGlyph({
  children,
  tone = 'cyan',
  testId,
}: {
  children: ReactNode;
  tone?: 'cyan' | 'pink' | 'blue' | 'amber';
  testId?: string;
}) {
  const toneClass =
    tone === 'pink'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200';

  return (
    <span className={`home-glyph flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border ${toneClass}`} data-testid={testId}>
      {children}
    </span>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="home-compact-stat rounded-[4px] px-3 py-2">
      <span className="home-compact-label block text-[11px]">{label}</span>
      <span className="home-compact-value mt-0.5 block truncate font-mono text-sm font-semibold">{value}</span>
    </span>
  );
}

export function HomePage({
  projects,
  selectedProject,
  browserSession,
  recentRuns,
  runtimeInfo,
  selectedEnvironmentName,
  onCreateProject,
  onGoToPage,
  onSelectProject,
}: {
  projects: ProjectDraft[];
  selectedProject?: ProjectDraft;
  browserSession: BrowserSessionState;
  recentRuns: RunSummary[];
  runtimeInfo?: RuntimeInfo;
  selectedEnvironmentName?: string;
  onCreateProject: () => void;
  onGoToPage: (page: AppPage) => void;
  onSelectProject?: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const signal = getSignalSummary(recentRuns, t);

  if (!projects.length || !selectedProject) {
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
        <footer className="home-empty-status">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t('home.empty.online')}
            </span>
            <span>|</span>
            <span>{t('home.empty.workspace')}</span>
          </div>
          <div className="flex items-center gap-4">
            <span>V2.4.0-stable</span>
            <TerminalSquare className="h-3.5 w-3.5" />
          </div>
        </footer>
      </section>
    );
  }

  const projectRuns = recentRuns.filter((run) => !run.projectId || run.projectId === selectedProject.id);
  const coverageIndex = getCoverageIndex(selectedProject, projectRuns);
  const activeRuns = projectRuns.filter((run) => run.status === 'running').length;
  const failedRuns = projectRuns.filter((run) => run.status === 'failed').length;
  const passRate = projectRuns.length
    ? Math.round((projectRuns.filter((run) => run.status === 'passed').length / projectRuns.length) * 100)
    : 0;
  const generatedPathCount = selectedProject.documents.reduce(
    (total, document) => total + document.generatedPaths.length,
    0,
  );
  const latestRun = projectRuns[0];
  const pipeline = [
    {
      icon: <FileText className="h-4 w-4" />,
      title: t('home.pipeline.prd'),
      description: t('home.pipeline.prdDescription', { count: selectedProject.documents.length }),
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
      description: t('home.pipeline.recordingDescription', { count: selectedProject.recordings.length }),
      page: 'recording' as AppPage,
    },
  ];
  const optimizationCards = [
    {
      icon: <ScanSearch className="h-6 w-6" />,
      title: t('home.optimization.chart.title'),
      description: t('home.optimization.chart.description'),
      tone: 'pink' as const,
    },
    {
      icon: <Clock3 className="h-6 w-6" />,
      title: t('home.optimization.duration.title'),
      description: latestRun ? `${latestRun.name} · ${latestRun.duration}` : t('home.optimization.duration.description'),
      tone: 'blue' as const,
    },
    {
      icon: <CheckCircle2 className="h-6 w-6" />,
      title: t('home.optimization.assets.title'),
      description: t('home.optimization.assets.description', {
        cases: selectedProject.testCases.length,
        recordings: selectedProject.recordings.length,
      }),
      tone: 'cyan' as const,
    },
  ];
  const signalBars = [
    selectedProject.testCases.length,
    selectedProject.recordings.length,
    selectedProject.groups.length,
    selectedProject.documents.length,
    generatedPathCount,
    projectRuns.length,
  ];
  const highestSignal = Math.max(...signalBars, 1);

  return (
    <PageShell className="home-dashboard">
      <PageHeader
        action={
          <div className="home-control-card w-[min(320px,calc(100vw-120px))] rounded-[4px] p-2 max-sm:w-full">
          <p className="home-faint px-1 font-mono text-[10px] uppercase tracking-[0.12em]">{t('home.header.currentProject')}</p>
          <Select onValueChange={onSelectProject} value={selectedProject.id}>
            <SelectTrigger className="home-select mt-2 h-9 w-full rounded-[4px] border-0 px-3 shadow-none">
              <SelectValue placeholder={t('home.header.switchProject')} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
        }
        eyebrow={t('home.header.eyebrow')}
        title={t('home.header.title')}
        description={t('home.header.description')}
      />

      <PageBody>
        <section aria-label={t('home.aria.workbench')} className="home-dashboard-layout">
          <div className="home-summary-grid">
            <DashboardCard className="home-summary-card home-project-overview-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="home-faint font-mono text-[11px] uppercase tracking-[0.1em]">{t('home.overview.title')}</p>
                  <p className="home-text mt-2 truncate text-sm font-semibold">{selectedProject.name}</p>
                </div>
                <StatGlyph testId="home-summary-icon" tone="cyan"><DatabaseZap className="h-5 w-5" /></StatGlyph>
              </div>
              <p className="home-muted mt-2 text-xs leading-5">
                {t('home.overview.assetCount', {
                  groups: selectedProject.groups.length,
                  environments: selectedProject.environments.length,
                  documents: selectedProject.documents.length,
                })}
              </p>
            </DashboardCard>
            <DashboardCard className="home-summary-card home-health-card p-3">
              <div className="flex items-start justify-between gap-3">
                <StatGlyph testId="home-summary-icon" tone="blue"><ShieldCheck className="h-5 w-5" /></StatGlyph>
                <StatusPill tone={failedRuns ? 'failed' : activeRuns ? 'running' : 'passed'} />
              </div>
              <p className="home-faint mt-2 font-mono text-[11px] uppercase tracking-[0.1em]">{t('home.health.title')}</p>
              <p className="home-text mt-1 text-[24px] font-bold leading-none tracking-[-0.04em]">{signal.badge}</p>
              <p className="home-muted mt-1.5 truncate text-xs">{selectedProject.name}</p>
            </DashboardCard>
            {[
              {
                label: t('home.asset.cases'),
                value: `${selectedProject.testCases.length}`,
                description: t('home.asset.casesDescription'),
                Icon: FileText,
                tone: 'blue' as const,
              },
              {
                label: t('home.health.passRate'),
                value: `${passRate}%`,
                description: t('home.health.assetCount', { groups: selectedProject.groups.length, cases: selectedProject.testCases.length }),
                Icon: CheckCircle2,
                tone: 'cyan' as const,
              },
              {
                label: t('home.asset.recordings'),
                value: `${selectedProject.recordings.length}`,
                description: t('home.asset.recordingsDescription'),
                Icon: MousePointerClick,
                tone: 'amber' as const,
              },
              {
                label: t('home.health.coverage'),
                value: `${coverageIndex}`,
                description: t('home.asset.pathsDescription'),
                Icon: ScanSearch,
                tone: 'pink' as const,
              },
            ].map(({ label, value, description, Icon, tone }) => (
              <DashboardCard className="home-summary-card p-3" key={label}>
                <div className="flex items-start justify-between gap-3">
                  <p className="home-faint font-mono text-[11px] uppercase tracking-[0.1em]">{label}</p>
                  <StatGlyph testId="home-summary-icon" tone={tone}><Icon className="h-5 w-5" /></StatGlyph>
                </div>
                <p className="home-text mt-2 text-[28px] font-bold leading-none tracking-[-0.04em]">{value}</p>
                <p className="home-muted mt-1.5 text-xs leading-5">{description}</p>
              </DashboardCard>
            ))}
          </div>

          <div className="home-operation-grid">
            <Surface className="home-trace-panel p-5" variant="panel">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="home-faint font-mono text-[11px] uppercase tracking-[0.1em]">{t('home.pipeline.eyebrow')}</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{t('home.pipeline.title')}</h2>
                </div>
                <button className="home-link cursor-pointer text-sm font-semibold transition" onClick={() => onGoToPage('runs')} type="button">
                  {t('home.pipeline.viewRuns')}
                </button>
              </div>
              <div aria-hidden="true" className="home-signal-chart">
                {signalBars.map((value, index) => (
                  <span className="home-signal-column" key={`${value}-${index}`}>
                    <span className="home-signal-bar" style={{ height: `${Math.max(14, Math.round((value / highestSignal) * 100))}%` }} />
                  </span>
                ))}
                <span className="home-signal-baseline" />
              </div>
              <div className="mt-5 grid gap-px overflow-hidden rounded-[6px] border border-border bg-border md:grid-cols-3">
                {pipeline.map((item) => (
                  <button className="home-route-row cursor-pointer text-left" key={item.title} onClick={() => onGoToPage(item.page)} type="button">
                    <span className="home-mini-icon flex h-8 w-8 items-center justify-center rounded-[4px]">{item.icon}</span>
                    <span className="min-w-0">
                      <span className="home-text block truncate text-sm font-semibold">{item.title}</span>
                      <span className="home-faint mt-1 block line-clamp-2 text-xs leading-5">{item.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Surface>

            <aside className="home-run-sidebar">
              <DashboardCard className="home-active-run p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="home-faint font-mono text-[11px] uppercase tracking-[0.1em]">{t('home.latest.title')}</p>
                    <p className="home-text mt-2 truncate text-base font-semibold">{latestRun?.name ?? t('home.latest.empty')}</p>
                  </div>
                  {latestRun ? <StatusPill tone={latestRun.status} /> : <RadioTower className="home-accent-text h-5 w-5" />}
                </div>
                <p className="home-muted mt-3 line-clamp-2 text-xs leading-5">{latestRun?.summary ?? t('home.latest.description')}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                  <span>{latestRun?.duration ?? '--:--'}</span>
                  <span>{latestRun?.status ?? t('home.latest.empty')}</span>
                </div>
              </DashboardCard>
              <DashboardCard className="home-baseline-card p-5">
                <div className="flex items-center gap-3">
                  <StatGlyph tone="amber"><ShieldCheck className="h-5 w-5" /></StatGlyph>
                  <div className="min-w-0"><p className="home-text text-sm font-semibold">{t('home.baseline.title')}</p><p className="home-muted mt-1 truncate text-xs">{signal.description}</p></div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-border">
                  <CompactStat label={t('home.baseline.environment')} value={selectedEnvironmentName ?? '-'} />
                  <CompactStat label={t('home.baseline.browser')} value={browserSession.status} />
                  <CompactStat label={t('home.baseline.runtime')} value={runtimeInfo?.platform ?? 'browser'} />
                </div>
              </DashboardCard>
            </aside>
          </div>

          <section aria-label={t('home.aria.timeline')} className="home-insight-grid">
            {optimizationCards.map((item) => (
              <DashboardCard className="home-insight-card p-4" key={item.title}>
                <div className="flex h-full items-start gap-3"><StatGlyph tone={item.tone}>{item.icon}</StatGlyph><div><p className="home-text text-sm font-semibold">{item.title}</p><p className="home-muted mt-1 text-xs leading-5">{item.description}</p></div></div>
              </DashboardCard>
            ))}
          </section>
        </section>
      </PageBody>
    </PageShell>
  );
}
