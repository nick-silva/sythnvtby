/**
 * Frame metadata a person adds by hand — a name and tags — and the register of colour
 * reference images (docs/design/reference-images.md).
 *
 * Both live in the pack manifest: names and tags extend `frameRegistry` entries, references
 * are a separate `references` block. Pure functions, no DOM: the Project tool edits through
 * them and saves the result.
 */

/** A captured frame's display name: what you typed, else the state it was captured in. */
export function frameDisplayName(entry, fallback = '') {
  const named = typeof entry?.name === 'string' ? entry.name.trim() : '';
  if (named) return named;
  const state = [entry?.stateName, entry?.subStateName].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  return state.length ? state.join(' / ') : fallback;
}

/** Tags from what a person typed: comma or newline separated, deduped case-insensitively. */
export function parseTags(text) {
  const seen = new Map();
  for (const raw of String(text ?? '').split(/[,\n]+/)) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** @param {any} entry */
export function frameTags(entry) {
  return Array.isArray(entry?.tags) ? parseTags(entry.tags.join(',')) : [];
}

/** Every tag in use, for a filter list. */
export function allFrameTags(registry) {
  const all = (Array.isArray(registry) ? registry : []).flatMap((e) => frameTags(e));
  return parseTags(all.join(','));
}

/**
 * A copy of the registry with one frame's fields changed. An empty name or tag list is
 * removed rather than stored blank, so a pack that never used them stays as it was.
 * @param {any[]} registry
 * @param {string} frameId
 * @param {{ name?: string, tags?: string[]|string }} fields
 */
export function updateFrameEntry(registry, frameId, fields) {
  const id = String(frameId ?? '').trim();
  if (!id) return Array.isArray(registry) ? registry : [];
  return (Array.isArray(registry) ? registry : []).map((entry) => {
    if (String(entry?.frameId ?? '') !== id) return entry;
    const next = { ...entry };
    if ('name' in fields) {
      const name = String(fields.name ?? '').trim();
      if (name) next.name = name;
      else delete next.name;
    }
    if ('tags' in fields) {
      const tags = parseTags(Array.isArray(fields.tags) ? fields.tags.join(',') : fields.tags);
      if (tags.length) next.tags = tags;
      else delete next.tags;
    }
    return next;
  });
}

/**
 * Frames whose name, state or tags match `query`; every frame when the query is empty.
 * A query starting with `#` matches tags only.
 */
export function filterFrames(registry, query) {
  const q = String(query ?? '').trim().toLowerCase();
  const rows = Array.isArray(registry) ? registry : [];
  if (!q) return rows;
  const wantTags = q.startsWith('#') ? parseTags(q.slice(1)).map((t) => t.toLowerCase()) : [];
  return rows.filter((entry) => {
    if (wantTags.length) {
      const tags = frameTags(entry).map((t) => t.toLowerCase());
      return wantTags.every((t) => tags.some((have) => have.includes(t)));
    }
    const haystack = [frameDisplayName(entry), entry?.frameId, ...frameTags(entry)].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

// ---------------------------------------------------------------- references

export const REFERENCE_SCOPES = Object.freeze(['frame', 'pool']);

/** @param {string} scope @param {string} scopeId */
export function referenceScopeKey(scope, scopeId) {
  return `${scope}:${String(scopeId ?? '')}`;
}

/** `r-` + time + randomness, like the frame ids the emulator writes. */
export function newReferenceId(now = Date.now(), random = Math.random) {
  return `r-${now.toString(36)}-${random().toString(36).slice(2, 8)}`;
}

/** Normalize whatever is in the manifest into `{ items, active }`. */
export function normalizeReferences(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.filter((r) => r && typeof r.refId === 'string') : [];
  const active = raw?.active && typeof raw.active === 'object' ? { ...raw.active } : {};
  return { items: items.map((r) => ({ ...r })), active };
}

/**
 * Add a reference and make it the active one for its scope.
 * @param {any} raw current `manifest.references`
 * @param {{ refId: string, scope?: 'frame'|'pool', scopeId: string, sourceFrameId?: string,
 *           name?: string, importedAt?: string, originalName?: string,
 *           originalSize?: number[], fit?: Record<string, number> }} meta
 */
export function addReference(raw, meta) {
  const refs = normalizeReferences(raw);
  const scope = REFERENCE_SCOPES.includes(meta.scope) ? meta.scope : 'frame';
  const entry = {
    refId: meta.refId,
    scope,
    scopeId: String(meta.scopeId ?? ''),
    ...(meta.sourceFrameId && { sourceFrameId: meta.sourceFrameId }),
    ...(meta.name && { name: meta.name }),
    importedAt: meta.importedAt || new Date().toISOString(),
    ...(meta.originalName && { originalName: meta.originalName }),
    ...(Array.isArray(meta.originalSize) && { originalSize: meta.originalSize.slice(0, 2) }),
    ...(meta.fit && { fit: { ...meta.fit } }),
  };
  return {
    items: [...refs.items.filter((r) => r.refId !== entry.refId), entry],
    active: { ...refs.active, [referenceScopeKey(scope, entry.scopeId)]: entry.refId },
  };
}

/** Drop a reference, and any "active" pointer to it. */
export function removeReference(raw, refId) {
  const refs = normalizeReferences(raw);
  const active = Object.fromEntries(Object.entries(refs.active).filter(([, id]) => id !== refId));
  return { items: refs.items.filter((r) => r.refId !== refId), active };
}

/** Make an existing reference the active one for its own scope. */
export function setActiveReference(raw, refId) {
  const refs = normalizeReferences(raw);
  const found = refs.items.find((r) => r.refId === refId);
  if (!found) return refs;
  return { ...refs, active: { ...refs.active, [referenceScopeKey(found.scope, found.scopeId)]: refId } };
}

/**
 * The reference to show for a frame: one pinned to the frame itself wins over one for the
 * game state it belongs to, because it was made from this exact screen.
 * @param {any} raw @param {{ frameId?: string, poolId?: string }} where
 */
export function referenceForFrame(raw, where) {
  const refs = normalizeReferences(raw);
  const byId = new Map(refs.items.map((r) => [r.refId, r]));
  const lookups = [];
  if (where?.frameId) lookups.push(['frame', where.frameId]);
  if (where?.poolId) lookups.push(['pool', where.poolId]);
  for (const [scope, scopeId] of lookups) {
    const active = byId.get(refs.active[referenceScopeKey(scope, scopeId)]);
    if (active && active.scope === scope && active.scopeId === scopeId) return active;
    const first = refs.items.find((r) => r.scope === scope && r.scopeId === scopeId);
    if (first) return first;
  }
  return null;
}

/** Every reference that could apply to a frame, frame-scoped first — for a picker. */
export function referencesForFrame(raw, where) {
  const refs = normalizeReferences(raw);
  const match = (scope, scopeId) => refs.items.filter((r) => r.scope === scope && r.scopeId === scopeId);
  return [...(where?.frameId ? match('frame', where.frameId) : []), ...(where?.poolId ? match('pool', where.poolId) : [])];
}

/** File name inside the pack for a reference image. */
export function referenceFileName(refId) {
  return `${String(refId).replace(/[^a-z0-9_.-]/gi, '-')}.png`;
}

/**
 * How to draw an imported image onto the 384×224 frame. Models return odd sizes (a 385×224
 * answer to a 1152×672 export is common), so an aspect within `tolerance` is stretched to
 * fill; anything further off is fitted inside with bars rather than cropped.
 * @returns {{ mode: 'stretch'|'contain', dx: number, dy: number, dw: number, dh: number, scale: number }}
 */
export function referenceFitRect(srcW, srcH, dstW = 384, dstH = 224, tolerance = 0.01) {
  const sw = Math.max(1, Number(srcW) || 1), sh = Math.max(1, Number(srcH) || 1);
  const srcAspect = sw / sh, dstAspect = dstW / dstH;
  if (Math.abs(srcAspect - dstAspect) / dstAspect <= tolerance) {
    return { mode: 'stretch', dx: 0, dy: 0, dw: dstW, dh: dstH, scale: dstW / sw };
  }
  const scale = Math.min(dstW / sw, dstH / sh);
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  return { mode: 'contain', dx: Math.round((dstW - dw) / 2), dy: Math.round((dstH - dh) / 2), dw, dh, scale };
}
