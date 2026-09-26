import './style.css';
import { Arena } from './arena';
import { MusicEngine } from './audio';
import { SLICE_DIRECTIONS } from './playfield';
import {
  createChart,
  findKeyNote,
  HIT_WINDOW,
  LEAD_IN,
  judge,
  ScoreKeeper,
  tracks,
} from './engine';
import type { Difficulty, Lane, Note, Track } from './engine';

const icon = (name: string, size = 18) => {
  const paths: Record<string, string> = {
    play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    sound: '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    mute: '<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6m0-6-6 6"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    keyboard:
      '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M8 16h8"/>',
    mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 3v6"/>',
    saber: '<path d="m5 19 3-3m-1-2 3 3m-1-3L19 4a1.4 1.4 0 0 1 2 2L11 16M3 21l2-2"/>',
    headphones:
      '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    restart: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.play}</svg>`;
};

const albumArt = (index: number) => {
  if (index === 0)
    return '<svg viewBox="0 0 80 80" aria-hidden="true"><defs><linearGradient id="sunset" x2="0" y2="1"><stop stop-color="#faac6c"/><stop offset="1" stop-color="#cf4e32"/></linearGradient></defs><rect width="80" height="80" fill="#382620"/><circle cx="40" cy="37" r="29" fill="url(#sunset)"/><path d="M0 44h80M0 50h80M0 57h80M0 65h80M0 74h80" stroke="#382620" stroke-width="3"/><path d="M0 75 40 49 80 75" stroke="#fbb071" fill="none" opacity=".5"/></svg>';
  if (index === 1)
    return '<svg viewBox="0 0 80 80" aria-hidden="true"><rect width="80" height="80" fill="#17382e"/><g stroke="#9cdbbd" fill="none"><path d="M12 80 29 0M27 80 34 0M53 80 45 0M68 80 50 0" opacity=".6"/><path d="M0 25h80M0 37h80M0 53h80M0 75h80" opacity=".3"/><circle cx="40" cy="29" r="18"/><circle cx="40" cy="29" r="12"/><circle cx="40" cy="29" r="6"/></g></svg>';
  return '<svg viewBox="0 0 80 80" aria-hidden="true"><rect width="80" height="80" fill="#352946"/><g fill="none" stroke="#c7a5ed" stroke-width="2"><path d="m40 7 30 17v34L40 75 10 58V24z"/><path d="m40 17 21 12v24L40 65 19 53V29z"/><path d="m40 27 12 7v14l-12 7-12-7V34z"/><path d="M40 7v20m30-3L52 34m18 24L52 48M40 75V55M10 58l18-10M10 24l18 10" opacity=".5"/></g></svg>';
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="/" aria-label="Splitbeat home"><span class="brand-mark"><i></i><i></i></span>SPLITBEAT<span class="brand-beta">VOL. 01</span></a>
    <nav aria-label="Main navigation"><span class="nav-active">Playground</span><button id="how-button">How to play ${icon('arrow', 14)}</button></nav>
    <div class="header-actions"><button id="sound-button" class="sound-button" aria-label="Mute sound">${icon('sound')}<span>SOUND ON</span></button><span class="header-divider"></span><button id="settings-button" class="icon-button" aria-label="Open settings">${icon('settings', 20)}</button></div>
  </header>
  <main>
    <section class="intro" aria-labelledby="main-title">
      <div><p class="eyebrow"><span></span> GET OUT OF YOUR HEAD. GET INTO THE BEAT.</p><h1 id="main-title">Two hands. <span>One rhythm.</span></h1></div>
      <div class="intro-aside"><div class="device-icons"><span>${icon('keyboard', 22)}</span><i>+</i><span>${icon('mouse', 22)}</span><i>=</i><span class="flow-symbol">〰</span></div><p>A little coordination. A lot of flow.</p></div>
    </section>
    <section class="game-section" aria-label="Rhythm game">
      <div class="arena-toolbar"><div class="section-label"><span class="live-dot"></span> THE PLAYGROUND <span class="toolbar-separator">/</span><span id="mode-label">FIND YOUR FLOW</span></div><label class="practice-control"><span>Practice <span class="practice-speed">· 75% speed</span></span><input id="practice" type="checkbox" role="switch" aria-label="Practice at 75 percent speed"><span class="toggle-track"></span></label></div>
      <div class="arena-shell" id="arena-shell">
        <div class="hud"><div class="hud-track"><span class="mini-album">${albumArt(0)}</span><div><span id="now-title">Afterglow</span><small><span id="now-bpm">100</span> BPM <span>·</span> <span id="now-difficulty">FLOW</span></small></div></div><div class="hud-stats"><div class="stat"><span>SCORE</span><strong id="score">000000</strong></div><div class="stat"><span>COMBO</span><strong id="combo">0<span>×</span></strong></div><div class="stat"><span>ACCURACY</span><strong id="accuracy">100<span>%</span></strong></div></div><div class="hud-end"><span id="timer">00:00 <i>/</i> 01:00</span><button id="pause-button" class="icon-button" aria-label="Pause game" disabled>${icon('pause', 16)}</button><button id="fullscreen-button" class="icon-button" aria-label="Toggle fullscreen">${icon('expand', 16)}</button></div></div>
        <div class="canvas-container"><canvas id="arena" aria-label="Arrows and translucent blocks approach together in the center. Use WASD or arrow keys for orange notes. Move the mouse to swing your lightsaber through colored blocks in their arrow direction, on the beat."></canvas>
          <div id="launch-overlay" class="game-overlay"><div class="launch-content"><span class="launch-kicker">ONE FIELD. TWO HANDS.</span><h2>Find your focus.</h2><p>Tap the orange arrows.<br>Swing through the glass blocks.</p><button id="start-button" class="primary-button">${icon('play', 19)} Let's play ${icon('arrow', 18)}</button><span class="start-hint">or press <kbd>space</kbd> to start</span></div></div>
          <div id="pause-overlay" class="game-overlay hidden"><div class="launch-content"><span class="launch-kicker">NO RUSH. THE BEAT CAN WAIT.</span><h2>Take a breath.</h2><p>Your session is paused.</p><button id="resume-button" class="primary-button">${icon('play')} Back to the beat</button><div class="pause-secondary"><button id="restart-paused" class="text-button">${icon('restart', 14)} Start over</button><button id="leave-paused" class="text-button">Change track</button></div></div></div>
          <div id="results-overlay" class="game-overlay hidden"><div class="results-content"><span id="result-kicker" class="launch-kicker">SESSION COMPLETE</span><h2 id="result-title">That's your rhythm.</h2><div class="result-score" id="result-score">0</div><div class="result-stats"><span><strong id="result-accuracy">100%</strong>accuracy</span><span><strong id="result-combo">0×</strong>best combo</span><span><strong id="result-perfect">0</strong>perfect hits</span></div><p id="result-detail"></p><div class="result-actions"><button id="replay-button" class="primary-button">${icon('restart', 16)} Play again</button><button id="back-button" class="secondary-button">Change track</button></div></div></div>
          <div id="count-in" class="count-in hidden" aria-live="polite"></div>
          <div id="judgment" class="judgment" aria-hidden="true"></div>
        </div>
        <div class="song-progress" role="progressbar" aria-label="Track progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="progress-fill"></span></div>
        <div class="arena-guide"><div><span class="input-label orange"><span></span> TAP</span><div class="keycaps"><kbd>A</kbd><kbd>S</kbd><kbd>W</kbd><kbd>D</kbd></div><span class="guide-muted">or arrow keys</span></div><div class="slice-directions" aria-label="Block slice direction colors">${SLICE_DIRECTIONS.map((direction) => `<span class="slice-direction" style="--slice-color:${direction.color}" title="Slice ${direction.label.toLowerCase()}"><b>${direction.arrow}</b><span>${direction.label}</span></span>`).join('')}</div><div><span class="input-label mint"><span></span> SLICE</span>${icon('saber', 18)}<span class="guide-muted">Move mouse · no click</span></div></div>
      </div>
    </section>
    <section class="track-section" aria-labelledby="track-heading">
      <div class="tracks-heading"><div><h2 id="track-heading">Pick your frequency<span>.</span></h2><p>Three original tracks. Make one yours.</p></div><div class="difficulty-control"><span>INTENSITY</span><div role="group" aria-label="Difficulty"><button data-difficulty="chill" aria-pressed="false">Chill</button><button data-difficulty="flow" class="selected" aria-pressed="true">Flow</button><button data-difficulty="rush" aria-pressed="false">Rush <span>↗</span></button></div></div></div>
      <div id="track-list" class="track-list"></div>
    </section>
    <footer><span>${icon('headphones', 15)} Better with headphones. Best when you let go.</span><span>MADE FOR YOUR FLOW <i>✳</i></span></footer>
  </main>
  <dialog id="help-dialog"><div class="dialog-top"><span class="eyebrow">A QUICK WARM-UP</span><button class="icon-button close-dialog" aria-label="Close instructions">${icon('close')}</button></div><h2>Meet in the middle.</h2><p class="dialog-intro">One central field keeps both inputs in view. Start with Chill or switch on Practice to learn the keyboard rhythm and directional saber swings together.</p><div class="instruction-card"><span class="instruction-icon orange">${icon('keyboard', 28)}</span><div><h3>Left hand. Tap the arrows.</h3><p>Press <b>A ← · S ↓ · W ↑ · D →</b> as a note reaches the matching outline at the bottom of the runway. The arrow keys work too.</p></div></div><div class="instruction-card"><span class="instruction-icon mint">${icon('mouse', 28)}</span><div><h3>Right hand. Swing the lightsaber.</h3><p>Move your mouse to swing the glowing blade. No click or held button needed. Slice a glass block <b>in its arrow direction</b> as the approach outline meets its edge. The whole lit blade can hit; the handle cannot.</p><p class="help-directions">Coral <b>← left</b> · cyan <b>↓ down</b> · lime <b>↑ up</b> · violet <b>→ right</b>. Every block has a large arrow as well as its color.</p></div></div><div class="help-bottom"><span><kbd>space</kbd> Pause / resume</span><span><kbd>esc</kbd> Pause</span><span><kbd>R</kbd> Restart</span></div><p class="help-note">Perfect: within 75 ms. Good: within 160 ms. Build your combo for up to a 4× multiplier. Misses reset your combo, but the music always keeps going.</p><button class="primary-button close-dialog">Got it. Let's find a rhythm. ${icon('arrow')}</button></dialog>
  <dialog id="settings-dialog"><div class="dialog-top"><span class="eyebrow">MAKE IT FEEL RIGHT</span><button class="icon-button close-dialog" aria-label="Close settings">${icon('close')}</button></div><h2>Your setup.</h2><label class="setting-row" for="volume"><span><b>Master volume</b><small>Music and hit feedback</small></span><output id="volume-output">65%</output></label><input id="volume" type="range" min="0" max="100" value="65" aria-label="Master volume"><label class="setting-row" for="timing-offset"><span><b>Timing offset</b><small>Positive values delay the note visuals</small></span><output id="offset-output">0 ms</output></label><input id="timing-offset" type="range" min="-200" max="200" step="5" value="0" aria-label="Timing offset in milliseconds"><p class="setting-note">Using Bluetooth headphones? Try a positive offset if the beat sounds late.</p><label class="setting-row"><span><b>Reduced effects</b><small>Less motion and fewer sparks; the blade stays visible</small></span><input id="reduced-motion" type="checkbox" role="switch" aria-label="Reduce visual effects"></label><button class="primary-button close-dialog">All set ${icon('check')}</button></dialog>
  <div id="toast" role="status"></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
type Phase = 'ready' | 'countdown' | 'playing' | 'paused' | 'results';
const music = new MusicEngine();
const arena = new Arena($('#arena'));
let selectedTrack = tracks[0];
let activeTrack: Track = selectedTrack;
let difficulty: Difficulty = 'flow';
let practice = false;
let notes: Note[] = [];
let score = new ScoreKeeper();
let phase: Phase = 'ready';
let phaseBeforePause: 'countdown' | 'playing' = 'playing';
let volume = 0.65;
let previousVolume = 0.65;
let timingOffset = 0;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let sessionId = 0;
let starting = false;
let lastPoint: { x: number; y: number; time: number } | undefined;
let feedbackUntil = 0;
let toastTimer = 0;
let highScores: Record<string, number> = {};
const BEST_STORAGE_KEY = 'splitbeat-best-saber-v2';
try {
  highScores = JSON.parse(localStorage.getItem(BEST_STORAGE_KEY) || '{}');
} catch {
  /* Storage is optional. */
}
if (!highScores || typeof highScores !== 'object' || Array.isArray(highScores)) highScores = {};

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}

function renderTracks() {
  $('#track-list').innerHTML = tracks
    .map(
      (track, i) =>
        `<button class="track-card ${selectedTrack.id === track.id ? 'selected' : ''}" data-track="${track.id}" aria-pressed="${selectedTrack.id === track.id}" aria-label="Select ${track.title}, ${track.bpm} BPM"><span class="album-art">${albumArt(i)}</span><span class="track-copy"><strong>${track.title}</strong><span>${track.subtitle}</span><small>${track.bpm} BPM <i>·</i> ${formatTime(track.duration)} <i>·</i> <span class="track-best">${highScores[`${track.id}-${difficulty}`] ? `BEST ${highScores[`${track.id}-${difficulty}`].toLocaleString()}` : 'ORIGINAL MIX'}</span></small></span><span class="track-selection">${selectedTrack.id === track.id ? icon('check', 15) : icon('play', 15)}</span></button>`,
    )
    .join('');
  document.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) =>
    button.addEventListener('click', () => {
      if (isActive()) return;
      selectedTrack = tracks.find((track) => track.id === button.dataset.track)!;
      if (phase === 'results') resetToReady();
      renderTracks();
      updateTrackInfo();
    }),
  );
  setControlsDisabled(isActive());
}

function updateTrackInfo() {
  $('#now-title').textContent = selectedTrack.title;
  $('#now-bpm').textContent = String(Math.round(selectedTrack.bpm * (practice ? 0.75 : 1)));
  $('#now-difficulty').textContent = difficulty.toUpperCase();
  $('.mini-album').innerHTML = albumArt(tracks.indexOf(selectedTrack));
  $('#timer').innerHTML =
    `00:00 <i>/</i> ${formatTime(selectedTrack.duration / (practice ? 0.75 : 1))}`;
}

function isActive() {
  return phase === 'countdown' || phase === 'playing' || phase === 'paused' || starting;
}
function setControlsDisabled(disabled: boolean) {
  document
    .querySelectorAll<HTMLButtonElement>('[data-track], [data-difficulty]')
    .forEach((button) => (button.disabled = disabled));
  $('#practice').toggleAttribute('disabled', disabled);
}

function updateScore() {
  $('#score').textContent = String(score.score).padStart(6, '0');
  $('#combo').innerHTML = `${score.combo}<span>×</span>`;
  $('#accuracy').innerHTML = `${Math.round(score.accuracy)}<span>%</span>`;
}

function setOverlay(name: 'launch' | 'pause' | 'results' | null) {
  for (const key of ['launch', 'pause', 'results'])
    $(`#${key}-overlay`).classList.toggle('hidden', name !== key);
}

async function startGame() {
  if (starting) return;
  const thisSession = ++sessionId;
  starting = true;
  setControlsDisabled(true);
  $('#start-button').setAttribute('disabled', '');
  try {
    await music.unlock();
    if (thisSession !== sessionId) return;
    music.stop();
    const rate = practice ? 0.75 : 1;
    activeTrack = {
      ...selectedTrack,
      bpm: selectedTrack.bpm * rate,
      duration: selectedTrack.duration / rate,
    };
    notes = createChart(activeTrack, difficulty);
    score = new ScoreKeeper();
    updateScore();
    lastCountdown = '';
    feedbackUntil = 0;
    lastPoint = undefined;
    arena.clearPointer();
    phase = 'countdown';
    music.start({
      bpm: activeTrack.bpm,
      duration: activeTrack.duration,
      trackId: activeTrack.id,
      volume,
    });
    if (document.hidden) pauseGame();
    setOverlay(document.hidden ? 'pause' : null);
    $('#pause-button').removeAttribute('disabled');
    $('#pause-button').setAttribute('aria-label', 'Pause game');
    $('#pause-button').innerHTML = icon('pause', 16);
    $('#mode-label').textContent = practice ? 'PRACTICE SESSION' : 'IN THE FLOW';
    $('#arena-shell').classList.add('is-playing');
    $('#arena-shell').focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    music.stop();
    phase = 'ready';
    setOverlay('launch');
    showToast('Audio could not start. Check your browser sound permissions and try again.');
  } finally {
    starting = false;
    $('#start-button').removeAttribute('disabled');
    setControlsDisabled(isActive());
  }
}

function pauseGame() {
  if (phase !== 'playing' && phase !== 'countdown') return;
  phaseBeforePause = phase;
  phase = 'paused';
  music.pause();
  lastPoint = undefined;
  arena.clearPointer();
  setOverlay('pause');
  $('#count-in').classList.add('hidden');
  $('#pause-button').innerHTML = icon('play', 16);
  $('#pause-button').setAttribute('aria-label', 'Resume game');
  $('#mode-label').textContent = 'TAKING A BREATH';
  $('#arena-shell').classList.remove('is-playing');
}

async function resumeGame() {
  if (phase !== 'paused' || starting) return;
  const thisSession = sessionId;
  starting = true;
  try {
    await music.resume();
    if (thisSession !== sessionId || document.hidden) {
      music.pause();
      return;
    }
    phase = phaseBeforePause;
    lastPoint = undefined;
    arena.clearPointer();
    lastCountdown = '';
    setOverlay(null);
    $('#pause-button').innerHTML = icon('pause', 16);
    $('#pause-button').setAttribute('aria-label', 'Pause game');
    $('#mode-label').textContent = practice ? 'PRACTICE SESSION' : 'IN THE FLOW';
    $('#arena-shell').classList.add('is-playing');
  } catch {
    showToast('Could not resume audio. Try again.');
  } finally {
    starting = false;
  }
}

function resetToReady() {
  sessionId++;
  music.stop();
  phase = 'ready';
  notes = [];
  score = new ScoreKeeper();
  updateScore();
  feedbackUntil = 0;
  $('#judgment').classList.remove('visible');
  setOverlay('launch');
  $('#count-in').classList.add('hidden');
  $('#pause-button').setAttribute('disabled', '');
  $('#progress-fill').style.width = '0%';
  $('.song-progress').setAttribute('aria-valuenow', '0');
  $('#mode-label').textContent = 'FIND YOUR FLOW';
  $('#arena-shell').classList.remove('is-playing');
  lastPoint = undefined;
  arena.clearPointer();
  setControlsDisabled(false);
  updateTrackInfo();
}

function completeGame() {
  phase = 'results';
  music.stop();
  lastPoint = undefined;
  arena.clearPointer();
  $('#arena-shell').classList.remove('is-playing');
  setOverlay('results');
  $('#count-in').classList.add('hidden');
  $('#pause-button').setAttribute('disabled', '');
  $('#progress-fill').style.width = '100%';
  $('.song-progress').setAttribute('aria-valuenow', '100');
  $('#mode-label').textContent = 'SESSION COMPLETE';
  const bestKey = `${selectedTrack.id}-${difficulty}`;
  const newBest = !practice && score.score > (highScores[bestKey] || 0);
  if (newBest) {
    highScores[bestKey] = score.score;
    try {
      localStorage.setItem(BEST_STORAGE_KEY, JSON.stringify(highScores));
    } catch {
      /* The game still works without persistent storage. */
    }
  }
  $('#result-kicker').textContent = practice
    ? 'PRACTICE COMPLETE · KEEP FINDING YOUR FLOW'
    : newBest
      ? 'A NEW PERSONAL BEST'
      : 'SESSION COMPLETE';
  $('#result-title').textContent =
    score.accuracy >= 90
      ? 'Perfectly in your element.'
      : score.accuracy >= 65
        ? "That's your rhythm."
        : 'Every beat is a new start.';
  $('#result-score').textContent = score.score.toLocaleString();
  $('#result-accuracy').textContent = `${Math.round(score.accuracy)}%`;
  $('#result-combo').textContent = `${score.maxCombo}×`;
  $('#result-perfect').textContent = String(score.perfect);
  $('#result-detail').textContent =
    `${score.perfect} perfect · ${score.good} good · ${score.misses} missed`;
  setControlsDisabled(false);
  renderTracks();
}

function gameTime() {
  return music.time - timingOffset / 1000;
}
function hitNote(note: Note) {
  const quality = judge(gameTime() - note.time);
  if (!quality || note.hit || note.missed) return;
  note.hit = true;
  score.hit(quality);
  music.hit(note.kind, quality);
  arena.burst(note, quality);
  if (note.kind === 'key') arena.keyFlash(note.lane, quality);
  showJudgment(quality);
  updateScore();
}

function showJudgment(quality: 'perfect' | 'good' | 'miss') {
  $('#judgment').textContent =
    quality === 'miss' ? 'MISSED' : quality === 'perfect' ? 'PERFECT' : 'GOOD';
  $('#judgment').className = `judgment visible ${quality}`;
  feedbackUntil = performance.now() + 550;
}

function showToast(message: string) {
  window.clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = window.setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}

$('#arena-shell').setAttribute('tabindex', '-1');
$('#start-button').addEventListener('click', startGame);
$('#resume-button').addEventListener('click', resumeGame);
$('#restart-paused').addEventListener('click', startGame);
$('#leave-paused').addEventListener('click', resetToReady);
$('#replay-button').addEventListener('click', startGame);
$('#back-button').addEventListener('click', resetToReady);
$('#pause-button').addEventListener('click', () =>
  phase === 'paused' ? resumeGame() : pauseGame(),
);

const laneKeys: Record<string, Lane> = {
  a: 0,
  ArrowLeft: 0,
  s: 1,
  ArrowDown: 1,
  w: 2,
  ArrowUp: 2,
  d: 3,
  ArrowRight: 3,
};
window.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === ' ') {
    event.preventDefault();
    if (event.repeat) return;
    if (phase === 'ready' || phase === 'results') void startGame();
    else if (phase === 'paused') void resumeGame();
    else pauseGame();
    return;
  }
  if (key === 'Escape') {
    pauseGame();
    return;
  }
  if (key === 'r' && isActive() && !event.repeat) {
    event.preventDefault();
    void startGame();
    return;
  }
  const lane = laneKeys[key];
  if (lane === undefined || !['playing', 'countdown'].includes(phase)) return;
  event.preventDefault();
  if (event.repeat) return;
  const note = findKeyNote(notes, lane, gameTime());
  if (note) hitNote(note);
  else arena.keyFlash(lane, 'miss');
});

const canvas = $<HTMLCanvasElement>('#arena');
function pointerPosition(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !['playing', 'countdown'].includes(phase)) return;
  event.preventDefault();
  const point = pointerPosition(event);
  lastPoint = { ...point, time: event.timeStamp };
  arena.pointer(point.x, point.y, true);
});
canvas.addEventListener('pointerenter', (event) => {
  const point = pointerPosition(event);
  lastPoint = { ...point, time: event.timeStamp };
  arena.pointer(point.x, point.y, false);
});
canvas.addEventListener('pointermove', (event) => {
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) {
    const point = pointerPosition(sample);
    arena.pointer(point.x, point.y, false);
    const elapsed = lastPoint ? sample.timeStamp - lastPoint.time : Infinity;
    // A fresh entry, old pointer sample, or resumed session must never create a
    // slash across the intervening space. Actual strokes retain swept collision.
    if (lastPoint && elapsed >= 0 && elapsed <= 120 && ['playing', 'countdown'].includes(phase)) {
      const note = arena.hitMouse(notes, gameTime(), point.x, point.y, lastPoint);
      if (note) hitNote(note);
    }
    lastPoint = { ...point, time: sample.timeStamp };
  }
});
function releasePointer() {
  lastPoint = undefined;
  arena.clearPointer();
}
canvas.addEventListener('pointerup', (event) => {
  if (event.pointerType === 'touch') releasePointer();
});
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
canvas.addEventListener('pointerleave', releasePointer);
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((button) =>
  button.addEventListener('click', () => {
    if (isActive()) return;
    difficulty = button.dataset.difficulty as Difficulty;
    if (phase === 'results') resetToReady();
    document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((other) => {
      other.classList.toggle('selected', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    });
    updateTrackInfo();
    renderTracks();
  }),
);
$<HTMLInputElement>('#practice').addEventListener('change', (event) => {
  practice = (event.target as HTMLInputElement).checked;
  if (phase === 'results') resetToReady();
  updateTrackInfo();
});

function openDialog(id: string) {
  pauseGame();
  $<HTMLDialogElement>(id).showModal();
}
$('#how-button').addEventListener('click', () => openDialog('#help-dialog'));
$('#settings-button').addEventListener('click', () => openDialog('#settings-dialog'));
document
  .querySelectorAll<HTMLButtonElement>('.close-dialog')
  .forEach((button) => button.addEventListener('click', () => button.closest('dialog')!.close()));
document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) =>
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  }),
);

function updateVolume() {
  music.setVolume(volume);
  $('#sound-button').innerHTML =
    `${icon(volume ? 'sound' : 'mute')}<span>SOUND ${volume ? 'ON' : 'OFF'}</span>`;
  $('#sound-button').setAttribute('aria-label', volume ? 'Mute sound' : 'Unmute sound');
  $<HTMLInputElement>('#volume').value = String(Math.round(volume * 100));
  $('#volume-output').textContent = `${Math.round(volume * 100)}%`;
}
$('#sound-button').addEventListener('click', () => {
  if (volume) {
    previousVolume = volume;
    volume = 0;
  } else volume = previousVolume || 0.65;
  updateVolume();
});
$('#volume').addEventListener('input', (event) => {
  volume = Number((event.target as HTMLInputElement).value) / 100;
  if (volume) previousVolume = volume;
  updateVolume();
});
$('#timing-offset').addEventListener('input', (event) => {
  timingOffset = Number((event.target as HTMLInputElement).value);
  $('#offset-output').textContent = `${timingOffset > 0 ? '+' : ''}${timingOffset} ms`;
});
$<HTMLInputElement>('#reduced-motion').checked = reducedMotion;
$('#reduced-motion').addEventListener('change', (event) => {
  reducedMotion = (event.target as HTMLInputElement).checked;
});
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('#arena-shell').requestFullscreen();
  } catch {
    showToast('Fullscreen is unavailable in this browser. Try opening the game in a separate tab.');
  }
});

let lastCountdown = '';
function frame(now: number) {
  const active = phase === 'countdown' || phase === 'playing';
  const time = gameTime();
  if (active) {
    if (phase === 'countdown' && time >= LEAD_IN) phase = 'playing';
    const countdown =
      time < LEAD_IN
        ? String(Math.min(3, Math.ceil(LEAD_IN - time)))
        : time < LEAD_IN + 0.45
          ? 'GO'
          : '';
    if (lastCountdown !== countdown) {
      $('#count-in').textContent = countdown;
      $('#count-in').classList.toggle('hidden', !countdown);
      lastCountdown = countdown;
    }
    for (const note of notes) {
      if (!note.hit && !note.missed && time - note.time > HIT_WINDOW) {
        note.missed = true;
        score.miss();
        showJudgment('miss');
        updateScore();
      }
    }
    const elapsed = Math.max(0, time - LEAD_IN);
    const percentage = Math.min(100, (elapsed / activeTrack.duration) * 100);
    $('#progress-fill').style.width = `${percentage}%`;
    $('.song-progress').setAttribute('aria-valuenow', String(Math.round(percentage)));
    $('#timer').innerHTML =
      `${formatTime(Math.min(elapsed, activeTrack.duration))} <i>/</i> ${formatTime(activeTrack.duration)}`;
    if (music.time >= activeTrack.duration + LEAD_IN) completeGame();
  }
  if (now > feedbackUntil) $('#judgment').classList.remove('visible');
  const renderTime = phase === 'ready' || phase === 'results' ? now / 1000 : time;
  arena.render({
    time: renderTime,
    notes,
    playing: active,
    preview: phase === 'ready' || phase === 'results',
    beat: (renderTime * (isActive() ? activeTrack.bpm : selectedTrack.bpm)) / 60,
    reducedMotion,
  });
  requestAnimationFrame(frame);
}

renderTracks();
updateTrackInfo();
updateScore();
requestAnimationFrame(frame);
