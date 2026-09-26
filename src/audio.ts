type TrackId = 'afterglow' | 'nightdrive' | 'hyperlink';
type StartOptions = { bpm: number; duration: number; trackId: string; volume: number };
type Track = { roots: number[]; arp: number[]; brightness: number; lead: OscillatorType };

const TRACKS: Record<TrackId, Track> = {
  afterglow: {
    roots: [45, 41, 48, 43],
    arp: [0, 7, 12, 15, 12, 7, 10, 7],
    brightness: 3100,
    lead: 'triangle',
  },
  nightdrive: {
    roots: [40, 36, 43, 38],
    arp: [0, 12, 7, 10, 0, 7, 15, 12],
    brightness: 2100,
    lead: 'sine',
  },
  hyperlink: {
    roots: [50, 46, 53, 48],
    arp: [0, 7, 12, 19, 15, 12, 7, 10],
    brightness: 4200,
    lead: 'triangle',
  },
};

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A synthesized soundtrack and transport. `time` includes the three-second count-in. */
export class MusicEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private delay: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayReturn: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private pausedAt = 0;
  private epoch = 0;
  private endTime = 0;
  private step = 0;
  private countInStep = 0;
  private options: StartOptions | null = null;

  get running(): boolean {
    return this.playing;
  }

  get time(): number {
    if (!this.playing || !this.context) return this.pausedAt;
    return clamp(this.context.currentTime - this.epoch, 0, this.endTime);
  }

  async unlock(): Promise<void> {
    const context = this.getContext();
    if (context.state !== 'running') await context.resume();
  }

  start(options: StartOptions): void {
    this.stop();
    const context = this.getContext();
    this.options = {
      ...options,
      bpm: clamp(options.bpm, 60, 220),
      duration: Math.max(1, options.duration),
    };
    this.setVolume(options.volume);
    this.endTime = this.options.duration + 3;
    this.epoch = context.currentTime + 0.045;
    this.pausedAt = 0;
    this.step = 0;
    this.countInStep = 0;
    this.playing = true;
    this.makeMusicBus();
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.time;
    this.playing = false;
    this.clearTimer();
    this.clearSources();
    this.clearMusicBus();
  }

  async resume(): Promise<void> {
    if (this.playing || !this.options || this.pausedAt >= this.endTime) return;
    const song = this.options;
    await this.unlock();
    // A stop or restart while the audio device was waking must not revive an old song.
    if (this.playing || this.options !== song || this.pausedAt >= this.endTime) return;
    const sixteenth = 60 / this.options.bpm / 4;
    this.epoch = this.context!.currentTime - this.pausedAt + 0.015;
    this.step = Math.max(0, Math.ceil((this.pausedAt - 3) / sixteenth));
    this.countInStep = 0;
    this.playing = true;
    this.makeMusicBus();
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    this.playing = false;
    this.clearTimer();
    this.clearSources();
    this.clearMusicBus();
    this.options = null;
    this.pausedAt = 0;
    this.endTime = 0;
    this.step = 0;
    this.countInStep = 0;
  }

  setVolume(value: number): void {
    const context = this.getContext();
    this.master!.gain.setTargetAtTime(clamp(value, 0, 1) * 0.72, context.currentTime, 0.025);
  }

  hit(kind: 'key' | 'mouse', quality: 'perfect' | 'good'): void {
    if (!this.playing || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const root = kind === 'mouse' ? 880 : 587.33;
    this.tone(now, root, 0.085, quality === 'perfect' ? 0.095 : 0.06, 'sine', this.master);
    if (quality === 'perfect')
      this.tone(now + 0.014, root * 1.5, 0.075, 0.038, 'sine', this.master);
    if (kind === 'mouse') this.noiseHit(now, 0.095, 0.07, 3200, 'highpass', this.master);
  }

  miss(): void {
    if (!this.playing || !this.context || !this.master) return;
    this.tone(this.context.currentTime, 110, 0.075, 0.055, 'triangle', this.master);
  }

  private getContext(): AudioContext {
    if (this.context) return this.context;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0.45;
    compressor.threshold.value = -15;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    master.connect(compressor);
    compressor.connect(context.destination);
    this.context = context;
    this.master = master;
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 271828;
    for (let index = 0; index < data.length; index++) {
      seed = (seed * 16807) % 2147483647;
      data[index] = (seed / 2147483647) * 2 - 1;
    }
    this.noise = noise;
    return context;
  }

  private makeMusicBus(): void {
    const context = this.context!;
    this.music = context.createGain();
    this.music.gain.setValueAtTime(0.76, context.currentTime);
    const fadeStart = Math.max(context.currentTime, this.epoch + this.endTime - 0.8);
    this.music.gain.setValueAtTime(0.76, fadeStart);
    this.music.gain.linearRampToValueAtTime(
      0,
      Math.max(fadeStart + 0.01, this.epoch + this.endTime),
    );
    this.music.connect(this.master!);
    this.delay = context.createDelay(1);
    this.delay.delayTime.value = (60 / this.options!.bpm) * 0.75;
    this.delayFeedback = context.createGain();
    this.delayFeedback.gain.value = 0.25;
    this.delayReturn = context.createGain();
    this.delayReturn.gain.value = 0.18;
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.music);
  }

  private clearMusicBus(): void {
    this.music?.disconnect();
    this.delay?.disconnect();
    this.delayFeedback?.disconnect();
    this.delayReturn?.disconnect();
    this.music = null;
    this.delay = null;
    this.delayFeedback = null;
    this.delayReturn = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private clearSources(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* A source may have ended between timer ticks. */
      }
      source.disconnect();
    }
    this.sources.clear();
  }

  private trackSource(
    source: AudioScheduledSourceNode,
    end: number,
    nodes: AudioNode[] = [],
  ): void {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    source.stop(end);
  }

  private schedule(): void {
    if (!this.playing || !this.context || !this.options) return;
    const now = this.context.currentTime;
    const horizon = now + 0.14;
    const beat = 60 / this.options.bpm;
    while (this.countInStep < 4) {
      const at = this.epoch + 3 - (4 - this.countInStep) * beat;
      if (at >= horizon) break;
      if (at >= now - 0.035)
        this.tone(
          Math.max(at, now),
          this.countInStep === 3 ? 1046.5 : 783.99,
          0.08,
          0.11,
          'sine',
          this.music!,
        );
      this.countInStep++;
    }
    const sixteenth = beat / 4;
    while (3 + this.step * sixteenth < this.endTime) {
      const at = this.epoch + 3 + this.step * sixteenth;
      if (at >= horizon) break;
      // Browser throttling should skip old notes, never play a backlog of them at once.
      if (at >= now - 0.04) this.playStep(this.step, Math.max(now, at), sixteenth);
      this.step++;
    }
    if (now >= this.epoch + this.endTime) {
      this.pausedAt = this.endTime;
      this.playing = false;
      this.clearTimer();
    }
  }

  private playStep(step: number, at: number, sixteenth: number): void {
    const id = this.options!.trackId in TRACKS ? (this.options!.trackId as TrackId) : 'afterglow';
    const track = TRACKS[id];
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chord = Math.floor(bar / 2) % 4;
    const root = track.roots[chord]!;
    const third = chord === 0 ? 3 : 4;
    const beat = sixteenth * 4;
    const music = this.music!;

    if (inBar % 4 === 0 || (id === 'hyperlink' && inBar === 14)) this.kick(at);
    if (inBar === 4 || inBar === 12) this.snare(at);
    if (inBar % 2 === 0)
      this.noiseHit(
        at,
        inBar % 4 === 2 ? 0.105 : 0.045,
        inBar % 4 === 2 ? 0.105 : 0.065,
        6800,
        'highpass',
        music,
      );
    if (id === 'hyperlink' && bar % 4 === 3 && inBar >= 12)
      this.noiseHit(at, 0.033, 0.045, 7500, 'highpass', music);

    // A pulse bass and a warmer sustained chord share a simple four-chord progression.
    if (inBar % 2 === 0) {
      const bassNote = root - 12 + (inBar === 10 || inBar === 14 ? 12 : 0);
      this.filteredTone(
        at + 0.004,
        frequency(bassNote),
        sixteenth * 1.65,
        0.18,
        'sawtooth',
        500,
        false,
      );
      this.tone(at, frequency(bassNote), sixteenth * 1.7, 0.1, 'sine', music);
    }
    if (inBar === 0) {
      for (const note of [root + 12, root + 12 + third, root + 19]) {
        this.filteredTone(
          at,
          frequency(note),
          beat * 3.8,
          0.064,
          'triangle',
          track.brightness * 0.55,
          true,
          0.045,
        );
      }
      if (bar % 4 === 0) this.noiseHit(at, 0.6, 0.105, 5500, 'highpass', music);
    }

    // Delay fills the space between the plucks without competing with the hit feedback.
    if (inBar % 2 === 0 || (id === 'hyperlink' && bar % 4 >= 2)) {
      const arpIndex = Math.floor(inBar / 2) % track.arp.length;
      let interval = track.arp[arpIndex]!;
      if (chord !== 0 && interval === 15) interval = 16;
      if (chord !== 0 && interval === 10) interval = 11;
      const octave = bar % 8 >= 4 ? 24 : 12;
      this.filteredTone(
        at + 0.008,
        frequency(root + interval + octave),
        sixteenth * 1.4,
        inBar % 4 === 0 ? 0.09 : 0.062,
        track.lead,
        track.brightness,
        true,
      );
    }
  }

  private tone(
    at: number,
    pitch: number,
    duration: number,
    level: number,
    type: OscillatorType,
    destination: AudioNode,
  ): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(pitch, at);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(at);
    this.trackSource(oscillator, at + duration + 0.015, [envelope]);
  }

  private filteredTone(
    at: number,
    pitch: number,
    duration: number,
    level: number,
    type: OscillatorType,
    cutoff: number,
    echo: boolean,
    attack = 0.008,
  ): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.value = pitch;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * 0.38), at + duration);
    filter.Q.value = 0.7;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.music!);
    if (echo && this.delay) envelope.connect(this.delay);
    oscillator.start(at);
    this.trackSource(oscillator, at + duration + 0.02, [filter, envelope]);
  }

  private kick(at: number): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.frequency.setValueAtTime(155, at);
    oscillator.frequency.exponentialRampToValueAtTime(46, at + 0.11);
    envelope.gain.setValueAtTime(0.001, at);
    envelope.gain.exponentialRampToValueAtTime(0.76, at + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.29);
    oscillator.connect(envelope);
    envelope.connect(this.music!);
    oscillator.start(at);
    this.trackSource(oscillator, at + 0.3, [envelope]);
  }

  private snare(at: number): void {
    this.noiseHit(at, 0.17, 0.23, 1500, 'highpass', this.music!);
    this.tone(at, 185, 0.12, 0.15, 'triangle', this.music!);
    this.noiseHit(at + 0.016, 0.105, 0.09, 2400, 'bandpass', this.music!);
  }

  private noiseHit(
    at: number,
    duration: number,
    level: number,
    cutoff: number,
    type: BiquadFilterType,
    destination: AudioNode,
  ): void {
    const context = this.context!;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.noise;
    filter.type = type;
    filter.frequency.value = cutoff;
    filter.Q.value = 0.65;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(at);
    this.trackSource(source, at + duration + 0.015, [filter, envelope]);
  }
}
