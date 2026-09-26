export type Difficulty = 'chill' | 'flow' | 'rush';
export type NoteKind = 'key' | 'mouse';
export type Lane = 0 | 1 | 2 | 3;

export interface Note {
  id: number;
  kind: NoteKind;
  time: number;
  lane: Lane;
  /** Mouse block position and required saber direction are independent. */
  sliceDirection?: Lane;
  hit: boolean;
  missed: boolean;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /** Playable music duration in seconds, excluding the count-in. */
  duration: number;
  color: string;
  subtitle: string;
}

export const tracks: Track[] = [
  {
    id: 'afterglow',
    title: 'Afterglow',
    artist: 'SPLITBEAT ORIGINALS',
    bpm: 100,
    duration: 60,
    color: '#F5A66C',
    subtitle: 'Golden-hour grooves',
  },
  {
    id: 'nightdrive',
    title: 'Night Drive',
    artist: 'SPLITBEAT ORIGINALS',
    bpm: 120,
    duration: 64,
    color: '#B8DEC1',
    subtitle: 'A little after midnight',
  },
  {
    id: 'hyperlink',
    title: 'Hyperlink',
    artist: 'SPLITBEAT ORIGINALS',
    bpm: 140,
    duration: 60,
    color: '#C7B8EF',
    subtitle: 'Disconnect. Lock in.',
  },
];

export const HIT_WINDOW = 0.16;
export const LEAD_IN = 3;

type HandPattern = Record<NoteKind, readonly number[]>;

// Offsets are beats within a 16-beat phrase. Repeated phrases let players
// learn a movement instead of reacting to an unpredictable random chart.
const patterns: Record<Difficulty, HandPattern> = {
  chill: {
    key: [0, 4, 8, 12],
    mouse: [2, 6, 10, 14],
  },
  flow: {
    key: [0, 1, 3, 4, 6, 8, 9, 11, 12, 14],
    mouse: [0, 2, 4, 5, 7, 8, 10, 12, 13, 15],
  },
  rush: {
    key: [0, 0.5, 2, 3, 4, 5.5, 6, 7, 8, 9.5, 10, 11, 12, 12.5, 14, 15],
    mouse: [0, 1, 2, 3.5, 4, 5, 6.5, 7, 8, 8.5, 10, 11.5, 12, 13, 14, 15.5],
  },
};

const keyLanes: readonly Lane[] = [0, 1, 2, 3, 2, 1, 0, 2];
// Mouse quadrants follow the perimeter, keeping successive travel short.
const mouseLanes: readonly Lane[] = [0, 1, 3, 2, 0, 2, 3, 1];

export function createChart(track: Track, difficulty: Difficulty): Note[] {
  if (
    !Number.isFinite(track.bpm) ||
    track.bpm <= 0 ||
    !Number.isFinite(track.duration) ||
    track.duration <= 0
  )
    return [];

  const beatSeconds = 60 / track.bpm;
  const playableBeats = track.duration / beatSeconds;
  const notes: Note[] = [];
  const handCounts = { key: 0, mouse: 0 };
  const variation = [...track.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;

  const addNote = (kind: NoteKind, beat: number) => {
    const time = LEAD_IN + beat * beatSeconds;
    // Reserve a final beat for the ending. Express the tail in beats so
    // practice changes the tempo without introducing or removing notes.
    if (beat > playableBeats - 1 + 0.000000001) return;
    const lanes = kind === 'key' ? keyLanes : mouseLanes;
    const lane = lanes[(handCounts[kind] + variation) % lanes.length];
    // Each eight-block phrase uses every direction twice. Rotate directions
    // across phrases so a quadrant never implies a particular movement.
    const sliceDirection =
      kind === 'mouse'
        ? (((handCounts.mouse + Math.floor(handCounts.mouse / 8) + variation) % 4) as Lane)
        : undefined;
    handCounts[kind]++;
    notes.push({
      id: 0,
      kind,
      time,
      lane,
      ...(sliceDirection === undefined ? {} : { sliceDirection }),
      hit: false,
      missed: false,
    });
  };

  // The first eight beats teach the two hands separately before combining them.
  const introSpacing = difficulty === 'chill' ? 2 : 1;
  for (let beat = 0, index = 0; beat < 8; beat += introSpacing, index++) {
    addNote(index % 2 === 0 ? 'key' : 'mouse', beat);
  }

  for (let phrase = 8; phrase < playableBeats; phrase += 16) {
    for (const kind of ['key', 'mouse'] as const) {
      for (const offset of patterns[difficulty][kind]) addNote(kind, phrase + offset);
    }
  }

  notes.sort((left, right) => left.time - right.time || (left.kind === 'key' ? -1 : 1));
  for (const [index, note] of notes.entries()) note.id = index;
  return notes;
}

export function judge(deltaSeconds: number): 'perfect' | 'good' | null {
  const distance = Math.abs(deltaSeconds);
  if (distance <= 0.075) return 'perfect';
  if (distance <= HIT_WINDOW) return 'good';
  return null;
}

/** Return a candidate without mutating it; the input handler resolves the hit. */
export function findKeyNote(notes: Note[], lane: Lane, time: number): Note | undefined {
  let closest: Note | undefined;
  let closestDistance = Infinity;
  for (const note of notes) {
    if (note.kind !== 'key' || note.lane !== lane || note.hit || note.missed) continue;
    const distance = Math.abs(note.time - time);
    if (distance <= HIT_WINDOW && distance < closestDistance) {
      closest = note;
      closestDistance = distance;
    }
  }
  return closest;
}

export class ScoreKeeper {
  score = 0;
  combo = 0;
  maxCombo = 0;
  perfect = 0;
  good = 0;
  misses = 0;

  get accuracy(): number {
    const total = this.perfect + this.good + this.misses;
    return total === 0 ? 100 : ((this.perfect + this.good * 0.65) / total) * 100;
  }

  get multiplier(): number {
    return Math.min(4, 1 + Math.floor(this.combo / 10));
  }

  hit(quality: 'perfect' | 'good'): void {
    this[quality]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    // The tenth consecutive hit earns the newly reached multiplier.
    this.score += (quality === 'perfect' ? 100 : 65) * this.multiplier;
  }

  miss(): void {
    this.misses++;
    this.combo = 0;
  }
}
