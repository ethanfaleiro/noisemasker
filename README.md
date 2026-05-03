# Noise Masker

A cross-platform desktop app (Windows + macOS) that plays procedurally
generated white / pink / brown / blue / violet noise for sound masking.
Built with **Electron**. No audio files — all noise generated in real-time
via the Web Audio API `AudioWorklet`.

---

## Project Structure

```
noise-masker/
├── main.js                  Electron main process
├── preload.js               Secure context bridge (renderer ↔ main)
├── package.json
├── assets/                  Place icon files here (see Icons section)
└── renderer/
    ├── index.html           UI
    ├── style.css            Dark theme + CSS variable theming
    ├── renderer.js          Audio engine + UI controller
    └── noise-worklet.js     AudioWorklet noise generator (audio thread)
```

---

## Quick Start (Development)

### Prerequisites

- **Node.js** 18+ — https://nodejs.org
- **npm** 8+

### Install & Run

```bash
cd noise-masker
npm install
npm run dev        # Opens app with DevTools detached
# or
npm start          # Normal launch (no DevTools)
```

---

## Audio Architecture

```
AudioWorkletNode (noise-worklet.js)
    │  Generates raw noise samples on the audio thread
    ▼
DynamicsCompressorNode   ← hard-knee limiter (threshold: -14 dBFS, ratio: 20:1)
    │  Clamps any rogue peaks before they reach the gain stages
    ▼
GainNode (volGain)       ← user volume   │ hard-capped at MAX_GAIN = 0.70
    │  Maps slider 0–100% → gain 0–0.70  │ regardless of any bug
    ▼
GainNode (fadeGain)      ← smooth on/off │ exponential 1.2s fade
    │  0 → 1 on play, 1 → 0 on stop
    ▼
AudioContext.destination
```

### Safety measures

| Measure | Detail |
|---|---|
| `MAX_GAIN = 0.70` | Hard-coded ceiling; `Math.min()` enforced in `safeGain()` |
| Default volume | 10% on first launch |
| DynamicsCompressor | Limiter mode (ratio 20:1, 1 ms attack, hard knee) |
| Exponential fade | `exponentialRampToValueAtTime` — no clicks or pops |
| `setTargetAtTime` for slider | 60 ms time constant — no zipper noise during drag |
| Worklet isolation | Noise runs in audio thread — renderer jank cannot cause glitches |

### Noise types

| Type | Spectrum | Character |
|---|---|---|
| White | Flat | Bright, even hiss |
| Pink | −3 dB/oct | Balanced, natural — best for masking |
| Brown (Red) | −6 dB/oct | Deep, rumbling |
| Blue | +3 dB/oct | Airy, high-freq emphasis |
| Violet | +6 dB/oct | Very sharp, hissy |

---

## Building for Distribution

### Required — Icon Files

Place in `assets/`:

| File | Platform | Recommended Size |
|---|---|---|
| `icon.icns` | macOS DMG | 1024×1024 (Retina) |
| `icon.ico` | Windows installer | 256×256 |
| `icon.png` | Taskbar / generic | 512×512 |
| `tray-icon.png` | System tray | 22×22 (macOS) / 16×16 (Win) |

You can generate `.icns` / `.ico` from a PNG using:
- **macOS**: `iconutil` or https://cloudconvert.com
- **Windows**: https://convertico.com
- **Cross-platform**: `electron-icon-builder` npm package

### Build Commands

```bash
# macOS (run on macOS)
npm run build:mac

# Windows (run on Windows, or via CI)
npm run build:win

# Both (requires appropriate runners)
npm run build:all
```

Built installers appear in `dist/`.

### macOS — Code Signing & Notarisation

For distribution outside the Mac App Store you must sign and notarise:

```bash
# Set in environment or electron-builder.yml:
CSC_LINK=path/to/Developer_ID.p12
CSC_KEY_PASSWORD=yourpassword
APPLE_ID=you@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX
```

Then `npm run build:mac` will sign and notarise automatically.

### Windows — Code Signing

```bash
WIN_CSC_LINK=path/to/cert.pfx
WIN_CSC_KEY_PASSWORD=yourpassword
```

---

## Keyboard Shortcut

| Key | Action |
|---|---|
| `Space` | Toggle play / stop |

---

## Settings

All settings are saved to `localStorage` and restored on next launch:

- Selected noise type
- Volume level
- Accent colour
- Background colour

---

## Known Behaviour

- **Closing the window** hides the app to the system tray; audio continues.
- **Quit** via the tray icon context menu → "Quit".
- On **macOS**, clicking the Dock icon shows the window again.
- A second launch of the app focuses the existing instance.
