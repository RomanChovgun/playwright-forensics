import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

class ForensicsReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    if (result.status !== 'passed' && result.attachments.length > 0) {
      const htmlAttach = result.attachments.find(
        a => a.name === 'forensics-report' || a.path?.endsWith('forensics-report.html')
      );

      if (htmlAttach?.path) {
        const reportPath = htmlAttach.path;
        console.log('');
        console.log('  ── [playwright-forensics] ─────────────────────────');
        console.log(`     🔍 Open report:`);
        console.log(`        ${reportPath}`);
        console.log(`     🖥️  Or: npx pwf open "${reportPath}"`);
        console.log('  ─────────────────────────────────────────────────────');
        console.log('');
      }
    }
  }
}

export default ForensicsReporter;
