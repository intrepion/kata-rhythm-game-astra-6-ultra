import { HIT_WINDOW, type Lane, type Note } from './engine';
import {
  APPROACH_SECONDS,
  SLICE_DIRECTIONS,
  blockDirection,
  fieldScale,
  keyGeometry,
  blockGeometry,
  saberGeometry,
  findSaberNote,
} from './playfield';

type Quality = 'perfect' | 'good' | 'miss';
type Point = { x: number; y: number };
type Particle = Point & {
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: string;
};
type Pulse = Point & { born: number; color: string; size: number };
type Trail = Point & { born: number };
type Shard = Point & {
  born: number;
  color: string;
  size: number;
  direction: Lane;
  side: number;
};

const ORANGE = '#fa986a';
const CYAN = '#83e9ff';
const LANE_ANGLES = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];
const KEY_LABELS = ['A / ←', 'S / ↓', 'W / ↑', 'D / →'];
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const tint = (color: string, alpha: number) =>
  `${color}${Math.round(clamp(alpha) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** A shared perspective stage, with the same blade and note geometry used for hits. */
export class Arena {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private width = 1120;
  private height = 450;
  private dpr = 1;
  private now = 0;
  private gameTime = 0;
  private reducedMotion = false;
  private flashes: { born: number; quality: Quality }[] = Array.from({ length: 4 }, () => ({
    born: -10,
    quality: 'perfect',
  }));
  private particles: Particle[] = [];
  private pulses: Pulse[] = [];
  private shards: Shard[] = [];
  private trails: Trail[] = [];
  private cursor: Point | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser does not support the game canvas.');
    this.ctx = context;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  private get unit(): number {
    return fieldScale(this.width, this.height);
  }

  private get pitch(): number {
    return Math.min(this.width * 0.105, 100);
  }

  render(state: {
    time: number;
    notes: Note[];
    playing: boolean;
    preview: boolean;
    beat: number;
    reducedMotion: boolean;
  }): void {
    this.now = performance.now() / 1000;
    this.gameTime = state.time;
    this.reducedMotion = state.reducedMotion;
    if (this.reducedMotion) {
      this.particles.length = 0;
      this.shards.length = 0;
      this.trails.length = 0;
    }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.shadowBlur = 0;
    c.fillStyle = '#101a1b';
    c.fillRect(0, 0, this.width, this.height);

    this.background(state.playing ? state.beat : 0);
    this.runway(state.playing);
    this.mouseTargets();
    const visible = (state.preview ? this.previewNotes(state.time) : state.notes)
      .filter(
        (note) =>
          !note.hit &&
          !note.missed &&
          note.time - state.time <= APPROACH_SECONDS &&
          note.time - state.time > -0.23,
      )
      .sort((a, b) => b.time - a.time);
    // Glass blocks sit behind the solid keyboard notes, preserving their legibility.
    for (const note of visible) if (note.kind === 'mouse') this.mouseNote(note);
    for (const note of visible) if (note.kind === 'key') this.keyNote(note);
    this.effects();
    this.saber(state.preview);
    this.labels();
  }

  private background(beat: number): void {
    const c = this.ctx;
    const w = this.width;
    const h = this.height;
    const center = w * 0.5;
    const horizon = h * 0.17;
    const glow = c.createRadialGradient(center, h * 0.43, 0, center, h * 0.43, this.pitch * 3.1);
    glow.addColorStop(0, 'rgba(74, 132, 131, .12)');
    glow.addColorStop(0.6, 'rgba(48, 87, 86, .04)');
    glow.addColorStop(1, 'rgba(16, 26, 27, 0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);

    for (let i = 0; i < 46; i++) {
      const x = (((i * 193 + 71) % 997) / 997) * w;
      const y = (((i * 113 + 29) % 293) / 293) * h * 0.8;
      const flicker = this.reducedMotion ? 1 : 0.8 + Math.sin(this.now * 0.45 + i * 7.2) * 0.2;
      c.fillStyle = `rgba(187, 215, 210, ${(i % 4 === 0 ? 0.22 : 0.09) * flicker})`;
      c.fillRect(x, y, i % 7 === 0 ? 1.5 : 1, i % 7 === 0 ? 1.5 : 1);
    }

    const floor = c.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, 'rgba(118, 165, 162, 0)');
    floor.addColorStop(0.52, 'rgba(118, 165, 162, .055)');
    floor.addColorStop(1, 'rgba(118, 165, 162, .035)');
    c.strokeStyle = floor;
    c.lineWidth = 1;
    for (let i = -7; i <= 7; i++) {
      c.beginPath();
      c.moveTo(center + i * this.pitch * 0.015, horizon);
      c.lineTo(center + i * this.pitch * 0.85, h * 1.12);
      c.stroke();
    }
    const travel = this.reducedMotion ? 0.3 : (beat * 0.18) % 1;
    for (let i = 0; i < 10; i++) {
      const p = (i + travel) / 10;
      const y = horizon + p * p * h * 0.88;
      c.beginPath();
      c.moveTo(center - this.pitch * 6 * p, y);
      c.lineTo(center + this.pitch * 6 * p, y);
      c.stroke();
    }
    const horizonGlow = c.createLinearGradient(center - this.pitch, 0, center + this.pitch, 0);
    horizonGlow.addColorStop(0, 'rgba(148, 211, 206, 0)');
    horizonGlow.addColorStop(0.5, 'rgba(148, 211, 206, .27)');
    horizonGlow.addColorStop(1, 'rgba(148, 211, 206, 0)');
    c.strokeStyle = horizonGlow;
    c.beginPath();
    c.moveTo(center - this.pitch, horizon);
    c.lineTo(center + this.pitch, horizon);
    c.stroke();
  }

  private runway(playing: boolean): void {
    const c = this.ctx;
    const h = this.height;
    for (let lane = 0; lane < 4; lane++) {
      const top = keyGeometry(lane as Lane, 0, this.width, h);
      const bottom = keyGeometry(lane as Lane, 1, this.width, h);
      const halfLane = this.pitch * 0.45;
      const grad = c.createLinearGradient(0, top.y, 0, bottom.y);
      grad.addColorStop(0, 'rgba(224, 155, 105, 0)');
      grad.addColorStop(0.6, 'rgba(224, 155, 105, .012)');
      grad.addColorStop(1, 'rgba(224, 155, 105, .05)');
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(top.x, top.y);
      c.lineTo(bottom.x + halfLane, bottom.y);
      c.lineTo(bottom.x - halfLane, bottom.y);
      c.closePath();
      c.fill();
      c.strokeStyle = 'rgba(241, 162, 111, .055)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(top.x, top.y);
      c.lineTo(bottom.x - this.pitch * 0.5, bottom.y + h * 0.012);
      c.stroke();

      const flash = this.flashes[lane];
      const energy = clamp(1 - (this.now - flash.born) / 0.28);
      if (energy > 0) {
        const color = flash.quality === 'miss' ? '236, 95, 93' : '255, 167, 109';
        const beam = c.createLinearGradient(0, top.y, 0, bottom.y);
        beam.addColorStop(0, `rgba(${color}, 0)`);
        beam.addColorStop(1, `rgba(${color}, ${energy * 0.22})`);
        c.fillStyle = beam;
        c.beginPath();
        c.moveTo(top.x, top.y);
        c.lineTo(bottom.x + halfLane, bottom.y);
        c.lineTo(bottom.x - halfLane, bottom.y);
        c.fill();
      }
      this.arrow(
        bottom.x,
        bottom.y,
        bottom.size,
        lane as Lane,
        energy > 0 ? (flash.quality === 'miss' ? '#ed7771' : '#ffcc99') : ORANGE,
        false,
        energy,
      );
      c.font = `500 ${Math.max(9, 10 * this.unit)}px 'DM Sans', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = playing ? 'rgba(221, 178, 147, .68)' : 'rgba(221, 178, 147, .5)';
      c.fillText(KEY_LABELS[lane], bottom.x, h * 0.929);
    }
    const left = this.width * 0.5 - this.pitch * 2.15;
    const right = this.width * 0.5 + this.pitch * 2.15;
    const strike = c.createLinearGradient(left, 0, right, 0);
    strike.addColorStop(0, 'rgba(247, 154, 99, 0)');
    strike.addColorStop(0.15, 'rgba(247, 154, 99, .23)');
    strike.addColorStop(0.85, 'rgba(247, 154, 99, .23)');
    strike.addColorStop(1, 'rgba(247, 154, 99, 0)');
    c.strokeStyle = strike;
    c.beginPath();
    c.moveTo(left, h * 0.84);
    c.lineTo(right, h * 0.84);
    c.stroke();
  }

  private arrow(
    x: number,
    y: number,
    size: number,
    lane: Lane,
    color: string,
    solid: boolean,
    energy = 0,
  ): void {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(LANE_ANGLES[lane]);
    c.beginPath();
    c.moveTo(0, -size * 0.54);
    c.lineTo(size * 0.48, -size * 0.05);
    c.lineTo(size * 0.22, -size * 0.05);
    c.lineTo(size * 0.22, size * 0.41);
    c.lineTo(-size * 0.22, size * 0.41);
    c.lineTo(-size * 0.22, -size * 0.05);
    c.lineTo(-size * 0.48, -size * 0.05);
    c.closePath();
    c.lineJoin = 'round';
    if (solid) {
      c.strokeStyle = '#111b1c';
      c.lineWidth = 5 * this.unit;
      c.stroke();
      c.shadowColor = 'rgba(250, 141, 91, .27)';
      c.shadowBlur = this.reducedMotion ? 0 : 12 * this.unit;
      const face = c.createLinearGradient(0, -size / 2, 0, size / 2);
      face.addColorStop(0, '#ffc097');
      face.addColorStop(1, '#f18758');
      c.fillStyle = face;
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#ffd4b7';
      c.lineWidth = 0.8 * this.unit;
      c.stroke();
      c.beginPath();
      c.moveTo(-size * 0.2, -size * 0.18);
      c.lineTo(0, -size * 0.39);
      c.lineTo(size * 0.2, -size * 0.18);
      c.strokeStyle = 'rgba(255, 238, 211, .6)';
      c.lineWidth = 1.5 * this.unit;
      c.stroke();
    } else {
      c.fillStyle =
        energy > 0 ? `rgba(252, 165, 111, ${0.12 + energy * 0.19})` : 'rgba(20, 28, 25, .6)';
      c.fill();
      c.strokeStyle = color;
      c.globalAlpha = 0.42 + energy * 0.58;
      c.lineWidth = (1.5 + energy) * this.unit;
      if (energy > 0 && !this.reducedMotion) {
        c.shadowColor = color;
        c.shadowBlur = energy * 18 * this.unit;
      }
      c.stroke();
    }
    c.restore();
  }

  private keyNote(note: Note): void {
    const progress = 1 - (note.time - this.gameTime) / APPROACH_SECONDS;
    const pos = keyGeometry(note.lane, progress, this.width, this.height);
    const previous = keyGeometry(note.lane, Math.max(0, progress - 0.085), this.width, this.height);
    const c = this.ctx;
    c.save();
    c.globalAlpha = clamp(progress * 3) * clamp(1 - Math.max(0, progress - 1) * 8);
    if (!this.reducedMotion) {
      const tail = c.createLinearGradient(previous.x, previous.y, pos.x, pos.y);
      tail.addColorStop(0, 'rgba(241, 139, 88, 0)');
      tail.addColorStop(1, 'rgba(241, 139, 88, .16)');
      c.fillStyle = tail;
      c.beginPath();
      c.moveTo(previous.x - previous.size * 0.18, previous.y);
      c.lineTo(previous.x + previous.size * 0.18, previous.y);
      c.lineTo(pos.x + pos.size * 0.22, pos.y);
      c.lineTo(pos.x - pos.size * 0.22, pos.y);
      c.fill();
    }
    this.arrow(pos.x, pos.y, pos.size, note.lane, ORANGE, true);
    c.restore();
  }

  private brackets(x: number, y: number, half: number, arm: number): void {
    const c = this.ctx;
    for (const dx of [-1, 1])
      for (const dy of [-1, 1]) {
        c.beginPath();
        c.moveTo(x + dx * (half - arm), y + dy * half);
        c.lineTo(x + dx * half, y + dy * half);
        c.lineTo(x + dx * half, y + dy * (half - arm));
        c.stroke();
      }
  }

  private mouseTargets(): void {
    const c = this.ctx;
    c.save();
    c.strokeStyle = 'rgba(165, 206, 210, .17)';
    c.lineWidth = this.unit;
    for (let lane = 0; lane < 4; lane++) {
      const note: Note = {
        id: -1,
        kind: 'mouse',
        lane: lane as Lane,
        time: this.gameTime,
        hit: false,
        missed: false,
      };
      const pos = blockGeometry(note, this.gameTime, this.width, this.height);
      this.brackets(pos.x, pos.y, pos.size * 0.6, pos.size * 0.13);
    }
    c.restore();
  }

  private mouseNote(note: Note): void {
    const c = this.ctx;
    const pos = blockGeometry(note, this.gameTime, this.width, this.height);
    const s = pos.size;
    const half = s * 0.5;
    const depth = s * 0.115;
    const direction = blockDirection(note);
    const { color, label } = SLICE_DIRECTIONS[direction];
    const ready = Math.abs(note.time - this.gameTime) <= HIT_WINDOW;
    c.save();
    c.globalAlpha = clamp(pos.progress * 3) * clamp(1 - Math.max(0, pos.progress - 1) * 8);
    c.translate(pos.x, pos.y);
    c.rotate(pos.angle);

    const approach = half + Math.max(0, note.time - this.gameTime) * 11 * this.unit;
    c.strokeStyle = tint(color, ready ? 0.86 : 0.25);
    c.lineWidth = (ready ? 1.3 : 0.85) * this.unit;
    this.brackets(0, 0, approach + 3 * this.unit, s * 0.14);

    // Delicate glass sides keep approaching keyboard notes visible beneath them.
    c.fillStyle = tint(color, 0.065);
    c.strokeStyle = tint(color, 0.4);
    c.lineWidth = 0.8 * this.unit;
    c.beginPath();
    c.moveTo(-half, -half);
    c.lineTo(-half + depth, -half - depth);
    c.lineTo(half + depth, -half - depth);
    c.lineTo(half + depth, half - depth);
    c.lineTo(half, half);
    c.lineTo(half, -half);
    c.closePath();
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(half, -half);
    c.lineTo(half + depth, -half - depth);
    c.stroke();

    const face = c.createLinearGradient(-half, -half, half, half);
    face.addColorStop(0, tint(color, 0.12));
    face.addColorStop(0.45, tint(color, 0.035));
    face.addColorStop(1, tint(color, 0.08));
    c.fillStyle = face;
    c.fillRect(-half, -half, s, s);
    c.strokeStyle = tint(color, ready ? 1 : 0.78);
    c.lineWidth = (ready ? 1.65 : 1.15) * this.unit;
    if (ready && !this.reducedMotion) {
      c.shadowColor = tint(color, 0.65);
      c.shadowBlur = 12 * this.unit;
    }
    c.strokeRect(-half, -half, s, s);
    c.shadowBlur = 0;
    c.strokeStyle = tint(color, 0.24);
    c.lineWidth = 0.65 * this.unit;
    c.strokeRect(
      -half + 3 * this.unit,
      -half + 3 * this.unit,
      s - 6 * this.unit,
      s - 6 * this.unit,
    );
    // Direction is encoded redundantly by shape, color, and a small word.
    c.save();
    c.translate(0, s > 35 ? -s * 0.06 : 0);
    c.rotate(LANE_ANGLES[direction]);
    c.beginPath();
    c.moveTo(0, -s * 0.275);
    c.lineTo(s * 0.23, -s * 0.015);
    c.lineTo(s * 0.105, -s * 0.015);
    c.lineTo(s * 0.105, s * 0.23);
    c.lineTo(-s * 0.105, s * 0.23);
    c.lineTo(-s * 0.105, -s * 0.015);
    c.lineTo(-s * 0.23, -s * 0.015);
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = '#10191d';
    c.lineWidth = Math.max(3, s * 0.085);
    c.stroke();
    c.fillStyle = color;
    c.fill();
    c.strokeStyle = tint('#ffffff', 0.55);
    c.lineWidth = Math.max(0.5, this.unit * 0.6);
    c.stroke();
    c.restore();
    if (s > 35) {
      c.fillStyle = tint(color, 0.9);
      c.font = `600 ${Math.max(6, s * 0.11)}px 'Space Grotesk', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label.toUpperCase(), 0, s * 0.35);
    }
    c.restore();
  }

  private labels(): void {
    const c = this.ctx;
    c.save();
    c.font = `500 ${Math.max(8, this.unit * 9)}px 'Space Grotesk', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(184, 215, 211, .58)';
    c.fillText('ONE FIELD  ·  TWO HANDS', this.width * 0.5, this.height * 0.093);
    c.restore();
  }

  keyFlash(lane: Lane, quality: Quality): void {
    this.flashes[lane] = { born: performance.now() / 1000, quality };
  }

  burst(note: Note, quality: 'perfect' | 'good'): void {
    const born = performance.now() / 1000;
    const pos =
      note.kind === 'key'
        ? keyGeometry(note.lane, 1, this.width, this.height)
        : blockGeometry(note, this.gameTime, this.width, this.height);
    const direction = blockDirection(note);
    const color = note.kind === 'key' ? ORANGE : SLICE_DIRECTIONS[direction].color;
    this.pulses.push({ x: pos.x, y: pos.y, born, color, size: pos.size });
    if (this.reducedMotion) return;
    if (note.kind === 'mouse') {
      for (const side of [-1, 1])
        this.shards.push({ x: pos.x, y: pos.y, born, color, size: pos.size, direction, side });
    }
    const count = quality === 'perfect' ? 14 : 9;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.25;
      const speed = (35 + Math.random() * 90) * this.unit;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20 * this.unit,
        born,
        life: 0.3 + Math.random() * 0.27,
        size: (1.2 + Math.random() * 2.1) * this.unit,
        color,
      });
    }
  }

  private effects(): void {
    const c = this.ctx;
    this.pulses = this.pulses.filter((pulse) => this.now - pulse.born < 0.38);
    c.save();
    for (const pulse of this.pulses) {
      const p = (this.now - pulse.born) / 0.38;
      c.globalAlpha = (1 - p) * 0.6;
      c.strokeStyle = pulse.color;
      c.lineWidth = 1.2 * this.unit;
      c.beginPath();
      c.arc(
        pulse.x,
        pulse.y,
        pulse.size * (this.reducedMotion ? 0.65 : 0.5 + p * 0.75),
        0,
        Math.PI * 2,
      );
      c.stroke();
    }
    this.shards = this.shards.filter((shard) => this.now - shard.born < 0.38);
    for (const shard of this.shards) {
      const p = (this.now - shard.born) / 0.38;
      const vertical = shard.direction === 1 || shard.direction === 2;
      const distance = p * 23 * this.unit * shard.side;
      c.save();
      c.globalAlpha = (1 - p) * 0.8;
      c.translate(
        shard.x + (vertical ? distance : 0),
        shard.y + (vertical ? 0 : distance) + p * p * 8 * this.unit,
      );
      c.rotate(p * 0.24 * shard.side);
      const half = shard.size * 0.5;
      c.fillStyle = tint(shard.color, 0.1);
      c.strokeStyle = shard.color;
      c.lineWidth = 1.2 * this.unit;
      const x = vertical && shard.side > 0 ? 0 : -half;
      const y = !vertical && shard.side > 0 ? 0 : -half;
      const width = vertical ? half : shard.size;
      const height = vertical ? shard.size : half;
      c.fillRect(x, y, width, height);
      c.strokeRect(x, y, width, height);
      c.restore();
    }
    this.particles = this.particles.filter((particle) => this.now - particle.born < particle.life);
    c.lineCap = 'round';
    for (const particle of this.particles) {
      const t = this.now - particle.born;
      const x = particle.x + particle.vx * t;
      const y = particle.y + particle.vy * t + t * t * 40 * this.unit;
      c.globalAlpha = Math.pow(1 - t / particle.life, 1.5);
      c.strokeStyle = particle.color;
      c.lineWidth = particle.size;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - particle.vx * 0.027, y - particle.vy * 0.027);
      c.stroke();
    }
    c.restore();
  }

  pointer(x: number, y: number, _down = false): void {
    this.cursor = { x, y };
    if (!this.reducedMotion) {
      this.trails.push({ x, y, born: performance.now() / 1000 });
      if (this.trails.length > 35) this.trails.shift();
    }
  }

  clearPointer(): void {
    this.cursor = null;
    this.trails.length = 0;
  }

  private saber(preview: boolean): void {
    const c = this.ctx;
    const point = this.cursor ?? {
      x: this.width * 0.5 + this.pitch * 1.15,
      y: this.height * (preview ? 0.57 : 0.65),
    };
    const blade = saberGeometry(point, this.width, this.height);
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    this.trails = this.trails.filter((point) => this.now - point.born < 0.18);
    if (!this.reducedMotion) {
      for (let i = 1; i < this.trails.length; i++) {
        const a = this.trails[i - 1];
        const b = this.trails[i];
        const age = clamp(1 - (this.now - b.born) / 0.18);
        const aBlade = saberGeometry(a, this.width, this.height);
        const bBlade = saberGeometry(b, this.width, this.height);
        c.fillStyle = tint(CYAN, age * 0.065);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.lineTo(bBlade.base.x, bBlade.base.y);
        c.lineTo(aBlade.base.x, aBlade.base.y);
        c.closePath();
        c.fill();
        c.globalAlpha = age * 0.64;
        c.strokeStyle = '#baf5ff';
        c.shadowColor = CYAN;
        c.shadowBlur = 9 * this.unit;
        c.lineWidth = (1 + (i / this.trails.length) * 2.5) * this.unit;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    const dx = blade.base.x - blade.tip.x;
    const dy = blade.base.y - blade.tip.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const gripEnd = {
      x: blade.base.x + ux * 22 * this.unit,
      y: blade.base.y + uy * 22 * this.unit,
    };
    // All illuminated collision geometry ends at the base; the grip is decorative.
    c.shadowBlur = 0;
    c.lineWidth = 8.5 * this.unit;
    c.strokeStyle = '#060d11';
    c.beginPath();
    c.moveTo(blade.base.x, blade.base.y);
    c.lineTo(gripEnd.x, gripEnd.y);
    c.stroke();
    c.strokeStyle = '#81969d';
    c.lineWidth = 5.5 * this.unit;
    c.stroke();
    c.strokeStyle = '#263b45';
    c.lineWidth = 3.3 * this.unit;
    c.stroke();
    for (let i = 5; i < 22; i += 4) {
      const x = blade.base.x + ux * i * this.unit;
      const y = blade.base.y + uy * i * this.unit;
      c.strokeStyle = '#a5b7bd';
      c.lineWidth = 1 * this.unit;
      c.beginPath();
      c.moveTo(x - uy * 2.2 * this.unit, y + ux * 2.2 * this.unit);
      c.lineTo(x + uy * 2.2 * this.unit, y - ux * 2.2 * this.unit);
      c.stroke();
    }
    c.strokeStyle = '#aacbd3';
    c.lineWidth = 2.8 * this.unit;
    c.beginPath();
    c.moveTo(blade.base.x - uy * 6 * this.unit, blade.base.y + ux * 6 * this.unit);
    c.lineTo(blade.base.x + uy * 6 * this.unit, blade.base.y - ux * 6 * this.unit);
    c.stroke();
    c.beginPath();
    c.moveTo(blade.base.x, blade.base.y);
    c.lineTo(blade.tip.x, blade.tip.y);
    c.strokeStyle = 'rgba(102, 215, 255, .13)';
    c.lineWidth = blade.radius * 3;
    c.shadowColor = CYAN;
    c.shadowBlur = this.reducedMotion ? 0 : 17 * this.unit;
    c.stroke();
    c.strokeStyle = 'rgba(103, 223, 255, .52)';
    c.lineWidth = blade.radius * 2;
    c.stroke();
    c.strokeStyle = '#9beeff';
    c.lineWidth = blade.radius * 1.3;
    c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = '#f0ffff';
    c.lineWidth = blade.radius * 0.58;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(blade.tip.x, blade.tip.y, blade.radius * 0.5, 0, Math.PI * 2);
    c.fill();
    if (!this.reducedMotion) {
      c.strokeStyle = 'rgba(206, 250, 255, .62)';
      c.lineWidth = this.unit * 0.7;
      c.beginPath();
      c.moveTo(blade.tip.x - 6 * this.unit, blade.tip.y);
      c.lineTo(blade.tip.x + 6 * this.unit, blade.tip.y);
      c.moveTo(blade.tip.x, blade.tip.y - 6 * this.unit);
      c.lineTo(blade.tip.x, blade.tip.y + 6 * this.unit);
      c.stroke();
    }
    c.restore();
  }

  hitMouse(notes: Note[], time: number, x: number, y: number, from?: Point): Note | undefined {
    if (!from) return undefined;
    return findSaberNote(notes, time, from, { x, y }, this.width, this.height);
  }

  private previewNotes(time: number): Note[] {
    return [
      { id: -1, kind: 'key', lane: 0, time: time + 0.13, hit: false, missed: false },
      { id: -2, kind: 'key', lane: 1, time: time + 0.96, hit: false, missed: false },
      { id: -3, kind: 'key', lane: 2, time: time + 1.52, hit: false, missed: false },
      { id: -4, kind: 'key', lane: 3, time: time + 0.28, hit: false, missed: false },
      { id: -5, kind: 'key', lane: 0, time: time + 2.06, hit: false, missed: false },
      {
        id: -6,
        kind: 'mouse',
        lane: 0,
        sliceDirection: 0,
        time: time + 0.07,
        hit: false,
        missed: false,
      },
      {
        id: -7,
        kind: 'mouse',
        lane: 1,
        sliceDirection: 1,
        time: time + 0.07,
        hit: false,
        missed: false,
      },
      {
        id: -8,
        kind: 'mouse',
        lane: 2,
        sliceDirection: 2,
        time: time + 0.07,
        hit: false,
        missed: false,
      },
      {
        id: -9,
        kind: 'mouse',
        lane: 3,
        sliceDirection: 3,
        time: time + 0.07,
        hit: false,
        missed: false,
      },
    ];
  }

  destroy(): void {
    this.observer.disconnect();
    this.particles.length = 0;
    this.pulses.length = 0;
    this.shards.length = 0;
    this.trails.length = 0;
    this.cursor = null;
  }
}
