# Mural (Fork)

This is a fork of [Mural](https://github.com/nikivanov/mural), an ESP32-based wall plotter. For the original documentation and hardware setup, visit [getmural.me](https://getmural.me).

This fork has diverged in two ways from upstream:

1. The firmware is strictly for **controlling the plotter** — it no longer does SVG processing on-device. The multi-step wizard was replaced with a single-page dashboard, and a lot of quality-of-life features were added.
2. SVG → `.mural` conversion lives in a separate offsite tool: [svg-to-mural](https://pywkt.github.io/mural/svg-to-mural/). It runs entirely in the browser, outputs a file you upload to the plotter.

Practical upshot: the on-device web UI fits in ~15 KB, so nearly the full 2.8 MB LittleFS partition is available for your uploaded command file. Useful if you plan to plot large or densely-filled drawings.

## What's Changed

### Single-page dashboard UI

The web UI has been rewritten as a single-page card dashboard — one card per phase (Distance, Artwork, Retract, Extend, Pen Calibration, Begin) with locked / active / completed states. Catppuccin Latte/Mocha color scheme with automatic light/dark mode via `prefers-color-scheme`. Fully offline (no CDN dependencies).

### Gzip compression

Static web assets are gzipped at build time; uploaded command files are gzipped in the browser (via `CompressionStream`) and stream-decompressed on the ESP32 at drawing time using the ROM-resident `tinfl_decompress` (no library dependency). Typical command files compress by ~70%, and the web UI itself lands at ~15 KB gzipped on LittleFS.

### New features

- **Quick Start** — Skip the full setup and resume immediately if the plotter is still at its home position. Top distance and pen calibration are cached in NVS.
- **Stop & Return Home** — Abort a drawing mid-plot from the UI; the runner finishes its current segment, lifts the pen, returns to home, then restarts. No need to power-cycle and re-home the belts when something snags. Once the plot finishes (or stops), reload the page to start the next one.
- **Paper size selection** — Choose from Letter, A4, A3 (portrait/landscape) or enter custom dimensions. Used to center `.mural` uploads on the chosen paper.
- **Margins** — Configurable X/Y margins applied during centering.
- **G-code support** — Upload `.gcode`, `.nc`, or `.ngc` files alongside `.mural`. The firmware auto-detects the format and parses `G0`/`G1` (movement) and `M3`/`M5` (pen control) commands.
- **Draw speed control** — Adjustable draw speed (100–1500 steps/s) on the Begin Drawing card, with a reset button.
- **Estimated draw time** — Rough time estimate based on pen-up/pen-down distances, pen transitions, draw speed, and servo delay. Updates live when settings change.
- **Edit / revisit any completed step** — Collapsed cards show an Edit button that rewinds the phase. Revisiting a phase that does physical work (Extend, Artwork) offers a skip-continue so you don't re-run motion unnecessarily.

### Tools modal

A gear icon in the page header opens a tools modal with:

- **Manual controls** — Motor sliders (left/right), servo slider with fine-adjustment buttons, Park Servo, E-steps calibration.
- **Inversions** — Invert left/right motor and servo direction (NVS-persisted).
- **Pen behavior** — Pen lift degrees and servo settle delay (NVS-persisted).

An info icon next to it opens a separate Debug modal with uptime, free heap, Wi-Fi, and filesystem stats.

## HTTP API

The plotter is driven by a small HTTP server on port 80. Every step the web UI takes is also available to external programs, which makes it straightforward to drive the plotter from your own app. The full reference lives in [docs/API.md](docs/API.md): phase state machine, every endpoint grouped by category, the `.mural` file format, the G-code subset, and a few client gotchas — notably, polling `/getState` during a draw causes visible motion stutter (each response steals main-loop CPU), and the device reboots after every plot.

A single-file Python example lives at [examples/drive.py](examples/drive.py) — stdlib only, with `state` / `cold` / `warm` / `stop` subcommands. It works against a real plotter at `mural.local` or against `dev.py` for offline iteration.

## Repo layout

```
src/               ESP32 firmware (C++ / PlatformIO)
include/           firmware headers
lib/               firmware-side libraries
data/www/          plotter web UI (flashed into LittleFS)
tsc/               TypeScript source for the svg-to-mural worker
docs/API.md        HTTP API reference for external controllers
docs/svg-to-mural/ the offsite SVG converter (served by GitHub Pages)
examples/          example external driver (Python) + a sample .mural file
build.py           PlatformIO extra script — stages and gzips data/www into the LittleFS image
dev.py             local mock server for iterating on the plotter UI (no flash needed)
platformio.ini     PlatformIO project config
partitions.csv     ESP32 partition layout
```

## Firmware & plotter UI

This is a [PlatformIO](https://platformio.org/) project. The plotter web UI is vanilla HTML/CSS/JS — no build step on that side.

Flash firmware and upload filesystem:

```
pio run -t upload
pio run -t uploadfs
```

Iterate on the plotter UI locally without flashing (stubs the ESP32 HTTP API):

```
python3 dev.py
```

Then visit <http://localhost:8000/>.

## The svg-to-mural tool

The plotter only accepts pre-generated command files. The companion tool at **[svg-to-mural](https://pywkt.github.io/mural/svg-to-mural/)** converts an SVG into a `.mural` file entirely in the browser (upload an SVG, pick paper size / infill / renderer, download the result). Source lives under `docs/svg-to-mural/`.

### Running the tool locally

Workers need an HTTP origin — `file://` won't work. From the repo root:

```
cd docs/svg-to-mural
python3 -m http.server
```

Then visit <http://localhost:8000/>.

### Rebuilding the worker

The worker is a webpack bundle of `tsc/` TypeScript source. Rebuild when you change anything in `tsc/`:

```
docs/svg-to-mural/build.sh
```

This installs npm deps if needed, runs `npm run build` in `tsc/`, and copies the built `worker.js` + `paper-full.min.js` into `docs/svg-to-mural/`. Commit the updated artifacts.

Alternative sources of command files — any tool that emits Mural format (see [PLOTTER_COMMAND_FORMAT.md](PLOTTER_COMMAND_FORMAT.md)) or G-code.

## Command Format

The plotter accepts two command formats:

- **Mural format** — Simple text with `d`/`h` headers, `p0`/`p1` pen commands, and `x y` coordinates. See [PLOTTER_COMMAND_FORMAT.md](PLOTTER_COMMAND_FORMAT.md) for the full specification.
- **G-code** — Standard 2D plotter G-code (`G0` for travel, `G1` for drawing, `M3`/`M5` for pen control). Feed rates and other parameters are ignored — the firmware uses its own configurable draw speed.

## Additional Information

### Positioning of the Drawing on the Wall

- The user defines the pin distance as part of the setup in the UI (e.g. 1000mm, i.e. d_pins in the image below).
- The top margin is 20% of that distance, so the top of the drawing area is 200mm below the line between the two pins.
- Each side has a 20% margin, giving a total drawing width of 60% of the pin distance (600mm for 1000mm pins).
- The plotter executes `.mural` or G-code commands line by line, in that coordinate space.

![image_positioning](/images/doc/muralbot_image_positioning.svg)

### Mural's Kinematic Model

See [KinematicModel.md](KinematicModel.md).

## License

Licensed under **[CC BY-NC 4.0](LICENSE.md)** (Creative Commons Attribution-NonCommercial 4.0), inherited from the upstream [Mural](https://github.com/nikivanov/mural) project. Non-commercial use only; attribution required.
