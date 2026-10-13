/**
 * Auto-paint: colour a group's unpainted poses from poses already painted. Not pixel for pixel —
 * poses differ — but by neighbourhood: each unpainted pixel takes the colour of the reference
 * pixels whose surroundings look most alike (the mix of shades around them at several sizes, how
 * deep inside the sprite they sit, how high up). Neighbours then vote, small specks are folded
 * into what surrounds them, and every tile pattern pixel takes the colour most poses gave it,
 * because paint is stored per pattern.
 *
 * Pure: SpriteStudio builds the pose grids (tools/sprite-studio/autopaint.js) and writes the
 * result as one undoable change.
 */

/**
 * @typedef {{ s: number, h: number, o: number, c: number[] | null }} PosePixel
 *   s: shade the game shows (0–3), h: pattern hash, o: pixel inside the pattern (ly * 8 + lx),
 *   c: painted [r, g, b], or null when nobody chose a colour
 * @typedef {{ id: string, w: number, h: number, px: Array<PosePixel | null> }} PoseGrid
 *   px row by row; null where the pose draws nothing
 */

export const AUTOPAINT_OPTIONS = Object.freeze({
  /** Box sizes (half-widths) the shade mix is measured over. */
  radii: Object.freeze([1, 2, 3, 5, 8, 12]),
  /** Weight of how high up the sprite a pixel is (0 top, 1 bottom). */
  weightHeight: 0.6,
  /** Weight per pixel of depth inside the sprite, capped at MAX_DEPTH. */
  weightDepth: 0.08,
  /** Reference pixels asked per pixel. */
  neighbours: 7,
  /** Rounds of neighbours voting (same shade, 5×5). */
  smoothPasses: 2,
  /** Patches this small that differ from everything around them are folded in. */
  speckSize: 3,
});

const MAX_DEPTH = 10;
/** A painted pixel's vote, against the few that a guess gets. */
const PAINTED_VOTE = 1000;
/** A pose is taken as a reference by default when this much of it is painted. */
export const REFERENCE_SHARE = 0.95;

/** Share of a pose's lit pixels that are painted. */
export function paintedShare(pose) {
  let lit = 0;
  let painted = 0;
  for (const q of pose.px) {
    if (!q) continue;
    lit++;
    if (q.c) painted++;
  }
  return lit ? painted / lit : 0;
}

/** Per-pixel features: shade mix around it at each radius, height, depth. */
function poseFeatures(pose, opts) {
  const { w, h } = pose;
  const cls = new Uint8Array(w * h);
  pose.px.forEach((q, j) => (cls[j] = q ? q.s + 1 : 0)); // 0 empty, 1–4 shade 0–3
  const W1 = w + 1;
  const sums = [0, 1, 2, 3, 4].map(() => new Int32Array(W1 * (h + 1)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 5; c++) {
        const s = sums[c];
        s[(y + 1) * W1 + x + 1] = (cls[y * w + x] === c ? 1 : 0) + s[y * W1 + x + 1] + s[(y + 1) * W1 + x] - s[y * W1 + x];
      }
    }
  }
  const share = (c, x, y, r) => {
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(w, x + r + 1);
    const y1 = Math.min(h, y + r + 1);
    const s = sums[c];
    const inside = s[y1 * W1 + x1] - s[y0 * W1 + x1] - s[y1 * W1 + x0] + s[y0 * W1 + x0];
    const area = (2 * r + 1) ** 2;
    // Past the grid's edge is empty too.
    return c === 0 ? (inside + area - (x1 - x0) * (y1 - y0)) / area : inside / area;
  };
  const depth = depthMap(cls, w, h);
  let top = h;
  let bottom = 0;
  for (let j = 0; j < w * h; j++) {
    if (!cls[j]) continue;
    const y = (j / w) | 0;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const span = Math.max(1, bottom - top);
  return pose.px.map((q, j) => {
    if (!q) return null;
    const x = j % w;
    const y = (j / w) | 0;
    const f = [];
    for (const r of opts.radii) for (let c = 0; c < 5; c++) f.push(share(c, x, y, r));
    f.push((opts.weightHeight * (y - top)) / span);
    f.push(opts.weightDepth * Math.min(depth[j], MAX_DEPTH));
    return Float32Array.from(f);
  });
}

/** Steps (8-way) from each lit pixel to the nearest empty one or the grid's edge. */
function depthMap(cls, w, h) {
  const depth = new Int16Array(w * h).fill(32767);
  const queue = [];
  for (let j = 0; j < w * h; j++) {
    const x = j % w;
    const y = (j / w) | 0;
    if (!cls[j]) depth[j] = 0;
    else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) depth[j] = 1;
    else continue;
    queue.push(j);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const j = queue[qi];
    const x = j % w;
    const y = (j / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const k = Y * w + X;
        if (depth[k] > depth[j] + 1) {
          depth[k] = depth[j] + 1;
          queue.push(k);
        }
      }
    }
  }
  return depth;
}

const colourKey = (c) => `${c[0]},${c[1]},${c[2]}`;
const keyColour = (k) => k.split(',').map(Number);
const total = (votes) => Object.values(votes).reduce((a, b) => a + b, 0) || 1;
const top = (votes) => Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/** Reference pixels grouped by shade: features and colour. */
function referenceBank(refs, featuresOf) {
  const bank = [[], [], [], []];
  for (const pose of refs) {
    const F = featuresOf(pose);
    pose.px.forEach((q, j) => {
      if (q?.c) bank[q.s].push({ f: F[j], c: colourKey(q.c) });
    });
  }
  return bank;
}

/** The k nearest reference colours, weighted by closeness. */
function nearestVotes(f, entries, k) {
  const best = [];
  for (const e of entries) {
    let d = 0;
    for (let i = 0; i < f.length; i++) {
      const t = f[i] - e.f[i];
      d += t * t;
    }
    if (best.length < k) {
      best.push([d, e.c]);
      best.sort((a, b) => a[0] - b[0]);
    } else if (d < best[k - 1][0]) {
      best[k - 1] = [d, e.c];
      best.sort((a, b) => a[0] - b[0]);
    }
  }
  const votes = {};
  for (const [d, c] of best) votes[c] = (votes[c] || 0) + 1 / (1e-3 + d);
  return votes;
}

/** A colour per lit pixel of a target pose (painted pixels keep theirs). */
function predictPose(pose, F, bank, opts) {
  let votes = pose.px.map((q, j) => {
    if (!q) return null;
    if (q.c) return { [colourKey(q.c)]: PAINTED_VOTE };
    return bank[q.s].length ? nearestVotes(F[j], bank[q.s], opts.neighbours) : null;
  });
  for (let pass = 0; pass < opts.smoothPasses; pass++) votes = smooth(pose, votes);
  const labels = votes.map((v) => (v ? top(v) : null));
  return despeckle(pose, labels, opts.speckSize);
}

/** Each unpainted pixel adds the votes of same-shade pixels around it (5×5), as shares. */
function smooth(pose, votes) {
  const { w, h, px } = pose;
  return votes.map((own, j) => {
    const q = px[j];
    if (!q || q.c || !own) return own;
    const x = j % w;
    const y = (j / w) | 0;
    const mixed = {};
    const add = (v) => {
      const t = total(v);
      for (const [c, s] of Object.entries(v)) mixed[c] = (mixed[c] || 0) + s / t;
    };
    add(own);
    const around = {};
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || (!dx && !dy)) continue;
        const k = Y * w + X;
        if (px[k]?.s !== q.s || !votes[k]) continue;
        const t = total(votes[k]);
        for (const [c, s] of Object.entries(votes[k])) around[c] = (around[c] || 0) + s / t;
      }
    }
    if (Object.keys(around).length) add(around);
    return mixed;
  });
}

/**
 * Small patches (same colour, same shade, all guessed) whose same-shade surroundings are all one
 * other colour take that colour: the orange fleck in a white eye.
 */
function despeckle(pose, labels, maxSize) {
  const { w, h, px } = pose;
  const out = labels.slice();
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !px[start] || !out[start]) continue;
    const patch = [start];
    seen[start] = 1;
    let guessed = !px[start].c;
    const border = {};
    for (let i = 0; i < patch.length; i++) {
      const j = patch[i];
      const x = j % w;
      const y = (j / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const k = Y * w + X;
        if (!px[k] || px[k].s !== px[start].s || !out[k]) continue;
        if (out[k] === out[start]) {
          if (!seen[k]) {
            seen[k] = 1;
            patch.push(k);
            if (px[k].c) guessed = false;
          }
        } else border[out[k]] = (border[out[k]] || 0) + 1;
      }
    }
    const others = Object.keys(border);
    if (guessed && patch.length <= maxSize && others.length === 1) for (const j of patch) out[j] = others[0];
  }
  return out;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Colour the target poses from the reference poses.
 * @param {{
 *   poses: PoseGrid[],
 *   referenceIds: string[],
 *   targetIds: string[],
 *   onProgress?: (p: { done: number, total: number, label: string }) => void,
 *   shouldStop?: () => boolean,
 *   options?: Partial<typeof AUTOPAINT_OPTIONS>,
 * }} args
 * @returns {Promise<{ fills: Map<number, Map<number, number[]>>, pixels: number, posesPainted: number, stopped: boolean }>}
 *   fills: pattern hash → pixel (ly * 8 + lx) → [r, g, b], only for pattern pixels nobody painted
 *   and that no reference pose shows
 */
export async function autopaint({ poses, referenceIds, targetIds, onProgress = () => {}, shouldStop = () => false, options = {} }) {
  const opts = { ...AUTOPAINT_OPTIONS, ...options };
  const refSet = new Set(referenceIds);
  const refs = poses.filter((p) => refSet.has(p.id));
  const targets = poses.filter((p) => targetIds.includes(p.id) && !refSet.has(p.id));
  const empty = { fills: new Map(), pixels: 0, posesPainted: 0, stopped: false };
  if (!refs.length || !targets.length) return empty;

  const featureCache = new Map();
  const featuresOf = (p) => {
    if (!featureCache.has(p.id)) featureCache.set(p.id, poseFeatures(p, opts));
    return featureCache.get(p.id);
  };
  const steps = targets.length + 1;
  onProgress({ done: 0, total: steps, label: `Learning from ${refs.length} reference pose${refs.length === 1 ? '' : 's'}…` });
  await pause();
  const bank = referenceBank(refs, featuresOf);

  // A pattern pixel a reference shows is the reference's, painted or not.
  const locked = new Set();
  for (const p of refs) for (const q of p.px) if (q) locked.add(`${q.h}:${q.o}`);

  const votes = new Map(); // "hash:o" → { colour: count }
  let posesPainted = 0;
  for (const [n, pose] of targets.entries()) {
    if (shouldStop()) return { ...empty, stopped: true };
    onProgress({ done: n + 1, total: steps, label: `Painting ${pose.id} (${n + 1} of ${targets.length})…` });
    await pause();
    const labels = predictPose(pose, featuresOf(pose), bank, opts);
    pose.px.forEach((q, j) => {
      if (!q || q.c || !labels[j]) return;
      const key = `${q.h}:${q.o}`;
      if (locked.has(key)) return;
      const v = votes.get(key) || {};
      v[labels[j]] = (v[labels[j]] || 0) + 1;
      votes.set(key, v);
    });
    posesPainted++;
  }

  const fills = new Map();
  for (const [key, v] of votes) {
    const [h, o] = key.split(':').map(Number);
    if (!fills.has(h)) fills.set(h, new Map());
    fills.get(h).set(o, keyColour(top(v)));
  }
  onProgress({ done: steps, total: steps, label: 'Done.' });
  return { fills, pixels: votes.size, posesPainted, stopped: false };
}
