import { judge, type Lane, type Note } from './engine.ts';

export type Point = { x: number; y: number };

export const APPROACH_SECONDS = 2.5;
export const SLICE_DIRECTIONS: readonly {
  label: string;
  arrow: string;
  color: string;
  vector: Point;
}[] = [
  { label: 'Left', arrow: '←', color: '#ff7796', vector: { x: -1, y: 0 } },
  { label: 'Down', arrow: '↓', color: '#65d8ff', vector: { x: 0, y: 1 } },
  { label: 'Up', arrow: '↑', color: '#d7ed88', vector: { x: 0, y: -1 } },
  { label: 'Right', arrow: '→', color: '#b9a0ff', vector: { x: 1, y: 0 } },
];

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;
const lanePitch = (width: number) => Math.min(width * 0.105, 100);

export function blockDirection(note: Note): Lane {
  return note.sliceDirection ?? note.lane;
}

export function fieldScale(width: number, height: number): number {
  return Math.max(0.6, Math.min(1.5, width / 800, height / 400));
}

/** Both inputs share one vanishing point and one compact central corridor. */
export function keyGeometry(
  lane: Lane,
  progress: number,
  width: number,
  height: number,
): Point & { size: number } {
  const depth = Math.pow(Math.max(0, progress), 1.62);
  const pitch = lanePitch(width);
  const size = Math.min(45 * fieldScale(width, height), pitch * 0.75);
  return {
    x: mix(width * 0.5, width * 0.5 + (lane - 1.5) * pitch, depth),
    y: mix(height * 0.17, height * 0.84, depth),
    size: mix(size * 0.23, size, depth),
  };
}

export function blockGeometry(
  note: Note,
  time: number,
  width: number,
  height: number,
): Point & { size: number; angle: number; progress: number } {
  const progress = 1 - (note.time - time) / APPROACH_SECONDS;
  const depth = Math.pow(Math.max(0, progress), 1.62);
  const pitch = lanePitch(width);
  const targetX = width * 0.5 + (note.lane % 2 === 0 ? -1 : 1) * pitch * 0.63;
  const targetY = height * (note.lane < 2 ? 0.57 : 0.73);
  const size = Math.min(68 * fieldScale(width, height), pitch * 0.85);
  return {
    x: mix(width * 0.5, targetX, depth),
    y: mix(height * 0.17, targetY, depth),
    size: mix(size * 0.23, size, depth),
    // Keeping the face upright makes its required cut direction unambiguous.
    angle: 0,
    progress,
  };
}

/** The entire white blade is active; the renderer extends a grip past base. */
export function saberGeometry(
  tip: Point,
  width: number,
  height: number,
): { tip: Point; base: Point; radius: number } {
  const scale = fieldScale(width, height);
  return {
    tip: { ...tip },
    base: { x: tip.x + 45 * scale, y: tip.y + 70 * scale },
    radius: 5 * scale,
  };
}

/** Separating-axis intersection also covers parallel/degenerate blade sweeps. */
function polygonsIntersect(first: Point[], second: Point[]): boolean {
  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index++) {
      const point = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const axis = { x: -(next.y - point.y), y: next.x - point.x };
      if (Math.abs(axis.x) + Math.abs(axis.y) < 0.000001) continue;
      const project = (points: Point[]) => {
        const projections = points.map((p) => p.x * axis.x + p.y * axis.y);
        return { min: Math.min(...projections), max: Math.max(...projections) };
      };
      const a = project(first);
      const b = project(second);
      if (a.max < b.min || b.max < a.min) return false;
    }
  }
  return true;
}

/** Find a timed, correctly directed cut across the visible blade's swept area. */
export function findSaberNote(
  notes: Note[],
  time: number,
  from: Point,
  to: Point,
  width: number,
  height: number,
): Note | undefined {
  if (![time, from.x, from.y, to.x, to.y, width, height].every(Number.isFinite)) return;
  if (width <= 0 || height <= 0) return;
  const movement = { x: to.x - from.x, y: to.y - from.y };
  const distance = Math.hypot(movement.x, movement.y);
  if (distance < 0.000001) return;

  const oldBlade = saberGeometry(from, width, height);
  const newBlade = saberGeometry(to, width, height);
  const sweep = [oldBlade.tip, oldBlade.base, newBlade.base, newBlade.tip];
  const minimumAlignment = Math.cos((50 * Math.PI) / 180);
  let closest: Note | undefined;
  let closestTime = Infinity;

  for (const note of notes) {
    if (note.kind !== 'mouse' || note.hit || note.missed) continue;
    const timing = Math.abs(note.time - time);
    if (!judge(timing) || timing >= closestTime) continue;
    const direction = SLICE_DIRECTIONS[blockDirection(note)].vector;
    const alignment = (movement.x * direction.x + movement.y * direction.y) / distance;
    if (alignment < minimumAlignment) continue;

    const block = blockGeometry(note, time, width, height);
    const half = block.size / 2 + newBlade.radius;
    const cosine = Math.cos(block.angle);
    const sine = Math.sin(block.angle);
    const face = [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ].map((point) => ({
      x: block.x + point.x * cosine - point.y * sine,
      y: block.y + point.x * sine + point.y * cosine,
    }));

    if (polygonsIntersect(sweep, face)) {
      closest = note;
      closestTime = timing;
    }
  }
  return closest;
}
