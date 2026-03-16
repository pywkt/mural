# Mural (Fork)

This is a fork of [Mural](https://github.com/nikivanov/mural), an ESP32-based wall plotter. For the original documentation and hardware setup, visit [getmural.me](https://getmural.me).

## What's Changed

This fork adds a number of web UI improvements and quality-of-life features to the original Mural firmware.

### Web UI Overhaul

The web UI has been rewritten to work **fully offline** with zero CDN dependencies. Bootstrap, jQuery, jquery-throttle-debounce, the LESS compiler, and Bootstrap Icons have all been replaced with vanilla HTML, CSS, and JavaScript. The paper.js library is now served locally from the ESP32's flash storage.

### New Features

- **Quick Start** — Skip the full setup flow and resume drawing immediately if the plotter is still at its home position. The top distance and pen calibration are cached in NVS.
- **Drawing completion detection** — The UI polls the ESP32 and notifies you when a drawing finishes.
- **Paper size selection** — Choose from standard paper sizes (Letter, A4, A3 in portrait/landscape) or enter custom dimensions. The SVG is scaled to fit within the selected paper and centered on the home position.
- **Margins** — Configurable X/Y margins (in mm) that inset the drawing area for both SVG and raw command uploads.
- **Raw command upload** — Upload pre-generated `.txt` or `.mural` command files directly, bypassing SVG processing. An optional "Center drawing on paper" checkbox applies the current paper size and margin settings.
- **Infill patterns** — Choose from horizontal, vertical, diagonal, crosshatch, or concentric infill patterns with adjustable spacing, replacing the old 5-step density slider.
- **Back buttons** — Navigate backwards through all setup steps.

### Tools Modal

A gear icon on the setup page opens a tools modal with:

- **Servo controls** — Range slider with fine-adjustment buttons and a Park Servo button.
- **Motor inversion toggles** — Invert left/right motor direction, persisted in NVS.
- **Servo inversion toggle** — Invert the servo direction, persisted in NVS. Pen calibration and lift behavior adapt automatically.
- **Pen lift adjustment** — Configurable pen lift amount (in degrees), persisted in NVS.
- **E-steps calibration** — Extend belts 1000mm for calibration.

## Building

This is a [PlatformIO](https://platformio.org/) project. The web worker (SVG processing) is built from TypeScript:

```
cd tsc
npm install
npm run build
```

PlatformIO's `build.py` script handles this automatically and copies the built worker and paper.js library to `data/www/`.

To flash the firmware and upload the filesystem:

```
pio run -t upload
pio run -t uploadfs
```

## Additional Information

### Positioning of the Drawing on the Wall

- The user defines the pin distance as part of the setup in the UI. For example 1 meter (or 1000mm). (This is d_pins in the image below.)
- The top margin is 20% of that distance, so the top of the image will be 200mm below the line between the two pins.
- Each side also has a 20% margin, so you'll get total of 60% of the horizontal distance, or 600mm.
- Now that we have the max width (600mm), the SVG is resized so its width is 600 and the height gets resized proportionally.
- Then a processing step is performed on the SVG to figure out what to actually draw, with each SVG unit being treated as millimeter.
- Finally it's converted into a simple format for Mural to draw, containing mostly its coordinate movement commands and pen up/down. This file is then uploaded to the microcontroller and executed line by line.

![image_positioning](/images/doc/muralbot_image_positioning.svg)

### Mural's Kinematic Model

Please find the kinematic model [here](KinematicModel.md).
