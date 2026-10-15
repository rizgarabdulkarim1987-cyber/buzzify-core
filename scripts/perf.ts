import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:3100/atelier/en/t/04';
// An optional label keeps several measurements of the same day side by side: npm run perf -- <url> <label>
const label = process.argv[3];
const outDir = resolve('docs/perf');
mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, 'lighthouse-latest.json');

execFileSync(
  process.execPath,
  [
    resolve('node_modules/lighthouse/cli/index.js'),
    url,
    '--only-categories=performance',
    '--output=json',
    `--output-path=${jsonPath}`,
    '--quiet',
    '--chrome-flags=--headless=new --no-sandbox',
  ],
  // CHROME_PATH wins when set; otherwise use the Chromium that Playwright installed.
  { stdio: 'inherit', env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? chromium.executablePath() } },
);

const lhr = JSON.parse(readFileSync(jsonPath, 'utf8'));
const lcp: number = lhr.audits['largest-contentful-paint'].numericValue;
const fcp: number = lhr.audits['first-contentful-paint'].numericValue;
const tbt: number = lhr.audits['total-blocking-time'].numericValue;
const cls: number = lhr.audits['cumulative-layout-shift'].numericValue;
const score: number = Math.round(lhr.categories.performance.score * 100);
const summary: Array<{ resourceType: string; transferSize: number; requestCount: number }> =
  lhr.audits['resource-summary'].details.items;
const script = summary.find((item) => item.resourceType === 'script');
const total = summary.find((item) => item.resourceType === 'total');
const kb = (bytes = 0) => `${(bytes / 1024).toFixed(0)} KB`;

const date = new Date().toISOString().slice(0, 10);
const verdict = lcp <= 2500 ? 'met' : 'not met';
const report = `# Performance baseline ${date}${label ? ` (${label})` : ''}

Measured with Lighthouse ${lhr.lighthouseVersion} against \`${url}\` using the default mobile profile
(simulated slow 4G, 4x CPU slowdown), production build, local server.

| Metric | Value |
|---|---|
| Performance score | ${score} |
| Largest Contentful Paint | ${(lcp / 1000).toFixed(2)} s |
| First Contentful Paint | ${(fcp / 1000).toFixed(2)} s |
| Total Blocking Time | ${tbt.toFixed(0)} ms |
| Cumulative Layout Shift | ${cls.toFixed(3)} |
| Script transfer size | ${kb(script?.transferSize)} (${script?.requestCount ?? 0} requests) |
| Total transfer size | ${kb(total?.transferSize)} |

**LCP target (under 2.5 s): ${verdict}.**

Numbers vary by machine. Re-run with \`npm run build && npm run start\` in one terminal and \`npm run perf\` in another.
`;
writeFileSync(resolve(outDir, label ? `baseline-${date}-${label}.md` : `baseline-${date}.md`), report);
console.log(report);
