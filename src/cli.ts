#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { resetConfigCache } from './config.js';
import { escapeHtml } from './escape.js';

function openInBrowser(filePath: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [filePath];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', filePath];
  } else {
    cmd = 'xdg-open';
    args = [filePath];
  }

  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.unref();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'open':
      await openReport(args[1]);
      break;
    case 'report':
      await generateSummaryReport(args[1] || '.');
      break;
    case 'demo':
      await runDemo();
      break;
    case 'watch':
      await watchMode(args[1], ...args.slice(2));
      break;
    case 'diff':
      await diffReports(args[1], args[2]);
      break;
    default:
      showHelp();
  }
}

async function openReport(path?: string) {
  if (!path) {
    console.error('❌ Specify the report path: npx pwf open <path>');
    process.exit(1);
  }

  let filePath = resolve(path);
  if (!existsSync(filePath)) {
    const match = filePath.includes('forensics-report.html') ? filePath : join(filePath, 'forensics-report.html');
    if (!existsSync(match)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }
    filePath = match;
  }

  if (lstatSync(filePath).isDirectory()) {
    const possibleFiles = [
      join(filePath, 'forensics-report.html'),
      join(filePath, 'forensics-report.txt'),
    ];
    const found = possibleFiles.find(f => existsSync(f));
    if (found) filePath = found;
    else {
      console.error(`❌ No forensics-report found in directory`);
      process.exit(1);
    }
  }

  console.log(`🔍 Opening: ${filePath}`);
  openInBrowser(filePath);
}

async function generateSummaryReport(dir: string) {
  const root = resolve(dir);
  const htmlFiles: string[] = [];

  const walk = async (d: string) => {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === 'forensics-report.html') {
        htmlFiles.push(fullPath);
      }
    }
  };

  try {
    await walk(root);
  } catch {
    console.error(`❌ Error reading directory: ${root}`);
    process.exit(1);
  }

  if (htmlFiles.length === 0) {
    console.log('❌ No forensics reports found');
    return;
  }

  const items = await Promise.all(htmlFiles.map(async (f) => {
    const content = await readFile(f, 'utf-8');
    const titleMatch = content.match(/<title>(.*?)<\/title>/);
    const testName = titleMatch?.[1]?.replace('Forensics Report — ', '') || f;
    return { path: f, testName };
  }));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Playwright Forensics — Summary</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; padding: 2rem; color: #1a1a2e; }
  h1 { margin-bottom: 0.5rem; }
  .count { color: #666; margin-bottom: 2rem; }
  .card { background: white; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 0.75rem; box-shadow: 0 1px 4px rgba(0,0,0,0.08); display: flex; justify-content: space-between; align-items: center; }
  .card a { color: #0d6efd; text-decoration: none; font-weight: 500; }
  .card a:hover { text-decoration: underline; }
  .badge { background: #dc3545; color: white; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
</style>
</head>
<body>
<h1>🔍 Playwright Forensics</h1>
<p class="count">Reports found: ${items.length}</p>
${items.map(i => `<div class="card"><a href="${i.path}">${escapeHtml(i.testName)}</a> <span class="badge">FAILED</span></div>`).join('\n')}
</body>
</html>`;

  const outPath = join(root, 'forensics-summary.html');
  await writeFile(outPath, html, 'utf-8');
  console.log(`✅ Summary report: ${outPath}`);

  openInBrowser(outPath);
}

async function watchMode(pattern?: string, ...restArgs: string[]) {
  const { watch: chokidarWatch } = await import('chokidar').catch(() => {
    console.error('❌ chokidar is required for watch mode. Install: npm install chokidar');
    process.exit(1);
  });

  const glob = pattern || 'test/**/*.spec.{ts,js,mjs}';
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  console.log(`👀 Watching: ${glob}`);
  console.log('   Press Ctrl+C to stop');
  console.log('');

  const runTests = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    pending = false;

    console.log('▶️  Running Playwright tests...');
    console.log('');

    const testArgs = ['playwright', 'test', ...restArgs];
    const child = spawn('npx', testArgs, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });

    return new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        console.log('');
        if (code === 0) {
          console.log('✅ All tests passed');
        } else {
          console.log('❌ Some tests failed — check reports');
        }
        console.log('👀 Watching for changes...');
        console.log('');
        running = false;
        if (pending) runTests();
        resolve();
      });
    });
  };

  const debouncedRun = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runTests, 500);
  };

  const watcher = chokidarWatch(glob, {
    ignoreInitial: true,
    ignored: /(node_modules|dist|\.git)/,
  });

  watcher.on('change', () => { resetConfigCache(); debouncedRun(); });
  watcher.on('add', () => { resetConfigCache(); debouncedRun(); });
  watcher.on('unlink', () => { resetConfigCache(); debouncedRun(); });

  await runTests();

  // Keep alive
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down...');
      watcher.close();
      resolve();
    });
  });
}

async function diffReports(run1?: string, run2?: string) {
  if (!run1 || !run2) {
    console.error('❌ Specify two report directories: npx pwf diff <run1> <run2>');
    process.exit(1);
  }

  const dir1 = resolve(run1);
  const dir2 = resolve(run2);

  if (!existsSync(dir1)) {
    console.error(`❌ Directory not found: ${dir1}`);
    process.exit(1);
  }
  if (!existsSync(dir2)) {
    console.error(`❌ Directory not found: ${dir2}`);
    process.exit(1);
  }

  const reports1 = await collectReports(dir1);
  const reports2 = await collectReports(dir2);

  const map1 = new Map(reports1.map(r => [r.testName, r]));
  const map2 = new Map(reports2.map(r => [r.testName, r]));

  const allTests = new Set([...map1.keys(), ...map2.keys()]);
  const newFailures: string[] = [];
  const fixed: string[] = [];
  const stillFailing: { name: string; verdict1: string; verdict2: string }[] = [];

  for (const testName of allTests) {
    const r1 = map1.get(testName);
    const r2 = map2.get(testName);

    if (!r1 && r2) {
      newFailures.push(testName);
    } else if (r1 && !r2) {
      fixed.push(testName);
    } else if (r1 && r2) {
      stillFailing.push({
        name: testName,
        verdict1: r1.verdict,
        verdict2: r2.verdict,
      });
    }
  }

  console.log('📊 Forensics Diff');
  console.log(`   Run 1: ${dir1} (${reports1.length} failures)`);
  console.log(`   Run 2: ${dir2} (${reports2.length} failures)`);
  console.log('');

  if (newFailures.length > 0) {
    console.log(`🆕 New Failures (${newFailures.length}):`);
    for (const name of newFailures) {
      console.log(`   • ${name}`);
      const r = map2.get(name)!;
      console.log(`     Verdict: ${r.verdict}`);
      console.log(`     Report: ${r.reportPath}`);
    }
    console.log('');
  }

  if (fixed.length > 0) {
    console.log(`✅ Fixed (${fixed.length}):`);
    for (const name of fixed) {
      console.log(`   • ${name}`);
    }
    console.log('');
  }

  if (stillFailing.length > 0) {
    console.log(`❌ Still Failing (${stillFailing.length}):`);
    for (const s of stillFailing) {
      const changed = s.verdict1 !== s.verdict2 ? ' ⚠️ verdict changed' : '';
      console.log(`   • ${s.name}`);
      console.log(`     Run 1: ${s.verdict1}`);
      console.log(`     Run 2: ${s.verdict2}${changed}`);
    }
    console.log('');
  }

  if (newFailures.length === 0 && fixed.length === 0 && stillFailing.length === 0) {
    console.log('   No differences found — no forensics reports in either directory');
  }
}

interface ParsedReport {
  testName: string;
  verdict: string;
  reportPath: string;
}

async function collectReports(dir: string): Promise<ParsedReport[]> {
  const txtFiles: string[] = [];
  const walk = async (d: string) => {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === 'forensics-report.txt') {
        txtFiles.push(fullPath);
      }
    }
  };

  try {
    await walk(dir);
  } catch {
    return [];
  }

  const reports: ParsedReport[] = [];
  for (const f of txtFiles) {
    const content = await readFile(f, 'utf-8');
    const testName = content.match(/^Test: (.*)$/m)?.[1]?.trim() ?? relative(dir, f);
    const verdict = content.match(/--- CAUSAL ANALYSIS ---\r?\n([^\r\n]+)/)?.[1]?.trim() ?? 'unknown';
    reports.push({ testName, verdict, reportPath: f });
  }
  return reports;
}

async function runDemo() {
  console.log('🚀 playwright-forensics demo');
  console.log('');
  console.log('First, install the package in your Playwright project:');
  console.log('  npm install playwright-forensics');
  console.log('');
  console.log('Then add to playwright.config.ts:');
  console.log('  import { test } from "playwright-forensics";');
  console.log('  export default { reporter: [["playwright-forensics/reporter"]] };');
  console.log('');
  console.log('Commands:');
  console.log('  npx pwf open <path>       — Open a report');
  console.log('  npx pwf report [dir]       — Build summary report');
  console.log('  npx pwf watch [pattern]    — Watch & re-run tests');
  console.log('  npx pwf diff <run1> <run2> — Diff two test runs');
  console.log('  npx pwf demo               — This help');
}

function showHelp() {
  console.log('🕵️  playwright-forensics CLI');
  console.log('');
  console.log('  npx pwf open <path>       — Open a report in the browser');
  console.log('  npx pwf report [dir]       — Build a summary from all reports');
  console.log('  npx pwf watch [pattern]    — Watch test files & re-run on changes');
  console.log('  npx pwf diff <run1> <run2> — Compare failures between two runs');
  console.log('  npx pwf demo               — Show usage instructions');
  console.log('');
  console.log('Examples:');
  console.log('  npx pwf open test-results/01-failed-test/');
  console.log('  npx pwf report test-results/');
  console.log('  npx pwf watch "test/**/*.spec.ts"');
  console.log('  npx pwf diff test-results/run1/ test-results/run2/');
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
