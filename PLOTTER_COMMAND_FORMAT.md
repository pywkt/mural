# Mural Plotter Command Format Specification

## Overview

The Mural plotter accepts a plain text command file that describes pen movements in 2D space. Each line contains one command. The plotter reads the file top to bottom, executing each command sequentially.

## File Structure

```
d<total_distance>
h<drawing_height>
<command>
<command>
...
```

### Header Lines (required, must be first two lines)

| Line | Format | Description |
|------|--------|-------------|
| 1 | `d<number>` | Total travel distance in mm (pen-up + pen-down movement combined). Used for progress tracking. |
| 2 | `h<number>` | Total height of the drawing in mm. Currently used only for validation (must be present). |

### Command Lines

After the two header lines, each line is one of:

| Command | Format | Description |
|---------|--------|-------------|
| Move/Draw | `<x> <y>` | Move to coordinates (x, y) in mm. Space-separated. If pen is down, this draws a line from the current position. |
| Pen Up | `p0` | Lift the pen (stop drawing). |
| Pen Down | `p1` | Lower the pen (start drawing). |

## Coordinate System

```
(0,0) ────────────────────── (width, 0)
  │                              │
  │        Drawing Area          │
  │                              │
  │         • home position      │
  │      (width/2, 350)          │
  │                              │
  ▼ y increases downward         │
```

- **Origin (0, 0):** Top-left corner of the drawing area.
- **X axis:** Increases to the right. Valid range: `0` to `width`.
- **Y axis:** Increases downward. Valid range: `0` to (no hard lower limit, but stay reasonable).
- **Units:** All coordinates are in **millimeters**.
- **Precision:** Coordinates are typically rounded to 1 decimal place (e.g. `123.4 567.8`), though the parser accepts any floating point value.

### Drawing Area Dimensions

The drawing area is derived from the distance between the two wall-mounted anchor pins (`topDistance`):

```
width = topDistance * 0.6
```

For example, if anchors are 1025mm apart, the drawing area is 615mm wide.

### Home Position

The plotter starts and ends each drawing at the **home position**:

```
homeX = width / 2
homeY = 350
```

This is the center of the drawing area, 350mm below the top. When the drawing finishes, the plotter automatically returns to this point.

## Drawing Sequence

A typical command sequence for drawing a single path:

```
p0              ← pen up (ensure pen is raised)
150.3 200.5     ← move to start of path (no drawing, pen is up)
p1              ← pen down (start drawing)
155.0 205.2     ← draw line segment
160.8 210.0     ← draw line segment
165.1 208.3     ← draw line segment
p0              ← pen up (done with this path)
```

### Rules

1. The file **must** start with `d` and `h` header lines.
2. The pen starts in the **up** position.
3. Always send `p0` before moving to a new path start to avoid drawing unwanted lines.
4. Always send `p1` after arriving at a path's starting point to begin drawing.
5. End the file with `p0` to ensure the pen is raised before the plotter returns home.
6. Coordinates outside the valid range (`x < 0`, `x > width`, `y < 0`) will cause an error and stop the drawing.

## Calculating the Distance Header

The `d` header value is the total Euclidean distance the pen travels across all move and draw commands. This is used for progress percentage display only — an approximate value is acceptable.

```
total_distance = sum of sqrt((x2-x1)² + (y2-y1)²) for each consecutive coordinate pair
```

Both pen-up travel and pen-down travel are included.

## Complete Example

A file that draws a small triangle centered near the home position on a plotter with 1025mm anchor spacing (width = 615mm):

```
d301.5
h100
p0
280.0 300.0
p1
335.0 400.0
p1
225.0 400.0
p1
280.0 300.0
p0
```

## Positioning a Drawing on Paper

If you want to draw on a specific paper size centered on the home position:

```
xOffset = (width - paperWidth) / 2
yOffset = homeY - (paperHeight / 2)
```

All drawing coordinates should fall within:
- **X:** `xOffset` to `xOffset + paperWidth`
- **Y:** `yOffset` to `yOffset + paperHeight`

For example, with Letter paper (216 x 279mm) on a 615mm-wide drawing area:
- `xOffset = (615 - 216) / 2 = 199.5`
- `yOffset = 350 - (279 / 2) = 210.5`
- Valid X range: 199.5 to 415.5
- Valid Y range: 210.5 to 489.5

## Summary of Parameters Your App Needs

| Parameter | How to get it | Example |
|-----------|---------------|---------|
| `topDistance` | User enters the distance between anchor pins (mm) | 1025 |
| `width` | `topDistance * 0.6` | 615 |
| `homeX` | `width / 2` | 307.5 |
| `homeY` | Always 350 | 350 |
