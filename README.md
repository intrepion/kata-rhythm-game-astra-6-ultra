# SPLITBEAT

A playable keyboard-and-mouse rhythm game. Orange arrow notes and translucent directional blocks approach together through one central playfield. Your keyboard taps the arrows while your mouse controls a visible lightsaber. Both hands share the same musical clock, combo, and score.

## Play locally

Requires Node.js 22.18+ or 24+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use a desktop browser with a keyboard and mouse. Music starts only after you start a session.

| Input           | Action                                              |
| --------------- | --------------------------------------------------- |
| A / Left arrow  | Hit a left-arrow note                               |
| S / Down arrow  | Hit a down-arrow note                               |
| W / Up arrow    | Hit an up-arrow note                                |
| D / Right arrow | Hit a right-arrow note                              |
| Move the mouse  | Swing the lightsaber in the block’s arrow direction |
| Space           | Start, pause, or resume                             |
| Escape          | Pause                                               |
| R               | Restart an active session                           |

Hit the orange arrows when they reach their outlined receptors. Swing the lightsaber through a glass block as its outer approach brackets meet its edges, following the large arrow on its face. No click or held mouse button is required. The whole illuminated blade can cut; its handle cannot. A stationary blade, a click, or a reverse-direction swing does not score. Holding a keyboard key does not repeatedly hit notes.

| Block color | Slice direction |
| ----------- | --------------- |
| Coral       | ← Left          |
| Cyan        | ↓ Down          |
| Lime        | ↑ Up            |
| Violet      | → Right         |

Directions use both color and arrow shape. The transparent faces keep the orange keyboard notes visible behind them. A generous 50-degree directional tolerance allows natural diagonal hand motion.

## Included

- A centered shared runway, translucent blocks with four distinct arrow colors, and a mouse-controlled lightsaber with a glowing blade, hilt, and slice feedback.
- Three original Web Audio soundtracks: **Afterglow** (100 BPM), **Night Drive** (120 BPM), and **Hyperlink** (140 BPM).
- **Chill**, **Flow**, and **Rush** charts, with an alternating-hand introduction and no keyboard chords.
- **Practice** stretches the same chart to 75% tempo without changing its notes.
- Perfect hits within 75 ms; good hits within 160 ms. Misses reset the combo but never end the session.
- Combo multipliers up to 4×, weighted accuracy, results, and local personal bests per track and difficulty. Practice does not set competitive bests. Directional-saber records are stored separately from the earlier click-based mode; earlier records are retained in browser storage.
- Pause on focus loss, resume, restart, change-track control, and fullscreen.
- Volume, ±200 ms timing calibration, and reduced visual effects.

Audio and charts share an AudioContext timeline. The three-second count-in is excluded from the displayed track duration. Positive timing offsets delay the visuals for audio output latency, such as Bluetooth headphones.

The game uses Canvas 2D and Web Audio, with TypeScript and Vite. Its art and music are generated locally; no audio files or third-party game assets are required. Google Fonts supplies the optional UI typefaces, with system fallbacks.

## Verification

```sh
npm test
npm run build
```

Unit tests cover centered geometry, every slice direction, swept blade collisions, direction and timing rejection, chart determinism and playability, practice chart identity, judgment windows, scoring, audio scheduling, pause/resume, and delayed audio-device races.

A browser integration harness is also included. From a fresh page on the Vite **development server**, run this in the browser's developer console:

```js
await (await import('/tests/browser-smoke.ts')).runBrowserSmoke();
```

It checks keyboard hits, directional no-click saber swings, held-key and stationary-click rejection, swept blade collisions, pointer history across pauses and exits, miss expiry, countdown pause/resume, end-of-song results, replay, controls, practice, and score storage. The harness temporarily substitutes a deterministic song clock; it does not replace the audio transport tests. Reload afterward to restore a fresh session. The harness is not part of the production build.

For a production preview:

```sh
npm run build
npm run preview
```
