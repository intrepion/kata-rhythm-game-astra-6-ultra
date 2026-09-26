import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { MusicEngine } from '../src/audio.ts';

class FakeParam {
  value = 0;
  setValueAtTime(value: number) {
    this.value = value;
  }
  setTargetAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  delayTime = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode {
  startedAt = Number.NaN;
  stoppedImmediately = false;
  start(at: number) {
    this.startedAt = at;
  }
  stop(at?: number) {
    if (at === undefined) this.stoppedImmediately = true;
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state = 'suspended';
  destination = new FakeNode();
  sources: FakeSource[] = [];
  wakeup: Promise<void> | null = null;

  createGain() {
    return new FakeNode();
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
  createDelay() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(this.sampleRate) };
  }
  createOscillator() {
    return this.createSource();
  }
  createBufferSource() {
    return this.createSource();
  }
  private createSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async resume() {
    if (this.wakeup) await this.wakeup;
    this.state = 'running';
  }
}

function fixture(t: TestContext) {
  const context = new FakeAudioContext();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      AudioContext: class {
        constructor() {
          return context;
        }
      },
    },
  });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const engine = new MusicEngine();
  t.after(() => {
    engine.stop();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const advanceTo = (seconds: number) => {
    assert.ok(seconds >= context.currentTime, 'the audio clock only moves forward');
    while (context.currentTime + 0.025 < seconds) {
      context.currentTime += 0.025;
      t.mock.timers.tick(25);
    }
    context.currentTime = seconds;
    t.mock.timers.tick(25);
  };
  const start = async (duration = 12, trackId = 'afterglow') => {
    await engine.unlock();
    engine.start({ bpm: 120, duration, trackId, volume: 0.7 });
    advanceTo(context.currentTime + 0.1);
    return context.currentTime - engine.time;
  };
  return { engine, context, advanceTo, start };
}

function close(actual: number, expected: number, tolerance = 0.000001) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be close to ${expected}`,
  );
}

test('count-in follows the selected tempo and music begins at transport time three', async (t) => {
  const { context, advanceTo, start } = fixture(t);
  const epoch = await start();
  advanceTo(epoch + 2.8);
  assert.equal(context.sources.length, 4, 'only four count-in clicks have sounded');
  context.sources.forEach((source, index) => close(source.startedAt - epoch, 1 + index * 0.5));

  const countInSources = context.sources.length;
  advanceTo(epoch + 3.01);
  const musicSources = context.sources.slice(countInSources);
  assert.ok(musicSources.length > 4, 'the first beat includes the instrumental arrangement');
  close(Math.min(...musicSources.map((source) => source.startedAt - epoch)), 3);
  assert.ok(musicSources.every((source) => source.startedAt >= epoch + 3));
});

test('transport time clamps to track duration plus count-in and stays there after completion', async (t) => {
  const { engine, context, start } = fixture(t);
  const epoch = await start(8);
  context.currentTime = epoch + 50;
  assert.equal(engine.time, 11, 'the getter clamps even before the scheduler observes completion');
  t.mock.timers.tick(25);
  assert.equal(engine.running, false);
  assert.equal(engine.time, 11);
  context.currentTime += 100;
  assert.equal(engine.time, 11);
  await engine.resume();
  assert.equal(engine.running, false, 'a completed song cannot resume');
});

test('pause freezes the transport and cancels already scheduled audio', async (t) => {
  const { engine, context, advanceTo, start } = fixture(t);
  const epoch = await start();
  advanceTo(epoch + 4.25);
  engine.pause();
  const pausedAt = engine.time;
  const scheduled = context.sources.length;
  close(pausedAt, 4.25);
  assert.equal(engine.running, false);
  assert.ok(context.sources.every((source) => source.stoppedImmediately && source.disconnected));

  advanceTo(context.currentTime + 20);
  assert.equal(engine.time, pausedAt);
  assert.equal(
    context.sources.length,
    scheduled,
    'the scheduler does not produce audio while paused',
  );
});

test('resume continues from the paused position without replaying old notes', async (t) => {
  const { engine, context, advanceTo, start } = fixture(t);
  const epoch = await start();
  advanceTo(epoch + 4.25);
  engine.pause();
  const pausedAt = engine.time;
  advanceTo(context.currentTime + 5);
  const oldSourceCount = context.sources.length;
  const resumedAt = context.currentTime;
  await engine.resume();
  assert.equal(engine.running, true);
  close(engine.time, pausedAt, 0.02);
  advanceTo(resumedAt + 0.5);
  close(engine.time, pausedAt + 0.5, 0.02);
  const newSources = context.sources.slice(oldSourceCount);
  assert.ok(newSources.length > 0);
  assert.ok(
    newSources.every((source) => source.startedAt >= resumedAt),
    'resume never schedules notes in the past',
  );
});

test('stop clears the transport and each soundtrack can start afresh', async (t) => {
  const { engine, context, advanceTo, start } = fixture(t);
  for (const trackId of ['afterglow', 'nightdrive', 'hyperlink']) {
    const epoch = await start(12, trackId);
    advanceTo(epoch + 3.5);
    engine.hit('key', 'perfect');
    engine.hit('mouse', 'good');
    engine.miss();
    engine.stop();
    assert.equal(engine.running, false);
    assert.equal(engine.time, 0);
    assert.ok(context.sources.every((source) => source.stoppedImmediately));
    await engine.resume();
    assert.equal(engine.running, false, 'stop also clears the resumable song');
    advanceTo(context.currentTime + 1);
    assert.equal(engine.time, 0);
  }
});

test('stop while the audio device unlocks prevents a pending resume from reviving the song', async (t) => {
  const { engine, context, advanceTo, start } = fixture(t);
  const epoch = await start();
  advanceTo(epoch + 4);
  engine.pause();
  context.state = 'suspended';
  let release!: () => void;
  context.wakeup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pendingResume = engine.resume();
  engine.stop();
  const stoppedSourceCount = context.sources.length;
  release();
  await pendingResume;

  assert.equal(engine.running, false);
  assert.equal(engine.time, 0);
  advanceTo(context.currentTime + 1);
  assert.equal(context.sources.length, stoppedSourceCount);
});

test('an old pending resume cannot resume a replacement song', async (t) => {
  const { engine, context, start } = fixture(t);
  await start();
  engine.pause();
  context.state = 'suspended';
  let release!: () => void;
  context.wakeup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pendingResume = engine.resume();
  engine.start({ bpm: 150, duration: 20, trackId: 'hyperlink', volume: 0.7 });
  engine.pause();
  release();
  await pendingResume;

  assert.equal(engine.running, false, 'the replacement song stays paused');
  assert.equal(engine.time, 0);
});
