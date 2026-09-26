import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HIT_WINDOW,
  LEAD_IN,
  ScoreKeeper,
  createChart,
  findKeyNote,
  judge,
  tracks,
  type Difficulty,
  type Note,
} from '../src/engine.ts';

const difficulties: Difficulty[] = ['chill', 'flow', 'rush'];

test('charts are deterministic, ordered, playable, and bounded by their track', () => {
  for (const track of tracks) {
    for (const difficulty of difficulties) {
      const chart = createChart(track, difficulty);
      assert.deepEqual(chart, createChart(track, difficulty));
      assert.ok(chart.length > 12);
      assert.equal(chart[0].time, LEAD_IN);
      assert.equal(new Set(chart.map((note) => note.id)).size, chart.length);
      assert.ok(chart.some((note) => note.kind === 'key'));
      assert.ok(chart.some((note) => note.kind === 'mouse'));
      for (const [index, note] of chart.entries()) {
        assert.ok(note.time >= LEAD_IN && note.time < track.duration + LEAD_IN);
        assert.ok([0, 1, 2, 3].includes(note.lane));
        assert.equal(note.hit, false);
        assert.equal(note.missed, false);
        if (index > 0) assert.ok(note.time >= chart[index - 1].time);
      }
      for (const kind of ['key', 'mouse'] as const) {
        const handNotes = chart.filter((note) => note.kind === kind);
        for (let index = 1; index < handNotes.length; index++) {
          const gap = handNotes[index].time - handNotes[index - 1].time;
          assert.ok(gap >= 30 / track.bpm - 0.000001, `${difficulty} ${kind}: ${gap}`);
        }
      }
    }
  }
});

test('each difficulty increases note count, and the opening teaches alternating hands', () => {
  for (const track of tracks) {
    const charts = difficulties.map((difficulty) => createChart(track, difficulty));
    assert.ok(charts[0].length < charts[1].length);
    assert.ok(charts[1].length < charts[2].length);
    for (const chart of charts) {
      assert.deepEqual(
        chart.slice(0, 4).map((note) => note.kind),
        ['key', 'mouse', 'key', 'mouse'],
      );
    }
    assert.ok(
      charts[1].some((note, index) => index > 0 && note.time === charts[1][index - 1].time),
    );
  }
});

test('charts are fresh mutable runs and invalid track timing cannot create runaway charts', () => {
  const first = createChart(tracks[0], 'flow');
  first[0].hit = true;
  assert.equal(createChart(tracks[0], 'flow')[0].hit, false);
  assert.deepEqual(createChart({ ...tracks[0], bpm: 0 }, 'flow'), []);
  assert.deepEqual(createChart({ ...tracks[0], bpm: Infinity }, 'flow'), []);
  assert.deepEqual(createChart({ ...tracks[0], duration: 0 }, 'flow'), []);
});

test('75-percent practice preserves the exact chart and stretches only its timing', () => {
  for (const track of tracks) {
    for (const difficulty of difficulties) {
      const normal = createChart(track, difficulty);
      const practice = createChart(
        { ...track, bpm: track.bpm * 0.75, duration: track.duration / 0.75 },
        difficulty,
      );
      assert.equal(practice.length, normal.length, `${track.id} ${difficulty} note count`);
      for (const [index, note] of normal.entries()) {
        assert.equal(practice[index].lane, note.lane);
        assert.equal(practice[index].kind, note.kind);
        assert.equal(practice[index].sliceDirection, note.sliceDirection);
        assert.ok(
          Math.abs(practice[index].time - (LEAD_IN + (note.time - LEAD_IN) / 0.75)) < 0.000001,
        );
      }
    }
  }
});

test('block directions are balanced and independent of quadrant while keyboard notes have none', () => {
  for (const track of tracks) {
    for (const difficulty of difficulties) {
      const chart = createChart(track, difficulty);
      const mouseNotes = chart.filter((note) => note.kind === 'mouse');
      const counts = [0, 0, 0, 0];
      for (const note of mouseNotes) {
        assert.notEqual(note.sliceDirection, undefined);
        counts[note.sliceDirection!]++;
      }
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
      for (const lane of [0, 1, 2, 3]) {
        assert.ok(
          new Set(
            mouseNotes.filter((note) => note.lane === lane).map((note) => note.sliceDirection),
          ).size > 1,
        );
      }
      assert.ok(
        chart.filter((note) => note.kind === 'key').every((note) => !('sliceDirection' in note)),
      );
    }
  }
});

test('timing judgments are symmetric and include the exact timing boundaries', () => {
  assert.equal(judge(0), 'perfect');
  assert.equal(judge(0.075), 'perfect');
  assert.equal(judge(-0.075), 'perfect');
  assert.equal(judge(0.076), 'good');
  assert.equal(judge(HIT_WINDOW), 'good');
  assert.equal(judge(-HIT_WINDOW), 'good');
  assert.equal(judge(HIT_WINDOW + 0.001), null);
  assert.equal(judge(-HIT_WINDOW - 0.001), null);
  assert.equal(judge(NaN), null);
  assert.equal(judge(Infinity), null);
});

test('key matching chooses the nearest available matching lane, excluding other inputs and resolved notes', () => {
  const notes: Note[] = [
    { id: 0, kind: 'key', lane: 0, time: 3, hit: false, missed: false },
    { id: 1, kind: 'key', lane: 0, time: 3.12, hit: false, missed: false },
    { id: 2, kind: 'mouse', lane: 0, time: 3.11, hit: false, missed: false },
    { id: 3, kind: 'key', lane: 1, time: 3.11, hit: false, missed: false },
    { id: 4, kind: 'key', lane: 0, time: 3.11, hit: true, missed: false },
    { id: 5, kind: 'key', lane: 0, time: 3.11, hit: false, missed: true },
  ];
  assert.equal(findKeyNote(notes, 0, 3.11)?.id, 1);
  assert.equal(findKeyNote(notes, 0, 2.99)?.id, 0);
  assert.equal(findKeyNote(notes, 2, 3.11), undefined);
  assert.equal(findKeyNote(notes, 0, 4), undefined);
  assert.equal(notes[1].hit, false, 'finding a note should not resolve it');
});

test('scorekeeper applies combo bonuses, caps the multiplier, and retains max combo after a miss', () => {
  const score = new ScoreKeeper();
  assert.equal(score.accuracy, 100);
  assert.equal(score.multiplier, 1);
  for (let index = 0; index < 9; index++) score.hit('perfect');
  assert.equal(score.score, 900);
  assert.equal(score.multiplier, 1);
  score.hit('perfect');
  assert.equal(score.score, 1100);
  assert.equal(score.multiplier, 2);
  for (let index = 0; index < 40; index++) score.hit('perfect');
  assert.equal(score.combo, 50);
  assert.equal(score.multiplier, 4);
  score.miss();
  assert.equal(score.combo, 0);
  assert.equal(score.multiplier, 1);
  assert.equal(score.maxCombo, 50);
  assert.equal(score.misses, 1);
  assert.ok(Math.abs(score.accuracy - (100 * 50) / 51) < 0.00001);
});

test('accuracy weights good hits and misses while score starts a new combo after a miss', () => {
  const score = new ScoreKeeper();
  score.hit('perfect');
  score.hit('good');
  score.miss();
  assert.equal(score.score, 165);
  assert.equal(score.perfect, 1);
  assert.equal(score.good, 1);
  assert.ok(Math.abs(score.accuracy - 55) < 0.00001);
  score.hit('good');
  assert.equal(score.score, 230);
  assert.equal(score.combo, 1);
  assert.equal(score.maxCombo, 2);
});
