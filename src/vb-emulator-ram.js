/**
 * Read Virtual Boy WRAM (64 KiB) from the running EmulatorJS Beetle VB core when available.
 * The libretro core exposes this via retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM).
 * If the WASM build does not export these symbols, returns null (caller may still store savestate + VIP).
 *
 * @returns {Uint8Array | null} A **copy** of 0x10000 bytes, or null if unavailable.
 */
export function tryCopyVBSystemRamFromEmulator() {
  /** @see libretro RETRO_MEMORY_SYSTEM_RAM */
  const RETRO_MEMORY_SYSTEM_RAM = 2;

  try {
    const hook = typeof globalThis !== 'undefined' && globalThis.__VB_LAST_WRAM_UINT8__;
    if (hook instanceof Uint8Array && hook.byteLength >= 0x10000) {
      return hook.slice(0, 0x10000);
    }
  } catch (_) {
    /* ignore */
  }

  const emu = typeof window !== 'undefined' && window.EJS_emulator;
  const Module = emu?.gameManager?.Module;
  if (!Module || !Module.HEAPU8) return null;

  let ptr = 0;
  let size = 0;

  try {
    if (typeof Module._retro_get_memory_data === 'function') {
      ptr = Module._retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM) >>> 0;
    }
    if (typeof Module._retro_get_memory_size === 'function') {
      size = Module._retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM) >>> 0;
    }
  } catch (_) {
    ptr = 0;
  }

  if (!ptr || size < 0x10000) {
    try {
      if (typeof Module.ccall === 'function') {
        ptr = Module.ccall('retro_get_memory_data', 'number', ['number'], [RETRO_MEMORY_SYSTEM_RAM]) >>> 0;
        const szFn = Module.ccall('retro_get_memory_size', 'number', ['number'], [RETRO_MEMORY_SYSTEM_RAM]);
        size = (typeof szFn === 'number' && Number.isFinite(szFn) ? szFn : 0) >>> 0;
      }
    } catch (_) {
      ptr = 0;
    }
  }

  if (!ptr || size < 0x10000) {
    try {
      if (typeof Module._get_memory_data === 'function' && typeof Module.stringToNewUTF8 === 'function') {
        const keyPtr = Module.stringToNewUTF8('RETRO_MEMORY_SYSTEM_RAM');
        let infoPtr = 0;
        try {
          infoPtr = Module._get_memory_data(keyPtr);
        } finally {
          Module._free(keyPtr);
        }
        if (infoPtr) {
          let s = '';
          try {
            s = Module.UTF8ToString(infoPtr);
          } finally {
            Module._free(infoPtr);
          }
          const parts = s.split('|');
          size = parseInt(parts[0], 10);
          ptr = parseInt(parts[1], 10) >>> 0;
        }
      }
    } catch (_) {
      ptr = 0;
    }
  }

  if (!ptr || size < 0x10000) return null;

  try {
    return new Uint8Array(Module.HEAPU8.buffer, ptr, 0x10000).slice();
  } catch (_) {
    return null;
  }
}
