import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyAcceptanceReport } from './verify-acceptance-report.js';

export interface LatestAcceptanceReportVerification {
  reportPath: string;
  decision: Awaited<ReturnType<typeof verifyAcceptanceReport>>;
}

/** Verifies the newest complete retained report without overwriting older evidence. */
export const verifyLatestAcceptanceReport = async (
  outputDirectory: string,
): Promise<LatestAcceptanceReportVerification> => {
  const reportPath = await findLatestCompleteAcceptanceReport(outputDirectory);
  return { reportPath, decision: await verifyAcceptanceReport(reportPath) };
};

const findLatestCompleteAcceptanceReport = async (outputDirectory: string): Promise<string> => {
  const candidates = await Promise.all((await fs.readdir(outputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('runs-'))
    .map(async (entry) => {
      const directory = path.join(outputDirectory, entry.name);
      const reportPath = path.join(directory, 'acceptance-report.json');
      const junitPath = path.join(directory, 'acceptance-report.junit.xml');
      const [report, junit] = await Promise.all([
        fs.lstat(reportPath).catch(() => undefined),
        fs.lstat(junitPath).catch(() => undefined),
      ]);
      if (!report?.isFile() || !junit?.isFile()) {
        return undefined;
      }
      return { reportPath, modifiedAtMs: report.mtimeMs };
    }));
  const latest = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs || right.reportPath.localeCompare(left.reportPath))[0];
  if (!latest) {
    throw new Error('No complete retained acceptance report exists.');
  }
  return latest.reportPath;
};

const main = async (): Promise<void> => {
  const outputDirectory = process.argv[2] ?? path.resolve('.acceptance', 'local');
  const result = await verifyLatestAcceptanceReport(outputDirectory);
  process.stdout.write(`${result.reportPath}\n`);
};

if (process.argv[1]?.endsWith('verify-latest-acceptance-report.js')) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
