import { MusicEngine } from '../src/audio';
import { createChart, tracks } from '../src/engine';
import type { Lane, Note } from '../src/engine';
import {
  blockDirection,
  blockGeometry,
  keyGeometry,
  saberGeometry,
  SLICE_DIRECTIONS,
} from '../src/playfield';

/** Run from a fresh Vite preview page's developer console:
 * await (await import('/tests/browser-smoke.ts')).runBrowserSmoke()
 * The synthetic song clock makes timing boundaries deterministic. Real audio
 * transport is tested separately. Reload after this check to clear all test state.
 */
export async function runBrowserSmoke() {
  const results: string[] = [];
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const frames = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  const click = async (selector: string) => {
    $(selector).click();
    await frames();
  };
  const press = async (key: string, repeat = false) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true }));
    await frames();
  };
  const timeDescriptor = Object.getOwnPropertyDescriptor(MusicEngine.prototype, 'time')!;
  let clock = 0;
  const bestStorageKey = 'splitbeat-best-saber-v2';
  const savedBest = localStorage.getItem(bestStorageKey);
  const savedLegacyBest = localStorage.getItem('splitbeat-best');
  Object.defineProperty(MusicEngine.prototype, 'time', { configurable: true, get: () => clock });
  const moveTo = async (time: number) => {
    clock = time;
    await frames();
  };
  try {
    assert(document.documentElement.scrollWidth <= innerWidth, 'page has no horizontal overflow');
    assert(
      $('#arena').getBoundingClientRect().right <= innerWidth,
      'canvas fits inside the viewport',
    );
    assert(
      $('#start-button').getBoundingClientRect().right <= innerWidth,
      'play button is visible inside the viewport',
    );
    const guide = $('.arena-guide').getBoundingClientRect();
    assert(
      [...document.querySelectorAll('.slice-direction')].every((badge) => {
        const bounds = badge.getBoundingClientRect();
        return (
          bounds.left >= guide.left && bounds.right <= guide.right && bounds.bottom <= guide.bottom
        );
      }),
      'all four direction labels fit visibly inside the control guide',
    );
    await click('#how-button');
    assert($<HTMLDialogElement>('#help-dialog').open, 'instructions open');
    await click('#help-dialog .close-dialog');
    await click('#settings-button');
    assert($<HTMLDialogElement>('#settings-dialog').open, 'settings open');
    await click('#settings-dialog .close-dialog');
    await click('#start-button');
    assert(!$('#count-in').classList.contains('hidden'), 'start shows count-in');
    assert(
      $<HTMLButtonElement>('[data-track="nightdrive"]').disabled,
      'track changes locked during play',
    );
    await click('#pause-button');
    assert(!$('#pause-overlay').classList.contains('hidden'), 'pause shows pause overlay');
    await click('#resume-button');
    assert(
      !$('#count-in').classList.contains('hidden'),
      'same count-in digit reappears after resume',
    );
    const chart = createChart(tracks[0], 'flow');
    const key = chart[0];
    await moveTo(key.time - 0.2);
    await press(['a', 's', 'w', 'd'][key.lane]);
    assert($('#score').textContent === '000000', 'early keyboard input cannot score');
    await moveTo(key.time);
    await press(['a', 's', 'w', 'd'][key.lane]);
    assert($('#score').textContent === '000100', 'on-beat keyboard input scores a perfect');
    await press(['a', 's', 'w', 'd'][key.lane], true);
    assert($('#score').textContent === '000100', 'held-key repeats cannot rescore');
    const canvas = $<HTMLCanvasElement>('#arena');
    const rect = canvas.getBoundingClientRect();
    const pointer = (type: string, point: { x: number; y: number }) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerdown' ? 1 : 0,
          pointerType: 'mouse',
          pointerId: 1,
          bubbles: true,
        }),
      );
    const swipePoints = (note: Note, bladeBodyOnly = false) => {
      const block = blockGeometry(note, clock, rect.width, rect.height);
      const { vector } = SLICE_DIRECTIONS[blockDirection(note)];
      const blade = saberGeometry(block, rect.width, rect.height);
      const distance = bladeBodyOnly ? blade.radius * 3 : block.size * 1.2;
      const center = bladeBodyOnly
        ? {
            x: block.x - (blade.base.x - blade.tip.x) * 0.85,
            y: block.y - (blade.base.y - blade.tip.y) * 0.85,
          }
        : block;
      return {
        block,
        from: { x: center.x - vector.x * distance, y: center.y - vector.y * distance },
        to: { x: center.x + vector.x * distance, y: center.y + vector.y * distance },
      };
    };
    const swipe = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      // Entering establishes a fresh sample but never sweeps from an old location.
      pointer('pointerleave', from);
      pointer('pointerenter', from);
      pointer('pointermove', to);
    };
    const targets = ([0, 1, 2, 3] as Lane[]).map((lane) =>
      blockGeometry({ ...chart[1], lane }, chart[1].time, rect.width, rect.height),
    );
    const receptors = ([0, 1, 2, 3] as Lane[]).map((lane) =>
      keyGeometry(lane, 1, rect.width, rect.height),
    );
    assert(
      Math.abs(targets.reduce((sum, target) => sum + target.x, 0) / 4 - rect.width / 2) < 1 &&
        Math.abs(receptors.reduce((sum, target) => sum + target.x, 0) / 4 - rect.width / 2) < 1,
      'keyboard receptors and block targets share the center of the screen',
    );
    assert(
      targets.every((target) => target.x >= receptors[0].x && target.x <= receptors[3].x),
      'blocks sit inside the keyboard corridor instead of a separate side panel',
    );
    assert(
      [...targets, ...receptors].every(
        (target) =>
          target.x - target.size / 2 >= 0 &&
          target.x + target.size / 2 <= rect.width &&
          target.y - target.size / 2 >= 0 &&
          target.y + target.size / 2 <= rect.height,
      ),
      'central targets remain fully visible inside the canvas',
    );
    assert(
      new Set(SLICE_DIRECTIONS.map((direction) => direction.color)).size === 4 &&
        new Set(SLICE_DIRECTIONS.map((direction) => direction.arrow)).size === 4,
      'each block direction has a distinct color and arrow symbol',
    );
    const mouse = chart[1];
    await moveTo(mouse.time - 0.2);
    let points = swipePoints(mouse);
    swipe(points.from, points.to);
    await frames();
    assert($('#score').textContent === '000100', 'early directional saber swipes cannot score');
    await moveTo(mouse.time);
    points = swipePoints(mouse);
    pointer('pointerleave', points.from);
    pointer('pointerenter', points.block);
    pointer('pointerdown', points.block);
    pointer('pointerup', points.block);
    await frames();
    assert($('#score').textContent === '000100', 'stationary mouse clicks cannot slice a block');
    swipe(points.to, points.from);
    await frames();
    assert($('#score').textContent === '000100', 'a swipe against the block arrow cannot score');
    pointer('pointerleave', points.from);
    pointer('pointerenter', points.from);
    pointer('pointerleave', points.from);
    pointer('pointermove', points.to);
    await frames();
    assert($('#score').textContent === '000100', 're-entry cannot connect an old off-canvas trail');
    pointer('pointerleave', points.from);
    pointer('pointerenter', points.from);
    await new Promise((resolve) => setTimeout(resolve, 145));
    pointer('pointermove', points.to);
    await frames();
    assert($('#score').textContent === '000100', 'a stale pointer sample cannot create a slice');
    swipe(points.from, points.to);
    await frames();
    assert(
      $('#score').textContent === '000200',
      'on-beat directional mouse motion scores without holding a button',
    );
    const secondKey = chart[2];
    await moveTo(secondKey.time + 0.1);
    await press(['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'][secondKey.lane]);
    assert($('#score').textContent === '000265', 'arrow-key alias at +100 ms scores a good');
    const secondMouse = chart[3];
    await moveTo(secondMouse.time);
    points = swipePoints(secondMouse);
    pointer('pointerleave', points.from);
    pointer('pointerenter', points.from);
    await click('#pause-button');
    pointer('pointerenter', points.from);
    pointer('pointermove', points.to);
    await frames();
    assert($('#score').textContent === '000265', 'mouse movement during pause cannot score');
    pointer('pointerenter', points.from);
    await click('#resume-button');
    pointer('pointermove', points.to);
    await frames();
    assert(
      $('#score').textContent === '000265',
      'resume cannot sweep a pointer trail across the pause',
    );
    points = swipePoints(secondMouse, true);
    assert(
      Math.max(points.from.y, points.to.y) < points.block.y - points.block.size / 2,
      'blade-body fixture keeps the mouse tip entirely above the block',
    );
    swipe(points.from, points.to);
    await frames();
    assert(
      $('#score').textContent === '000365',
      'the lightsaber blade can slice a block even when the mouse tip misses it',
    );
    const idleTip = { x: rect.width * 0.86, y: rect.height * 0.38 };
    const idleBlade = saberGeometry(idleTip, rect.width, rect.height);
    const midpoint = {
      x: (idleBlade.tip.x + idleBlade.base.x) / 2,
      y: (idleBlade.tip.y + idleBlade.base.y) / 2,
    };
    const bladeCoreVisible = () => {
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const pixels = canvas
        .getContext('2d')!
        .getImageData(
          Math.floor((midpoint.x - 3) * scaleX),
          Math.floor((midpoint.y - 3) * scaleY),
          Math.ceil(6 * scaleX),
          Math.ceil(6 * scaleY),
        ).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 210 && pixels[i + 1] > 210 && pixels[i + 2] > 210) return true;
      }
      return false;
    };
    pointer('pointerleave', idleTip);
    pointer('pointerenter', idleTip);
    pointer('pointermove', idleTip);
    await frames();
    assert(bladeCoreVisible(), 'mouse movement renders a visible lightsaber blade');
    pointer('pointerup', idleTip);
    await frames();
    assert(bladeCoreVisible(), 'releasing a mouse button keeps the lightsaber visible');
    await moveTo(chart[4].time + 0.17);
    assert($('#combo').textContent === '0×', 'late note expires and resets combo');
    await moveTo(tracks[0].duration + 3);
    assert(
      !$('#results-overlay').classList.contains('hidden'),
      'results appear at the exact audio endpoint',
    );
    assert($('#result-score').textContent === '365', 'results retain earned score');
    assert($('#result-combo').textContent === '4×', 'results retain the best combo');
    assert($('#result-perfect').textContent === '3', 'results show correct hit breakdown');
    assert(
      JSON.parse(localStorage.getItem(bestStorageKey) || '{}')['afterglow-flow'] >= 365,
      'normal-mode high score persists',
    );
    assert(
      localStorage.getItem('splitbeat-best') === savedLegacyBest,
      'directional saber scores preserve earlier click-mode records separately',
    );
    clock = 0;
    await click('#replay-button');
    assert($('#score').textContent === '000000', 'replay resets the score');
    assert(!$('#count-in').classList.contains('hidden'), 'replay starts a new countdown');
    const checkedDirections = new Set<Lane>();
    for (const note of chart) {
      if (note.kind !== 'mouse' || checkedDirections.has(blockDirection(note))) continue;
      await moveTo(note.time);
      const before = Number($('#score').textContent);
      const { from, to } = swipePoints(note);
      swipe(to, from);
      await frames();
      const direction = SLICE_DIRECTIONS[blockDirection(note)].label;
      assert(
        Number($('#score').textContent) === before,
        `${direction} blocks reject the reverse swipe`,
      );
      swipe(from, to);
      await frames();
      assert(
        Number($('#score').textContent) > before,
        `${direction} blocks accept the indicated swipe`,
      );
      checkedDirections.add(blockDirection(note));
      if (checkedDirections.size === 4) break;
    }
    assert(
      checkedDirections.size === 4,
      'all four block directions work through the live input handler',
    );
    await moveTo(tracks[0].duration + 3);
    await click('#back-button');
    await click('[data-track="nightdrive"]');
    await click('[data-difficulty="chill"]');
    await click('#practice');
    assert($('#now-title').textContent === 'Night Drive', 'track selection updates the HUD');
    assert($('#now-bpm').textContent === '90', 'practice reduces tempo to 75 percent');
    assert($('#now-difficulty').textContent === 'CHILL', 'difficulty selection updates the HUD');
    clock = 0;
    await click('#start-button');
    await moveTo(tracks[1].duration / 0.75 + 3);
    assert(
      !$('#results-overlay').classList.contains('hidden'),
      'practice session completes at its stretched duration',
    );
    assert(
      $('#result-kicker').textContent!.includes('PRACTICE COMPLETE'),
      'practice results are identified separately',
    );
    await click('#back-button');
    await click('#sound-button');
    assert(
      $('#sound-button').getAttribute('aria-label') === 'Unmute sound',
      'mute button updates sound state',
    );
    await click('#sound-button');
    assert(
      $('#sound-button').getAttribute('aria-label') === 'Mute sound',
      'unmute restores sound state',
    );
    return { passed: results.length, results };
  } finally {
    $('#pause-button').click();
    Object.defineProperty(MusicEngine.prototype, 'time', timeDescriptor);
    if (savedBest === null) localStorage.removeItem(bestStorageKey);
    else localStorage.setItem(bestStorageKey, savedBest);
  }
}
