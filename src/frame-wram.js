/**
 * The game memory (64 KB WRAM) captured with a frame, for "which screen is this?" by memory
 * fingerprint (src/pool-match-by-ram.js).
 *
 * Captures carry a RAM dump (`ramdumps/<stem>.wram.bin`). Some frames have only a save state,
 * which holds the same memory: the live Current (Colorize!) frame has just the pack's root
 * `save-state.state`, and older captures may lack the dump. Reading the memory out of the save
 * state lets those frames be identified too.
 */
import { tryExtractWramFromMednafenSavestate } from './mednafen-savestate-wram.js';

export const WRAM_BYTES = 0x10000;

/** `ramdumps/F-A.wram.bin`, `vipstates/f-a.json`, `f-a.state` → `f-a` */
export function frameStem(name) {
  return String(name || '')
    .trim()
    .replace(/^(ramdumps|vipstates|savestates)\//i, '')
    .replace(/\.wram\.bin$/i, '')
    .replace(/\.(bin|json|state)$/i, '')
    .toLowerCase();
}

/**
 * @param {{
 *   names: string[],                             frame file names to try, best first
 *   isCurrent: boolean,                           the live Current (Colorize!) frame
 *   ramDumpsByStem: Map<string, Uint8Array>,
 *   saveStatesByStem: Map<string, Uint8Array>,
 *   rootSaveState: Uint8Array | null,             the pack's save-state.state
 *   extract?: (state: Uint8Array) => Uint8Array | null,
 * }} args
 * @returns {{ wram: Uint8Array, source: 'ramdump' | 'savestate' | 'current-savestate' } | null}
 */
export function findFrameWram({ names, isCurrent, ramDumpsByStem, saveStatesByStem, rootSaveState, extract = tryExtractWramFromMednafenSavestate }) {
  const stems = [...new Set(names.map(frameStem).filter(Boolean))];
  for (const stem of stems) {
    const dump = ramDumpsByStem.get(stem);
    if (dump && dump.byteLength >= WRAM_BYTES) return { wram: dump, source: 'ramdump' };
  }
  const fromState = (state) => {
    const wram = state && state.byteLength ? extract(state) : null;
    return wram && wram.byteLength >= WRAM_BYTES ? wram.subarray(0, WRAM_BYTES) : null;
  };
  for (const stem of stems) {
    const wram = fromState(saveStatesByStem.get(stem));
    if (wram) return { wram, source: 'savestate' };
  }
  if (isCurrent) {
    const wram = fromState(rootSaveState);
    if (wram) return { wram, source: 'current-savestate' };
  }
  return null;
}
