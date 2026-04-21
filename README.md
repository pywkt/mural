# Mural (Fork)

This is a fork of [Mural](https://github.com/nikivanov/mural), an ESP32-based wall plotter. For the original documentation and hardware setup, visit [getmural.me](https://getmural.me).

This fork has diverged in two ways from upstream:

1. The firmware is strictly for **controlling the plotter** — it no longer does SVG processing on-device. The multi-step wizard was replaced with a single-page dashboard, and a lot of quality-of-life features were added.
2. SVG → `.mural` conversion lives in a separate offsite tool: [svg-to-mural](https://pywkt.github.io/mural/svg-to-mural/). It runs entirely in the browser, outputs a file you upload to the plotter.

## What's Changed

### Single-page dashboard UI

The web UI has been rewritten as a single-page card dashboard — one card per phase (Distance, Artwork, Retract, Extend, Pen Calibration, Begin) with locked / active / completed states. Catppuccin Latte/Mocha color scheme with automatic light/dark mode via `prefers-color-scheme`. Fully offline (no CDN dependencies).

### Gzip compression

Static web assets are gzipped at build time; uploaded command files are gzipped in the browser (via `CompressionStream`) and stream-decompressed on the ESP32 at drawing time using the ROM-resident `tinfl_decompress` (no library dependency). Typical command files compress by ~70%.

### New features

- **Quick Start** — Skip the full setup and resume immediately if the plotter is still at its home position. Top distance and pen calibration are cached in NVS.
- **Drawing completion detection** — The UI polls the ESP32 and notifies you when a drawing finishes.
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

## Building

This is a [PlatformIO](https://platformio.org/) project. All the web UI assets are vanilla HTML/CSS/JS — no worker build step.

To flash the firmware and upload the filesystem:

```
pio run -t upload
pio run -t uploadfs
```

To iterate on the web UI locally without flashing, run the dev mock server:

```
python3 dev.py
```

It serves `data/www/` and stubs the ESP32 HTTP API so you can walk through the full flow in a browser.

## Converting SVGs

The plotter only accepts pre-generated command files. To convert an SVG:

- Use the **[svg-to-mural](https://pywkt.github.io/mural/svg-to-mural/)** tool (hosted on GitHub Pages, runs entirely in the browser). Upload an SVG, pick paper size / infill / renderer options, download a `.mural` file.
- Or use any other source that emits the Mural command format (see [PLOTTER_COMMAND_FORMAT.md](PLOTTER_COMMAND_FORMAT.md)) or G-code.

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
