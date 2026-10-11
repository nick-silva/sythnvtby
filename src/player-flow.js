/**
 * The sythnvtby player's start screen as a pure function: given the ROM and play pack chosen so
 * far, what the player says and offers. Kept apart from src/player.js so it can be tested.
 */

import { sameRom } from './rom-identity.js';

/**
 * @param {{
 *   rom: { name: string, id: { sha1: string, crc32: string, size: number } } | null,
 *   pack: { info: { title?: string, rom?: { fileName?: string, sha1?: string, crc32?: string, size?: number } } } | null,
 *   mismatchAccepted?: boolean,
 * }} s
 * @returns {{ kind: 'need-both' | 'need-rom' | 'need-pack' | 'mismatch' | 'ready', message: string, canPlay: boolean, colour: boolean }}
 */
export function playerReadiness({ rom, pack, mismatchAccepted = false }) {
  const title = pack?.info?.title || 'this game';
  if (!rom && !pack) {
    return { kind: 'need-both', message: 'Choose the game’s ROM and its play pack (.vbcplay).', canPlay: false, colour: false };
  }
  if (!rom) {
    const wanted = pack?.info?.rom?.fileName ? ` (${pack.info.rom.fileName})` : '';
    return { kind: 'need-rom', message: `Now choose the ROM for ${title}${wanted}.`, canPlay: false, colour: false };
  }
  if (!pack) {
    return { kind: 'need-pack', message: `${rom.name} is ready. Choose its play pack for colour, or play it in monochrome.`, canPlay: true, colour: false };
  }
  if (!sameRom(pack.info?.rom, rom.id) && !mismatchAccepted) {
    const wanted = pack.info?.rom?.fileName ? `, made for ${pack.info.rom.fileName}` : '';
    return {
      kind: 'mismatch',
      message: `${rom.name} is not the ROM ${title} was made for${wanted}. The colours may land on the wrong tiles.`,
      canPlay: true,
      colour: true,
    };
  }
  return { kind: 'ready', message: `Ready: ${title}.`, canPlay: true, colour: true };
}
