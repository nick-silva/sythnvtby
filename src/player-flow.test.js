import { describe, it, expect } from 'vitest';
import { playerReadiness } from './player-flow.js';

const id = { sha1: 'a'.repeat(40), crc32: '12345678', size: 524288 };
const rom = { name: "Mario's Tennis (Japan, USA).vb", id };
const pack = (romInfo = { sha1: id.sha1, fileName: "Mario's Tennis (Japan, USA).vb" }) => ({ info: { title: 'Mario’s Tennis', rom: romInfo } });

describe('playerReadiness', () => {
  it('asks for whatever is missing', () => {
    expect(playerReadiness({ rom: null, pack: null })).toMatchObject({ kind: 'need-both', canPlay: false });
    const needRom = playerReadiness({ rom: null, pack: pack() });
    expect(needRom).toMatchObject({ kind: 'need-rom', canPlay: false });
    expect(needRom.message).toContain("Mario's Tennis (Japan, USA).vb");
  });

  it('plays a ROM alone in monochrome', () => {
    expect(playerReadiness({ rom, pack: null })).toMatchObject({ kind: 'need-pack', canPlay: true, colour: false });
  });

  it('plays in colour when the ROM is the one the pack was made for', () => {
    expect(playerReadiness({ rom, pack: pack() })).toMatchObject({ kind: 'ready', canPlay: true, colour: true });
  });

  it('warns about a different ROM, and plays anyway once accepted', () => {
    const other = pack({ sha1: 'b'.repeat(40), fileName: 'Other.vb' });
    const warn = playerReadiness({ rom, pack: other });
    expect(warn).toMatchObject({ kind: 'mismatch', canPlay: true });
    expect(warn.message).toContain('Other.vb');
    expect(playerReadiness({ rom, pack: other, mismatchAccepted: true }).kind).toBe('ready');
  });
});
