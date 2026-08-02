import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RunArtifact } from '../../shared/studio.js';

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
