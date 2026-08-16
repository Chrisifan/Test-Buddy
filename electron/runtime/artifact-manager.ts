import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  ProjectReportLocale,
  ProjectRunReport,
  RunArtifact,
  RunCoverageRiskStatus,
  RunStatus,
} from '../../shared/studio.js';

export class ArtifactManager {
  private readonly artifactsDir: string;

  constructor(rootDir: string) {
    this.artifactsDir = path.join(rootDir, 'studio-data', 'artifacts');
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.artifactsDir, { recursive: true });
  }

  isManagedArtifactPath(candidatePath: string): boolean {
    const relativePath = path.relative(this.artifactsDir, path.resolve(candidatePath));
    return Boolean(relativePath) && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
  }

  async exportArtifact(artifactPath: string, destinationPath: string): Promise<void> {
    if (!this.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能导出应用生成的证据文件。');
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(artifactPath, destinationPath);
  }

  async importManualEvidence(sourcePath: string): Promise<RunArtifact> {
    const source = path.resolve(sourcePath);
    const sourceStats = await fs.stat(source);
    if (!sourceStats.isFile()) {
      throw new Error('只能附加文件证据。');
    }

    await this.ensureReady();
    const sourceName = path.basename(source);
    const extension = getSafeExtension(sourceName);
    const artifactPath = path.join(this.artifactsDir, `manual-${Date.now()}-${randomUUID()}${extension}`);
    await fs.copyFile(source, artifactPath);

    return {
      id: `artifact-manual-${randomUUID()}`,
      type: 'attachment',
      label: sourceName || '人工检查附件',
      path: artifactPath,
    };
  }

  async createSnapshot(runId: string, label: string, title: string, url: string): Promise<RunArtifact> {
    await this.ensureReady();
    const artifactPath = path.join(this.artifactsDir, `${runId}-${Date.now()}.svg`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#050505"/>
  <rect x="64" y="64" width="1152" height="592" rx="24" fill="#101010" stroke="#3d3d3d"/>
  <text x="104" y="140" fill="#d6ff42" font-family="Avenir Next, sans-serif" font-size="28" font-weight="700">${escapeXml(title)}</text>
  <text x="104" y="198" fill="#f4f4f4" font-family="Avenir Next, sans-serif" font-size="20">${escapeXml(label)}</text>
  <text x="104" y="250" fill="#8d8d8d" font-family="Avenir Next, sans-serif" font-size="18">${escapeXml(url || 'No URL')}</text>
  <circle cx="1110" cy="134" r="10" fill="#d6ff42" opacity="0.65"/>
</svg>`;
    await fs.writeFile(artifactPath, svg, 'utf8');
    return {
      id: `artifact-${Date.now()}`,
      type: 'screenshot',
      label,
      path: artifactPath,
    };
  }

  async createTracePath(runId: string): Promise<string> {
    await this.ensureReady();
    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
    return path.join(this.artifactsDir, `${safeRunId || 'agent-run'}-${Date.now()}-trace.zip`);
  }

  async createMarkdownReport(runId: string, label: string, markdown: string): Promise<RunArtifact> {
    await this.ensureReady();
    const artifactPath = path.join(this.artifactsDir, `${runId}-reporter.md`);
    await fs.writeFile(artifactPath, markdown, 'utf8');
    return {
      id: `artifact-${Date.now()}`,
      type: 'report',
      label,
      path: artifactPath,
    };
  }

  async createReporterReport(
    runId: string,
    label: string,
    markdown: string,
  ): Promise<{ markdown: RunArtifact; html: RunArtifact }> {
    await this.ensureReady();
    const markdownPath = path.join(this.artifactsDir, `${runId}-reporter.md`);
    const htmlPath = path.join(this.artifactsDir, `${runId}-reporter.html`);
    await fs.writeFile(markdownPath, markdown, 'utf8');
    await fs.writeFile(htmlPath, renderReporterHtml(markdown), 'utf8');
    return {
      markdown: {
        id: `artifact-${Date.now()}-markdown`,
        type: 'report',
        label,
        path: markdownPath,
      },
      html: {
        id: `artifact-${Date.now()}-html`,
        type: 'report',
        label: 'Reporter HTML 报告',
        path: htmlPath,
      },
    };
  }

  async createProjectRunReport(report: ProjectRunReport, locale: ProjectReportLocale): Promise<string> {
    await this.ensureReady();
    const artifactPath = path.join(this.artifactsDir, `project-report-${Date.now()}-${randomUUID()}.html`);
    await fs.writeFile(artifactPath, renderProjectRunReportHtml(report, locale), 'utf8');
    return artifactPath;
  }

  async removeArtifact(artifactPath: string): Promise<void> {
    if (!this.isManagedArtifactPath(artifactPath)) {
      throw new Error('只能清理应用生成的证据文件。');
    }
    await fs.rm(artifactPath, { force: true });
  }
}

export function renderProjectRunReportHtml(report: ProjectRunReport, locale: ProjectReportLocale): string {
  const labels = projectReportLabels(locale);
  const stats = (Object.entries(report.runStats) as Array<[keyof ProjectRunReport['runStats'], number]>)
    .map(([status, count]) => `<li><span>${escapeXml(labels.status[status])}</span><strong>${count}</strong></li>`)
    .join('');
  const risks = report.coverageRisk.risks.length
    ? report.coverageRisk.risks
        .map((risk) => `<tr><td>${escapeXml(risk.testCaseName)}</td><td>${escapeXml(risk.groupName)}</td><td>${escapeXml(risk.environmentName)}</td><td>${escapeXml(labels.risk[risk.status])}</td></tr>`)
        .join('')
    : `<tr><td colspan="4" class="muted">${escapeXml(labels.noRisks)}</td></tr>`;
  const triageRows = (['case', 'recording'] as const)
    .map((target) => {
      const statuses = report.prdCoverage.targets[target];
      return `<tr><td>${escapeXml(labels.target[target])}</td><td>${statuses.pending}</td><td>${statuses.deferred}</td><td>${statuses.ignored}</td><td>${statuses.resolved}</td></tr>`;
    })
    .join('');
  const problemRuns = report.problemRuns.length
    ? report.problemRuns
        .map((run) => `<article class="problem"><div><strong>${escapeXml(run.testCaseName)}</strong><span>${escapeXml(run.environmentName)} · ${escapeXml(labels.status[run.status])}</span></div><p>${escapeXml(run.failureReason || run.summary)}</p><small>${escapeXml(run.startedAt || labels.unknownTime)} · ${escapeXml(run.duration)}${run.artifactLabels.length ? ` · ${escapeXml(run.artifactLabels.join(' / '))}` : ''}</small></article>`)
        .join('')
    : `<p class="muted">${escapeXml(labels.noProblemRuns)}</p>`;
  const nonExecutedRuns = report.nonExecutedRuns.length
    ? report.nonExecutedRuns
        .map((run) => `<article class="non-executed"><div><strong>${escapeXml(run.testCaseName)}</strong><span>${escapeXml(run.environmentName)} · ${escapeXml(labels.status[run.status])}</span></div><p>${escapeXml(run.reason ? `${run.reason.code} · ${run.reason.message}` : run.summary)}</p><small>${escapeXml(run.startedAt || labels.unknownTime)} · ${escapeXml(run.duration)}${run.artifactLabels.length ? ` · ${escapeXml(run.artifactLabels.join(' / '))}` : ''}</small></article>`)
        .join('')
    : `<p class="muted">${escapeXml(labels.noNonExecutedRuns)}</p>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(labels.title)} · ${escapeXml(report.projectName)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f8fb; }
    body { margin: 0; padding: 32px; background: #f6f8fb; }
    main { max-width: 960px; margin: 0 auto; background: #fff; border: 1px solid #dfe5ee; padding: 36px; }
    h1 { margin: 0; font-size: 28px; } h2 { margin: 32px 0 12px; font-size: 16px; } p { line-height: 1.6; }
    .meta, .muted, small { color: #667085; } .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 0; list-style: none; }
    .grid li { border: 1px solid #dfe5ee; padding: 14px; display: flex; justify-content: space-between; gap: 12px; } strong { color: #172033; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; } th, td { padding: 10px; border-bottom: 1px solid #e8edf4; text-align: left; vertical-align: top; }
    th { color: #667085; font-weight: 600; } .problem, .non-executed { border: 1px solid #dfe5ee; padding: 14px; margin-bottom: 10px; } .problem div, .non-executed div { display: flex; justify-content: space-between; gap: 12px; } .problem div span, .non-executed div span { color: #667085; font-size: 13px; }
  </style>
</head>
<body><main>
  <h1>${escapeXml(labels.title)}</h1>
  <p class="meta">${escapeXml(report.projectName)} · ${escapeXml(labels.generatedAt)} ${escapeXml(report.generatedAt)}</p>
  <h2>${escapeXml(labels.runSummary)}</h2><ul class="grid">${stats}</ul>
  <h2>${escapeXml(labels.coverageRisk)}</h2><p class="meta">${escapeXml(labels.verified)} ${report.coverageRisk.verified} / ${report.coverageRisk.total}</p>
  <table><thead><tr><th>${escapeXml(labels.testCase)}</th><th>${escapeXml(labels.group)}</th><th>${escapeXml(labels.environment)}</th><th>${escapeXml(labels.riskStatus)}</th></tr></thead><tbody>${risks}</tbody></table>
  <h2>${escapeXml(labels.prdCoverage)}</h2><p class="meta">${escapeXml(labels.prdPaths)} ${report.prdCoverage.paths}</p>
  <table><thead><tr><th>${escapeXml(labels.targetLabel)}</th><th>${escapeXml(labels.triage.pending)}</th><th>${escapeXml(labels.triage.deferred)}</th><th>${escapeXml(labels.triage.ignored)}</th><th>${escapeXml(labels.triage.resolved)}</th></tr></thead><tbody>${triageRows}</tbody></table>
  <h2>${escapeXml(labels.problemRuns)}</h2>${problemRuns}
  <h2>${escapeXml(labels.nonExecutedRuns)}</h2>${nonExecutedRuns}
</main></body></html>`;
}

function projectReportLabels(locale: ProjectReportLocale): ProjectReportLabels {
  if (locale === 'en-US') {
    return {
      title: 'TestBuddy Project Report', generatedAt: 'Generated at', runSummary: 'Run summary', coverageRisk: 'Coverage risk', verified: 'Verified', testCase: 'Test case', group: 'Group', environment: 'Environment', riskStatus: 'Risk', noRisks: 'No coverage risks.', prdCoverage: 'PRD coverage governance', prdPaths: 'Requirement paths', targetLabel: 'Target', problemRuns: 'Recent failed runs', noProblemRuns: 'No failed runs.', nonExecutedRuns: 'Recent non-executed runs', noNonExecutedRuns: 'No non-executed runs.', unknownTime: 'Unknown time',
      status: { running: 'Running', passed: 'Passed', failed: 'Failed', blocked: 'Blocked', skipped: 'Skipped', cancelled: 'Cancelled', error: 'Error' },
      risk: { neverExecuted: 'Never executed', failed: 'Last run failed', error: 'Last run errored', blocked: 'Last run blocked', skipped: 'Last run skipped', cancelled: 'Last run cancelled' },
      target: { case: 'Test case', recording: 'Recording' },
      triage: { pending: 'Pending', deferred: 'Deferred', ignored: 'Ignored', resolved: 'Resolved' },
    };
  }
  return {
    title: 'TestBuddy 项目报告', generatedAt: '生成时间', runSummary: '运行汇总', coverageRisk: '覆盖风险', verified: '已验证', testCase: '用例', group: '分组', environment: '环境', riskStatus: '风险', noRisks: '当前没有覆盖风险。', prdCoverage: 'PRD 覆盖治理', prdPaths: '需求路径', targetLabel: '目标', problemRuns: '最近失败运行', noProblemRuns: '当前没有失败运行。', nonExecutedRuns: '最近未执行运行', noNonExecutedRuns: '当前没有未执行运行。', unknownTime: '未知时间',
    status: { running: '运行中', passed: '通过', failed: '失败', blocked: '阻断', skipped: '跳过', cancelled: '已取消', error: '错误' },
    risk: { neverExecuted: '从未执行', failed: '最近失败', error: '最近错误', blocked: '最近阻断', skipped: '最近跳过', cancelled: '最近取消' },
    target: { case: '用例', recording: '录制' },
    triage: { pending: '待处理', deferred: '延后', ignored: '忽略', resolved: '已解决' },
  };
}

interface ProjectReportLabels {
  title: string;
  generatedAt: string;
  runSummary: string;
  coverageRisk: string;
  verified: string;
  testCase: string;
  group: string;
  environment: string;
  riskStatus: string;
  noRisks: string;
  prdCoverage: string;
  prdPaths: string;
  targetLabel: string;
  problemRuns: string;
  noProblemRuns: string;
  nonExecutedRuns: string;
  noNonExecutedRuns: string;
  unknownTime: string;
  status: Record<RunStatus, string>;
  risk: Record<RunCoverageRiskStatus, string>;
  target: Record<'case' | 'recording', string>;
  triage: Record<'pending' | 'deferred' | 'ignored' | 'resolved', string>;
}

function getSafeExtension(sourceName: string): string {
  const extension = path.extname(sourceName).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '';
}

function renderReporterHtml(markdown: string): string {
  const body = markdown
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith('# ')) {
        return `<h1>${escapeXml(line.slice(2).trim())}</h1>`;
      }
      if (line.startsWith('## ')) {
        return `<h2>${escapeXml(line.slice(3).trim())}</h2>`;
      }
      if (line.startsWith('- ')) {
        return `<li>${escapeXml(line.slice(2).trim())}</li>`;
      }
      if (!line.trim()) {
        return '';
      }
      return `<p>${escapeXml(line.trim())}</p>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reporter 失败分析</title>
  <style>
    body { margin: 0; background: #0b0f14; color: #eef5f8; font-family: Avenir Next, PingFang SC, sans-serif; }
    main { max-width: 920px; margin: 0 auto; padding: 48px 32px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 28px; }
    h2 { color: #9ce7ff; font-size: 16px; margin: 28px 0 12px; text-transform: uppercase; letter-spacing: .08em; }
    p, li { color: #c7d2da; font-size: 15px; line-height: 1.75; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
