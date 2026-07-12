import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { readFile } from 'node:fs/promises';

const EXPECTED_CATEGORY: Record<string, string> = {
  '01': 'dom-disappeared',
  '02': 'dom-disappeared',
  '03': 'dom-disappeared',
  '04': 'locator-not-found',
  '05': 'actionability',
  '06': 'actionability',
  '07': 'locator-not-found',
  '08': 'actionability',
  '09': 'locator-not-found',
  '10': 'actionability',
  '11': 'runtime',
  '12': 'network',
  '13': 'dom-disappeared',
  '14': 'actionability',
  '15': 'actionability',
  '16': 'dom-disappeared',
  '17': 'runtime',
};

export default class GoldenForensicsReporter implements Reporter {
  private errors: string[] = [];

  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    const scenario = test.location.file.match(/\/(\d{2})-[^/]+\.spec\.ts$/)?.[1];
    if (!scenario || scenario === '00') return;
    const names = new Set(result.attachments.map(attachment => attachment.name));
    for (const name of ['forensics-report-txt', 'forensics-report', 'forensics-report-json']) {
      if (!names.has(name)) this.errors.push(`${scenario}: missing ${name} attachment`);
    }
    const jsonAttachment = result.attachments.find(attachment => attachment.name === 'forensics-report-json');
    if (!jsonAttachment?.path) return;
    try {
      const report = JSON.parse(await readFile(jsonAttachment.path, 'utf8')) as {
        schemaVersion?: number;
        verdict?: { category?: string; confidence?: string; evidence?: string[] };
        mutationLogs?: unknown[];
      };
      if (report.schemaVersion !== 2) this.errors.push(`${scenario}: JSON schema is not v2`);
      if (report.verdict?.category !== EXPECTED_CATEGORY[scenario]) {
        this.errors.push(`${scenario}: expected ${EXPECTED_CATEGORY[scenario]}, got ${report.verdict?.category}`);
      }
      if (!['confirmed', 'likely', 'insufficient-evidence'].includes(report.verdict?.confidence ?? '')) {
        this.errors.push(`${scenario}: missing confidence`);
      }
      if (!report.verdict?.evidence?.length) this.errors.push(`${scenario}: missing evidence`);
      if (scenario === '16' && !report.mutationLogs?.length) this.errors.push('16: mutation timeline is empty');
    } catch (error) {
      this.errors.push(`${scenario}: cannot parse JSON report: ${String(error)}`);
    }
  }

  onEnd(): { status?: FullResult['status'] } | void {
    if (this.errors.length) {
      console.error(`Forensics golden validation failed:\n${this.errors.join('\n')}`);
      return { status: 'failed' };
    }
  }
}
