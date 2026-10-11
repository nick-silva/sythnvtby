/**
 * Browser regression runner. Usage: npm run test:e2e [-- s2 s4]
 * Starts the Vite dev server if needed, picks targets, runs sections in order, writes .out/report.{json,md}.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE, OUT, REPO_ROOT, ROM, PACK_ANNOTATED, PACK_PLAIN } from './harness.mjs';

const HERE = resolve(REPO_ROOT, 'tests', 'e2e');
// `local: false`: needs no ROM or local packs (the synthetic fixture), so it runs anywhere, CI too.
const SECTIONS = [
  { id: 's0', file: 's0-fixture.mjs', needs: [], local: false },
  { id: 's1', file: 's1-emulator.mjs', needs: [] },
  { id: 's2', file: 's2-painter.mjs', needs: [] },
  { id: 's3', file: 's3-poses.mjs', needs: [] },
  { id: 's4', file: 's4-roundtrip.mjs', needs: ['s3'] },
  { id: 's5', file: 's5-compat.mjs', needs: ['s2', 's3'] },
  { id: 's6', file: 's6-sprite-studio.mjs', needs: ['s2', 's3'] },
  { id: 's7', file: 's7-auto-capture.mjs', needs: [] },
  { id: 's8', file: 's8-player.mjs', needs: [] },
  { id: 's9', file: 's9-performance.mjs', needs: [] },
];

function withDependencies(ids) {
  const wanted = new Set(ids);
  for (const s of [...SECTIONS].reverse()) if (wanted.has(s.id)) s.needs.forEach((n) => wanted.add(n));
  return SECTIONS.filter((s) => wanted.has(s.id));
}

function run(file) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(HERE, file)], { cwd: REPO_ROOT });
    let out = '';
    const onData = (buf) => {
      const text = buf.toString();
      out += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => done({ code, out }));
  });
}

async function serverUp() {
  try {
    return (await fetch(`${BASE}/tools/project.html`)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return null;
  const port = new URL(BASE).port || '5173';
  const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', port, '--strictPort'], {
    cwd: REPO_ROOT,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    if (await serverUp()) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error(`dev server did not start at ${BASE}`);
}

function parseSection(out) {
  const title = (out.match(/^=== (.+) ===$/m) || [])[1] || '(crashed before start)';
  const tests = [...out.matchAll(/^(PASS|FAIL) (.+?)(?: — (.*))?$/gm)].map((m) => ({ ok: m[1] === 'PASS', name: m[2], detail: m[3] || '' }));
  return { title, tests };
}

const requested = process.argv.slice(2).filter((a) => /^s\d$/.test(a));
const plan = requested.length ? withDependencies(requested) : SECTIONS;
const needsLocalFiles = plan.some((s) => s.local !== false);

const missingInputs = [
  ['VB_ROM', ROM],
  ['VB_PACK_ANNOTATED', PACK_ANNOTATED],
  ['VB_PACK_PLAIN', PACK_PLAIN],
].filter(([, p]) => !existsSync(p));
if (needsLocalFiles && missingInputs.length) {
  console.error(`Missing local test files (set env vars to override, or run only s0):\n${missingInputs.map(([k, p]) => `  ${k}=${p}`).join('\n')}`);
  process.exit(2);
}
const startedAt = new Date().toISOString();
const server = await ensureServer();
const report = { startedAt, base: BASE, sections: [] };

try {
  if (needsLocalFiles) {
    const targets = await run('targets.mjs');
    if (targets.code !== 0) throw new Error('target selection failed (see output above)');
  }
  for (const section of plan) {
    const { code, out } = await run(section.file);
    const parsed = parseSection(out);
    if (code !== 0) parsed.tests.push({ ok: false, name: `${section.file} exited with code ${code}`, detail: out.split('\n').filter(Boolean).slice(-3).join(' | ') });
    report.sections.push({ id: section.id, file: section.file, ...parsed });
  }
} finally {
  server?.kill();
}

report.finishedAt = new Date().toISOString();
const all = report.sections.flatMap((s) => s.tests);
report.passed = all.filter((t) => t.ok).length;
report.failed = all.length - report.passed;
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

const manual = existsSync(resolve(HERE, 'manual-checks.md')) ? readFileSync(resolve(HERE, 'manual-checks.md'), 'utf8') : '';
const md = [
  `# Browser regression report`,
  ``,
  `${report.passed}/${all.length} passed · ${startedAt} → ${report.finishedAt} · ${BASE}`,
  ``,
  ...report.sections.flatMap((s) => [
    `## ${s.title} (${s.tests.filter((t) => t.ok).length}/${s.tests.length})`,
    ...s.tests.map((t) => `- ${t.ok ? 'PASS' : '**FAIL**'} ${t.name}${t.detail ? ` — ${t.detail}` : ''}`),
    ``,
  ]),
  manual,
].join('\n');
writeFileSync(`${OUT}/report.md`, md);
console.log(`\n${report.passed}/${all.length} passed. Report: ${OUT}/report.md`);
process.exit(report.failed ? 1 : 0);
