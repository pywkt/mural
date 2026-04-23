# Mural Plotter HTTP API

The plotter firmware runs a small HTTP server on the ESP32 that exposes
every step of the draw flow and the live device state. This document is
the contract an external controller (e.g. a desktop app that generates
and sends `.mural` files) should target.

## Connection

- After the device joins WiFi, it advertises itself over mDNS as
  `mural.local`. If mDNS isn't available on your network, the IP is
  shown on the OLED at boot and in the captive portal.
- Base URL: `http://mural.local/` or `http://<device-ip>/`
- No auth. The device assumes a trusted LAN.
- Content-Type for mutating requests: `application/x-www-form-urlencoded`
  (the built-in UI uses `URLSearchParams`); the only exception is
  `/uploadCommandsRaw`, which takes a gzipped body.

## Phase state machine

The device is always in exactly one phase. Endpoints are phase-gated —
calling something that isn't supported in the current phase returns
`400`.

```
                    (boot)
                       │
                       ▼
              ┌─────────────────┐
              │ SetTopDistance  │◄──────────────────── (draw end)
              └────────┬────────┘                            ▲
                       │ /setTopDistance or /resume          │
                       ▼                                     │
              ┌─────────────────┐                            │
              │    SvgSelect    │                            │
              └────────┬────────┘                            │
                       │ /uploadCommandsRaw                  │
          ┌────────────┴────────────┐                        │
          │ (not homed)             │ (homed, e.g. after     │
          │                         │  /resume)              │
          ▼                         │                        │
  ┌───────────────┐                 │                        │
  │ RetractBelts  │                 │                        │
  └──────┬────────┘                 │                        │
         │ /doneWithPhase           │                        │
         ▼                          │                        │
  ┌───────────────┐                 │                        │
  │ ExtendToHome  │                 │                        │
  └──────┬────────┘                 │                        │
         │ (auto when homing ends)  │                        │
         └────────┬─────────────────┘                        │
                  ▼                                          │
         ┌───────────────────┐                               │
         │  PenCalibration   │                               │
         └────────┬──────────┘                               │
                  │ /setPenDistance                          │
                  ▼                                          │
         ┌───────────────────┐    /run    ┌──────────────┐   │
         │   BeginDrawing    │───────────▶│   drawing    │──┘
         └───────────────────┘            │   (/stop or  │
                                          │   finish →   │
                                          │   restart)   │
                                          └──────────────┘
```

`/setPhase` can move the device to any named phase manually — the
built-in UI uses it for the "Edit" buttons that rewind a card.

Phase enum values (strings):
`SetTopDistance`, `SvgSelect`, `RetractBelts`, `ExtendToHome`,
`PenCalibration`, `BeginDrawing`.

## Device state

`GET /getState` returns JSON with every field below; all mutating
endpoints also return the same JSON shape after they run (often with
transitions already applied), so you rarely need a follow-up
`/getState`.

| Field                | Type    | Meaning |
|----------------------|---------|---------|
| `phase`              | string  | Current phase name (see enum above). |
| `moving`             | bool    | `true` while motors are turning. |
| `topDistance`        | int     | Distance between the two nails, mm. `-1` until set. |
| `safeWidth`          | double  | Usable drawing width (mm). `-1` until `topDistance` is set. Derived as `topDistance * 0.6`. |
| `homeX`, `homeY`     | double  | Home position in the drawing coordinate frame (mm). `homeX = safeWidth/2`, `homeY = 350`. |
| `leftMotorInverted`  | bool    | NVS-persisted per-device wiring flag. |
| `rightMotorInverted` | bool    | Same. |
| `servoInverted`      | bool    | NVS-persisted; some pen assemblies mount the servo horn flipped. |
| `penLiftAmount`      | int     | Degrees the servo moves on pen up. NVS-persisted. |
| `servoDelay`         | int     | ms wait after each pen up/down so the servo settles before moving. NVS-persisted. |
| `savedTopDistance`   | int     | Last successfully-used `topDistance`, from NVS. `0` if none. Use with `/resume`. |
| `savedPenDistance`   | int     | Last calibrated pen angle, from NVS. |
| `drawSpeed`          | int     | Current draw speed, steps/sec. |
| `defaultDrawSpeed`   | int     | Firmware default (`500`). |
| `running`            | bool    | `true` iff the runner is actively drawing (phase alone doesn't tell you this — `BeginDrawing` covers both "ready to draw" and "drawing"). |
| `progress`           | int     | 0–100 when `running`, `-1` otherwise. |
| `totalDistance`      | double  | Total pen path length of the current draw, mm. `0` when not running. |
| `distanceSoFar`      | double  | How much of `totalDistance` has been covered, mm. |

## Endpoint reference

All mutating endpoints return the current state JSON unless noted.
Invalid-phase calls return `400 text/plain`. Unexpected issues with
params return `400` as well.

### State

| Method | Path          | Params | Notes |
|--------|---------------|--------|-------|
| GET    | `/getState`   | —      | Canonical device state. Safe any time. |
| GET    | `/debug`      | —      | JSON with `resetReason`, `freeHeap`, `minFreeHeap`, `heapSize`, `uptimeSeconds`, `wifiRSSI`, `wifiIP`, `fsTotal`, `fsUsed`. Useful for diagnostics. |

### Setup / flow control

| Method | Path              | Params          | Valid phases | Effect |
|--------|-------------------|-----------------|--------------|--------|
| POST   | `/setTopDistance` | `distance=<mm>` | `SetTopDistance` | Sets nail-to-nail distance, moves to `SvgSelect`. |
| POST   | `/resume`         | `distance=<mm>` | `SetTopDistance` | Same as `/setTopDistance` but also flags the device as already homed and restores the saved pen distance from NVS. Use when the plotter is still physically at the home position from a previous draw. |
| POST   | `/setPhase`       | `phase=<name>`  | any          | Manual phase jump. Does not reset physical state; use with care. |
| POST   | `/doneWithPhase`  | —               | `RetractBelts` (advances to `ExtendToHome`), `BeginDrawing` (resets to `SetTopDistance`) | Phase-specific "I'm done" signal. |

### Physical homing

| Method | Path            | Params | Valid phases | Effect |
|--------|-----------------|--------|--------------|--------|
| POST   | `/command`      | `command=<l-ret\|l-ext\|l-0\|r-ret\|r-ext\|r-0>` | `RetractBelts`, `SetTopDistance` | Nudge the left/right stepper: retract (`-ret`), extend (`-ext`), stop (`-0`). Used to land belts on the homing screws. |
| POST   | `/extendToHome` | —      | `ExtendToHome` | Starts the homing move. Response JSON includes a top-level `extendTime` field (seconds of ETA). When `moving` goes back to `false`, the phase auto-transitions to `PenCalibration`. |

### Pen

| Method | Path                  | Params            | Valid phases | Effect |
|--------|-----------------------|-------------------|--------------|--------|
| POST   | `/setServo`           | `angle=<0-90>`    | `PenCalibration`, `SetTopDistance` | Raw servo angle for calibration. Does not persist. |
| POST   | `/setPenDistance`     | `angle=<0-90>`    | `PenCalibration` | Persists the pen-down angle and moves to `BeginDrawing`. |
| POST   | `/setPenLift`         | `amount=<deg>`    | any          | How far the servo lifts the pen between strokes. NVS. |
| POST   | `/setServoDelay`      | `delay=<ms>`      | any          | Settle time after each pen up/down. NVS. |
| POST   | `/setServoInversion`  | `inverted=<bool>` | any          | Flip servo direction. NVS. |
| POST   | `/estepsCalibration`  | —                 | `SetTopDistance` | Runs a 1000 mm belt extension for measuring e-steps. |

### Motors

| Method | Path                 | Params                           | Valid phases | Effect |
|--------|----------------------|----------------------------------|--------------|--------|
| POST   | `/setDrawSpeed`      | `speed=<steps/sec, 100-1500>`    | any          | Live draw speed override. NVS-like behavior (persists until reboot). |
| POST   | `/setMotorInversion` | `left=<bool>` and/or `right=<bool>` | any       | Flip stepper direction pins. NVS. |

### File upload

| Method | Path                  | Body                                | Valid phases | Effect |
|--------|-----------------------|-------------------------------------|--------------|--------|
| POST   | `/uploadCommandsRaw`  | **gzipped** `.mural`/G-code text; `Content-Type: application/gzip` | `SvgSelect` | Writes `/commands.gz` on LittleFS. Transitions to `PenCalibration` if homed, else `RetractBelts`. Preferred upload path. |
| POST   | `/uploadCommands`     | multipart/form-data                 | `SvgSelect` | Legacy multipart upload (not gzipped). Still supported; the built-in UI no longer uses it. |
| GET    | `/downloadCommands`   | —                                   | any          | Returns the stored commands. **The file is stored gzipped and served with `Content-Encoding: gzip`.** Browsers auto-decompress; `requests` does too if you don't set `stream=True`. Some HTTP clients will hand you raw gzip bytes — be explicit about what you want. |

### Draw control

| Method | Path    | Params | Valid phases   | Effect |
|--------|---------|--------|----------------|--------|
| POST   | `/run`  | —      | `BeginDrawing` | Opens `/commands.gz`, kicks off the runner. Response: state (with `running: true`). |
| POST   | `/stop` | —      | any (no-op if not running) | Cooperative stop: the runner finishes the current segment, lifts the pen, moves back to home, then `ESP.restart()`s. See *Post-draw reboot* below. |

## Typical sequences

### Cold start (fresh boot, no prior drawing)

```
GET  /getState                        → phase=SetTopDistance, savedTopDistance=0
POST /setTopDistance  distance=800    → phase=SvgSelect
POST /uploadCommandsRaw  (body: gzipped .mural)
                                      → phase=RetractBelts (not homed)
# Human loops belts onto homing screws and retracts each until it stalls
POST /command  command=l-ret
POST /command  command=l-0            (stop when stalled)
POST /command  command=r-ret
POST /command  command=r-0
POST /doneWithPhase                   → phase=ExtendToHome
POST /extendToHome                    → { ..., extendTime: 12 }
# wait extendTime seconds, then poll /getState until phase != ExtendToHome
# (polling at setup time is fine — the stutter only matters during a draw)
GET  /getState                        → phase=PenCalibration
# Calibrate: drive the pen onto the wall
POST /setServo  angle=45              (iterate until pen is touching)
POST /setPenDistance  angle=45        → phase=BeginDrawing
POST /run                             → running=true, totalDistance=1234.5
# draw ...
# device reboots at completion; wait ~15 s; poll /getState or retry the connection
```

### Warm start (plotter already hanging at home from the previous draw)

```
GET  /getState                        → phase=SetTopDistance, savedTopDistance=800
POST /resume  distance=800            → phase=SvgSelect, homed=true
POST /uploadCommandsRaw  (body: gzipped .mural)
                                      → phase=PenCalibration (homed, so skip RetractBelts + ExtendToHome)
POST /setPenDistance  angle=<saved>   → phase=BeginDrawing (can reuse state.savedPenDistance)
POST /run                             → running=true
```

### Abort a draw

```
POST /stop                            → runner drains, pen up, moves home, ESP restarts
# wait ~15 s for the reboot
GET  /getState                        → phase=SetTopDistance, savedTopDistance preserved
# now use the warm-start flow to plot again without re-homing
```

## `.mural` file format

Plain text, newline-separated. Two header lines then a sequence of
commands.

```
d<total_distance_mm>
h<drawing_height_mm>
<command>
<command>
...
```

Commands:

| Line                | Meaning |
|---------------------|---------|
| `p0`                | Pen up (travel). |
| `p1`                | Pen down (draw). |
| `<x> <y>`           | Move to absolute coordinates in mm, space-separated. Pen state follows the most recent `p` line. |

The device's drawing origin is top-center of the usable area:
`x ∈ [0, safeWidth]`, `y = 0` at the top, increasing downward. Home
is `(safeWidth/2, 350)`.

`total_distance_mm` is the **sum of all segment lengths including travel
moves** — it's used as the denominator for the progress field.
`drawing_height_mm` is informational (the firmware validates it exists
but doesn't use it).

Example:

```
d420.5
h200
p1
50 100
150 100
p0
150 200
p1
250 200
```

## G-code (subset)

The firmware also accepts G-code files uploaded the same way (extensions
`.gcode`, `.nc`, `.ngc`). The subset is narrow:

- `G0`, `G1` — linear move. `X` and `Y` read as absolute mm. Other axes
  ignored. `G0` implies pen up, `G1` implies pen down (the firmware
  treats the distinction as the pen-down signal, not as a speed switch).
- `M3` — pen down (spindle-on proxy). Idempotent.
- `M5` — pen up (spindle-off proxy). Idempotent.
- Inline comments (`;…` to end of line) are stripped.
- Everything else is ignored.

If you already have a `.mural` emitter, use it — it's slightly denser on
the wire, and the progress totals match because they're measured the
same way.

## Client notes

### Polling during a draw causes motion stutter

Serving a `/getState` response takes main-loop CPU time on the ESP32,
which briefly delays the next call to the stepper runner. On real
hardware this shows up as a visible pause in pen motion per request.

Recommendations:
- Don't poll on a fast timer while `running: true`. The built-in web UI
  doesn't poll at all during a draw.
- If you want a progress bar, poll at ≥30 s, or gate polling to "only
  when the user is looking at the progress screen."
- Read-only endpoints (`/getState`, `/debug`) are not magic — they
  cause the same stutter as mutating ones, because the cost is the
  JSON response, not the mutation.
- Setup-phase polling (e.g. waiting for `/extendToHome` to finish) is
  fine — no steppers are running a plot.

### Post-draw reboot

A normal draw completion and a `/stop` both end the same way: the
runner runs its finishing sequence (pen up → move to home →
`ESP.restart()`). Expect the server to be unreachable for ~10–30
seconds afterwards while WiFi reconnects.

A decent client recovery loop:
1. After `/run` response confirms `running: true`, keep the UI on a
   "drawing" screen without polling.
2. The user (or a completion timer based on `totalDistance / drawSpeed`)
   triggers a refresh.
3. On refresh, do `/getState`; retry with backoff for ~30 s if the
   request fails; once it succeeds, the new `phase` and
   `savedTopDistance` tell you whether you can warm-start or need to
   cold-start.

### Upload size and gzip

LittleFS gets the 2800 KB partition defined in `partitions.csv`. The
web UI takes ~15 KB of that (gzipped), so roughly 2.7 MB is free for
`commands.gz`. Gzipped `.mural` files are tiny (a few bytes per
segment), so this is almost never the limit — but if you're
compressing client-side with anything other than browser
`CompressionStream`, make sure the payload is a single gzip stream
(not a multi-member concat) because `GzipFileReader` only reads one
member.

### There is no authentication

The API assumes a trusted LAN. If you expose the plotter outside your
network, put it behind your own auth.
