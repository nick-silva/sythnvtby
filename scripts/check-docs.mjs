#!/usr/bin/env node
/**
 * Keep the docs honest. Run: npm run docs:check  (add --strict to fail on review warnings too)
 *
 * Every doc outside docs/history/ starts with a small header:
 *
 *   ---
 *   status: current | partial | proposed | living
 *   last-reviewed: 2026-09-18      (or "never")
 *   covers: src/art-pack.js, src/vbcolor-pack.js
 *   ---
 *
 * Errors (exit 1): broken links between docs, mentions of repo files that no longer
 * exist, a current doc without a header, a current doc the master index cannot reach.
 * Needs review (warnings): code listed in `covers:` changed after `last-reviewed`,
 * a doc never reviewed, a `living` planning doc not reviewed for 60 days.
 * docs/history/ is exempt from everything but link checks — it is allowed to describe
 * code that is gone.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const STATUSES = new Set(['current', 'partial', 'proposed', 'living']);
const LIVING_MAX_AGE_DAYS = 60;
const INDEX = 'docs/README.md';

const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim();
// Include new, not-yet-added files too (but not ignored ones): a doc you have just
// written is exactly the one that needs checking.
const tracked = new Set(git('ls-files --cached --others --exclude-standard').split('\n'));
const existsInRepo = (p) => tracked.has(p) || existsSync(resolve(ROOT, p));
const isHistory = (p) => p.startsWith('docs/history/');
const docs = [...tracked].filter((p) => p.startsWith('docs/') && p.endsWith('.md')).sort();
// Local date, like git's %cs — a UTC date would run a day ahead in the evening.
const today = new Date().toLocaleDateString('en-CA');
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** @returns {{ fields: Record<string,string>, body: string } | null} */
function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { fields, body: text.slice(m[0].length) };
}

/** Relative markdown links in a file, resolved to repo paths (anchors dropped). */
function linksIn(file, text) {
  const out = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const pathPart = target.split('#')[0];
    if (!pathPart) continue;
    out.push({ target, path: posix.normalize(posix.join(posix.dirname(file), pathPart)) });
  }
  return out;
}

/** Repo file paths named in prose or code spans, e.g. `src/color-layer.js`. */
function codePathsIn(text) {
  // The trailing (?!\w) stops `.json` being read as `.js` + "on".
  const re = /(?<![\w./-])((?:src|tools|tests|scripts|patches|public)\/[A-Za-z0-9_./-]+\.(?:js|mjs|html|css|py|sh|patch|json|md|data))(?!\w)/g;
  return [...new Set([...text.matchAll(re)].map((m) => m[1]))];
}

const lastChanged = (paths) => {
  const existing = paths.filter(existsInRepo);
  if (!existing.length) return null;
  return git(`log -1 --format=%cs -- ${existing.map((p) => `"${p}"`).join(' ')}`) || null;
};

const errors = [];
const reviews = [];
const reachable = new Set([INDEX]);

// Walk links outward from the master index to find what it can reach.
{
  const queue = [INDEX];
  while (queue.length) {
    const f = queue.pop();
    if (!existsInRepo(f) || !f.endsWith('.md')) continue;
    for (const { path } of linksIn(f, readFileSync(resolve(ROOT, f), 'utf8'))) {
      if (path.startsWith('docs/') && !reachable.has(path)) {
        reachable.add(path);
        queue.push(path);
      }
    }
  }
}

for (const file of [...docs, 'README.md']) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  for (const { target, path } of linksIn(file, text)) {
    if (!existsInRepo(path)) errors.push(`${file}: broken link → ${target}`);
  }
  if (file === 'README.md' || isHistory(file)) continue;

  for (const p of codePathsIn(text)) {
    if (!existsInRepo(p)) errors.push(`${file}: mentions ${p}, which does not exist`);
  }
  if (!reachable.has(file)) errors.push(`${file}: not reachable from ${INDEX}`);

  const fm = frontMatter(text);
  if (!fm) {
    errors.push(`${file}: no header (status / last-reviewed / covers)`);
    continue;
  }
  const { status, 'last-reviewed': reviewed = 'never', covers = '' } = fm.fields;
  if (!STATUSES.has(status)) errors.push(`${file}: status "${status}" is not one of ${[...STATUSES].join(', ')}`);
  const covered = covers.split(',').map((s) => s.trim()).filter(Boolean);
  for (const c of covered) if (!existsInRepo(c)) errors.push(`${file}: covers ${c}, which does not exist`);

  if (reviewed === 'never' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) {
    reviews.push(`${file}: never reviewed`);
    continue;
  }
  const changed = lastChanged(covered);
  if (changed && changed > reviewed) reviews.push(`${file}: ${covered.join(', ')} changed ${changed}, reviewed ${reviewed}`);
  if (status === 'living' && daysBetween(reviewed, today) > LIVING_MAX_AGE_DAYS) {
    reviews.push(`${file}: planning doc last reviewed ${reviewed} (${daysBetween(reviewed, today)} days ago)`);
  }
}

const current = docs.filter((d) => !isHistory(d));
console.log(`docs: ${docs.length} (${current.length} current, ${docs.length - current.length} history)`);
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
}
if (reviews.length) {
  console.log(`\nNeeds review (${reviews.length}):`);
  for (const r of reviews) console.log(`  • ${r}`);
  console.log(`\nAfter checking a doc against the code, set its last-reviewed to today (${today}).`);
}
if (!errors.length && !reviews.length) console.log('All docs linked, reviewed, and pointing at code that exists.');
process.exit(errors.length || (STRICT && reviews.length) ? 1 : 0);
