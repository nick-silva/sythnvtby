import { describe, it, expect } from 'vitest';
import { frameStepAction, StateHistory, BIG_STEP } from './frame-step.js';

const key = (k, extra = {}) => ({ key: k, target: { tagName: 'CANVAS' }, ...extra });

describe('frameStepAction', () => {
  it('maps P, period and comma; Shift steps ten frames', () => {
    expect(frameStepAction(key('p'))).toEqual({ action: 'pause' });
    expect(frameStepAction(key('.'))).toEqual({ action: 'forward', frames: 1 });
    expect(frameStepAction(key(','))).toEqual({ action: 'back', frames: 1 });
    expect(frameStepAction(key('>', { shiftKey: true }))).toEqual({ action: 'forward', frames: BIG_STEP });
    expect(frameStepAction(key('<', { shiftKey: true }))).toEqual({ action: 'back', frames: BIG_STEP });
    expect(frameStepAction(key('P', { shiftKey: true }))).toEqual({ action: 'pause' });
  });

  it('lets a held step key repeat, but not pause', () => {
    expect(frameStepAction(key('.', { repeat: true }))).toEqual({ action: 'forward', frames: 1 });
    expect(frameStepAction(key('p', { repeat: true }))).toBeNull();
  });

  it('stays out of the way while typing, with Ctrl/Alt/Meta, and for game keys', () => {
    expect(frameStepAction(key('p', { target: { tagName: 'INPUT' } }))).toBeNull();
    expect(frameStepAction(key('.', { target: { isContentEditable: true } }))).toBeNull();
    expect(frameStepAction(key('p', { ctrlKey: true }))).toBeNull();
    expect(frameStepAction(key('x'))).toBeNull();
    expect(frameStepAction(key('ArrowLeft'))).toBeNull();
  });
});

describe('StateHistory', () => {
  const state = (n) => new Uint8Array([n, n, n]);

  it('numbers frames and keeps only the last `limit`', () => {
    const h = new StateHistory(3);
    for (let i = 1; i <= 5; i++) h.push(state(i));
    expect(h.size).toBe(3);
    expect(h.frame).toBe(5);
    expect(h.entries.map((e) => e.bytes[0])).toEqual([3, 4, 5]);
  });

  it('steps back by handing over the state `replay` frames before the target, which that many frames turn into the target', () => {
    const h = new StateHistory(10, 2);
    for (let i = 1; i <= 6; i++) h.push(state(i)); // states after frames 1–6; frame 6 on screen
    expect(h.canStepBack).toBe(3);
    const back = h.stepBack(2); // show frame 4: load the state after frame 2, run two frames
    expect(back).toMatchObject({ frames: 2, replay: 2 });
    expect([...back.state]).toEqual([2, 2, 2]);
    expect(h.frame).toBe(2);
    h.push(state(3)); // the replayed frames are recorded again
    h.push(state(4));
    expect(h.frame).toBe(4);
    expect(h.canStepBack).toBe(1);
  });

  it('with one replay frame, loads the state just before the target', () => {
    const h = new StateHistory(10, 1);
    for (let i = 1; i <= 4; i++) h.push(state(i));
    expect([...h.stepBack(1).state]).toEqual([2, 2, 2]); // show frame 3: the state after frame 2
  });

  it('never steps back further than it holds', () => {
    const h = new StateHistory(10, 2);
    h.push(state(1));
    h.push(state(2));
    expect(h.stepBack(1)).toBeNull();
    h.push(state(3));
    h.push(state(4));
    expect(h.stepBack(50).frames).toBe(1);
  });

  it('reuses buffers rather than allocating one per frame', () => {
    const h = new StateHistory(2, 1);
    h.push(state(1));
    h.push(state(2));
    const first = h.entries[0].bytes;
    h.push(state(3)); // drops frame 1, reusing its buffer
    expect(h.entries[1].bytes).toBe(first);
    expect(h.entries[1].bytes[0]).toBe(3);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.frame).toBe(0);
  });
});
