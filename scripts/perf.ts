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
const font = summary.find((item) => item.resourceType === 'font');
const total = summary.find((item) => item.resourceType === 'total');
const kb = (bytes = 0) => `${(bytes / 1024).toFixed(0)} KB`;

// "Initial" scripts are the ones requested before the page's largest paint: what a visitor has to download
// before the menu shows. Scripts fetched later (the product sheet warmed after load, the 3D stage) are
// counted in the total only. The goal applies to the initial figure.
const largestPaintAt: number = lhr.audits.metrics.details.items[0].observedLargestContentfulPaint;
const requests: Array<{ resourceType: string; networkRequestTime: number; transferSize: number }> =
  lhr.audits['network-requests'].details.items;
let initialScriptBytes = 0;
for (const request of requests) {
  if (request.resourceType === 'Script' && request.networkRequestTime <= largestPaintAt + 5) {
    initialScriptBytes += request.transferSize;
  }
}
const SCRIPT_GOAL_KB = 120;

// The page's HTML, as transferred (headers included). A new connection delivers about 14,600 bytes (10 segments of
// 1,460) in its first round trip; a document past that costs a second one, 150 ms on this profile, before anything
// paints. The table's entry page (/t/NN) sits closest to the line.
const documentBytes: number = requests.find((request) => request.resourceType === 'Document')?.transferSize ?? 0;
const FIRST_ROUND_TRIP_BYTES = 14_600;

const date = new Date().toISOString().slice(0, 10);
const verdict = lcp <= 2500 ? 'met' : 'not met';
const scriptVerdict = initialScriptBytes / 1024 <= SCRIPT_GOAL_KB ? 'met' : 'not met';
const documentVerdict =
  documentBytes <= FIRST_ROUND_TRIP_BYTES
    ? `fits, ${FIRST_ROUND_TRIP_BYTES - documentBytes} bytes to spare`
    : `does not fit, ${documentBytes - FIRST_ROUND_TRIP_BYTES} bytes over`;
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
| Initial script transfer | ${kb(initialScriptBytes)} |
| All script transfer (including loaded later) | ${kb(script?.transferSize)} (${script?.requestCount ?? 0} requests) |
| Font transfer | ${kb(font?.transferSize)} |
| HTML document transfer | ${documentBytes.toLocaleString('en-US')} bytes |
| Total transfer size | ${kb(total?.transferSize)} |

**LCP target (under 2.5 s): ${verdict}.**

**Initial script target (${SCRIPT_GOAL_KB} KB): ${scriptVerdict}.**

**HTML document in the first round trip (${FIRST_ROUND_TRIP_BYTES.toLocaleString('en-US')} bytes): ${documentVerdict}.**

A single run can land either side of a threshold; compare the median of several runs before calling it.

Numbers vary by machine. Re-run with \`npm run build && npm run start\` in one terminal and \`npm run perf\` in another.
`;
writeFileSync(resolve(outDir, label ? `baseline-${date}-${label}.md` : `baseline-${date}.md`), report);
console.log(report);
