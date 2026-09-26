import assert from 'node:assert/strict';
import test from 'node:test';
import { HIT_WINDOW, judge, type Lane, type Note } from '../src/engine.ts';
import {
  APPROACH_SECONDS,
  SLICE_DIRECTIONS,
  blockDirection,
  blockGeometry,
  findSaberNote,
  keyGeometry,
  saberGeometry,
  type Point,
} from '../src/playfield.ts';

const width = 1120;
const height = 450;
const lanes: Lane[] = [0, 1, 2, 3];
const makeNote = (changes: Partial<Note> = {}): Note => ({
  id: 0,
  kind: 'mouse',
  time: 5,
  lane: 0,
  sliceDirection: 3,
  hit: false,
  missed: false,
  ...changes,
});

function swipe(note: Note, distance = 80, time = note.time): [Point, Point] {
  const block = blockGeometry(note, time, width, height);
  const direction = SLICE_DIRECTIONS[blockDirection(note)].vector;
  return [
    { x: block.x - direction.x * distance, y: block.y - direction.y * distance },
    { x: block.x + direction.x * distance, y: block.y + direction.y * distance },
  ];
}

test('the four cut directions have distinct colors, arrows, names, and matching vectors', () => {
  assert.deepEqual(
    SLICE_DIRECTIONS.map((direction) => direction.label),
    ['Left', 'Down', 'Up', 'Right'],
  );
  assert.deepEqual(
    SLICE_DIRECTIONS.map((direction) => direction.arrow),
    ['←', '↓', '↑', '→'],
  );
  assert.equal(new Set(SLICE_DIRECTIONS.map((direction) => direction.color)).size, 4);
  assert.deepEqual(
    SLICE_DIRECTIONS.map((direction) => direction.vector),
    [
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ],
  );
  assert.equal(blockDirection(makeNote({ lane: 0, sliceDirection: 2 })), 2);
  assert.equal(blockDirection(makeNote({ lane: 1, sliceDirection: undefined })), 1);
});

test('desktop and mobile notes share a central corridor, fit inside it, and grow toward the player', () => {
  for (const [w, h] of [
    [1120, 450],
    [1920, 650],
    [375, 470],
    [320, 400],
  ]) {
    const keyTargets = lanes.map((lane) => keyGeometry(lane, 1, w, h));
    const blockTargets = lanes.map((lane) => blockGeometry(makeNote({ lane }), 5, w, h));
    for (const target of [...keyTargets, ...blockTargets]) {
      assert.ok(Math.abs(target.x - w / 2) + target.size / 2 < w * 0.21);
      assert.ok(target.y + target.size / 2 < h);
      assert.ok(target.y - target.size / 2 > 0);
    }
    assert.equal((keyTargets[0].x + keyTargets[3].x) / 2, w / 2);
    assert.equal((blockTargets[0].x + blockTargets[1].x) / 2, w / 2);
    assert.ok(blockTargets[0].y < blockTargets[2].y);
    assert.ok(blockTargets[2].y < keyTargets[0].y);
    for (const lane of lanes) {
      const keyStart = keyGeometry(lane, 0, w, h);
      const blockStart = blockGeometry(makeNote({ lane }), 5 - APPROACH_SECONDS, w, h);
      assert.equal(keyStart.x, w / 2);
      assert.equal(blockStart.x, w / 2);
      assert.equal(keyStart.y, blockStart.y);
      assert.ok(keyStart.size < keyTargets[lane].size);
      assert.ok(blockStart.size < blockTargets[lane].size);
      assert.equal(blockTargets[lane].angle, 0);
    }
  }
});

test('each direction accepts a matching movement in every quadrant and rejects its reverse', () => {
  for (const lane of lanes) {
    for (const sliceDirection of lanes) {
      const note = makeNote({ lane, sliceDirection });
      const [from, to] = swipe(note);
      assert.equal(findSaberNote([note], 5, from, to, width, height), note);
      assert.equal(findSaberNote([note], 5, to, from, width, height), undefined);
      assert.equal(note.hit, false, 'finding a cut leaves scoring to the caller');
    }
  }
});

test('stationary clicks and perpendicular motion cannot cut a block', () => {
  const note = makeNote();
  const block = blockGeometry(note, note.time, width, height);
  assert.equal(findSaberNote([note], 5, block, block, width, height), undefined);
  assert.equal(
    findSaberNote(
      [note],
      5,
      { x: block.x, y: block.y - 80 },
      { x: block.x, y: block.y + 80 },
      width,
      height,
    ),
    undefined,
  );
});

test('direction tolerance allows a natural diagonal cut and rejects one beyond fifty degrees', () => {
  const note = makeNote();
  const block = blockGeometry(note, 5, width, height);
  for (const [degrees, expected] of [
    [35, note],
    [60, undefined],
  ] as const) {
    const radians = (degrees * Math.PI) / 180;
    const movement = { x: Math.cos(radians) * 90, y: Math.sin(radians) * 90 };
    const from = { x: block.x - movement.x, y: block.y - movement.y };
    const to = { x: block.x + movement.x, y: block.y + movement.y };
    assert.equal(findSaberNote([note], 5, from, to, width, height), expected);
  }
});

test('cuts are eligible only inside the complete early and late timing window', () => {
  const note = makeNote({ time: 0 });
  for (const offset of [-HIT_WINDOW, 0, HIT_WINDOW]) {
    const time = note.time + offset;
    const [from, to] = swipe(note, 80, time);
    assert.equal(findSaberNote([note], time, from, to, width, height), note);
  }
  for (const offset of [-HIT_WINDOW - 0.001, HIT_WINDOW + 0.001]) {
    const time = note.time + offset;
    const [from, to] = swipe(note, 80, time);
    assert.equal(findSaberNote([note], time, from, to, width, height), undefined);
  }
});

test('saber eligibility uses the same judgment at floating-point timing boundaries as scoring', () => {
  const note = makeNote();
  for (const offset of [-HIT_WINDOW - 1e-10, -HIT_WINDOW, HIT_WINDOW, HIT_WINDOW + 1e-10]) {
    const time = note.time + offset;
    const [from, to] = swipe(note, 80, time);
    const expected = judge(time - note.time) ? note : undefined;
    assert.equal(findSaberNote([note], time, from, to, width, height), expected);
  }
});

test('the visible blade body cuts even when the mouse tip never touches the block', () => {
  const note = makeNote();
  const block = blockGeometry(note, 5, width, height);
  const blade = saberGeometry({ x: 0, y: 0 }, width, height);
  const center = { x: block.x - blade.base.x * 0.8, y: block.y - blade.base.y * 0.8 };
  const from = { x: center.x - 15, y: center.y };
  const to = { x: center.x + 15, y: center.y };
  assert.ok(from.y < block.y - block.size / 2 - blade.radius);
  assert.equal(findSaberNote([note], 5, from, to, width, height), note);
});

test('a fast sweep cuts through a block between pointer events without endpoint overlap', () => {
  const note = makeNote();
  const [from, to] = swipe(note, 400);
  const block = blockGeometry(note, 5, width, height);
  assert.ok(saberGeometry(from, width, height).base.x < block.x - block.size);
  assert.ok(to.x > block.x + block.size);
  assert.equal(findSaberNote([note], 5, from, to, width, height), note);
});

test('a directed sweep that misses the entire visible blade does not cut', () => {
  const note = makeNote();
  const [from, to] = swipe(note);
  from.y -= 150;
  to.y -= 150;
  assert.equal(findSaberNote([note], 5, from, to, width, height), undefined);
});

test('key notes, resolved blocks, and invalid pointer data are excluded', () => {
  const note = makeNote();
  const [from, to] = swipe(note);
  for (const changes of [{ kind: 'key' as const }, { hit: true }, { missed: true }]) {
    assert.equal(findSaberNote([{ ...note, ...changes }], 5, from, to, width, height), undefined);
  }
  assert.equal(findSaberNote([note], NaN, from, to, width, height), undefined);
  assert.equal(findSaberNote([note], 5, { x: Infinity, y: 5 }, to, width, height), undefined);
  assert.equal(findSaberNote([note], 5, from, to, 0, height), undefined);
});

test('overlapping eligible blocks choose the nearest beat without mutating either note', () => {
  const earlier = makeNote({ id: 1, time: 4.9 });
  const closer = makeNote({ id: 2, time: 5.01 });
  const [from, to] = swipe(closer, 100, 5);
  assert.equal(findSaberNote([earlier, closer], 5, from, to, width, height), closer);
  assert.equal(earlier.hit, false);
  assert.equal(closer.hit, false);
});
