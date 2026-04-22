#!/usr/bin/env python3
"""Drive a Mural plotter over HTTP. Small stdlib-only example.

Subcommands:
  state             Print the current /getState.
  cold FILE         Walk through a cold-start draw: set top distance,
                    upload FILE, prompt for the physical belt/pen steps,
                    then /run.
  warm FILE         Warm-start draw. Reuses savedTopDistance and
                    savedPenDistance from NVS, skips the physical setup.
                    Requires the plotter to already be at home (e.g.
                    right after a previous draw).
  stop              Ask a running draw to stop and return home.

Defaults to --host mural.local. Use --host localhost:8000 (or whatever
port) to exercise the flow against dev.py without flashing.

See docs/API.md for the full reference.
"""
import argparse
import gzip
import json
import sys
import time
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import URLError


def get_state(host):
    with urlopen(f"http://{host}/getState", timeout=5) as r:
        return json.loads(r.read())


def post(host, path, **params):
    body = urlencode(params).encode() if params else b""
    req = Request(f"http://{host}{path}", data=body, method="POST")
    with urlopen(req, timeout=30) as r:
        raw = r.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw.decode(errors="replace")


def upload(host, path):
    with open(path, "rb") as f:
        compressed = gzip.compress(f.read())
    req = Request(f"http://{host}/uploadCommandsRaw", data=compressed, method="POST")
    req.add_header("Content-Type", "application/gzip")
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def wait_for_phase(host, target, timeout=60, interval=2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            state = get_state(host)
            if state["phase"] == target:
                return state
        except URLError:
            pass
        time.sleep(interval)
    raise TimeoutError(f"Did not reach phase {target} within {timeout} s")


def cmd_state(args):
    print(json.dumps(get_state(args.host), indent=2))


def cmd_cold(args):
    state = get_state(args.host)
    if state["phase"] != "SetTopDistance":
        sys.exit(f"Device is in {state['phase']}, expected SetTopDistance.")

    distance = args.distance or int(input("Anchor distance (mm): "))
    print(f"-> /setTopDistance distance={distance}")
    post(args.host, "/setTopDistance", distance=distance)

    print(f"-> /uploadCommandsRaw {args.file}")
    state = upload(args.host, args.file)
    print(f"   phase is now {state['phase']}")

    if state["phase"] == "RetractBelts":
        print()
        print("Physical step: loop each belt on its homing screw, retract until")
        print("the motors stall, then stop them. Use the web UI or /command from")
        print("another shell. This script does not automate stall detection.")
        input("Press Enter once both belts are seated...")
        post(args.host, "/doneWithPhase")
        state = get_state(args.host)

    if state["phase"] == "ExtendToHome":
        print("-> /extendToHome")
        res = post(args.host, "/extendToHome")
        wait = int(res.get("extendTime", 15))
        print(f"   waiting ~{wait} s for homing move")
        time.sleep(wait)
        state = wait_for_phase(args.host, "PenCalibration", timeout=60)

    if state["phase"] != "PenCalibration":
        sys.exit(f"Unexpected phase {state['phase']} after homing.")

    print()
    print("Physical step: calibrate the pen so it just touches the wall.")
    print("Use the web UI for a slider, or POST /setServo angle=<0-90>.")
    angle = int(input("Final pen angle (0-90): "))
    print(f"-> /setPenDistance angle={angle}")
    post(args.host, "/setPenDistance", angle=angle)

    print("-> /run")
    res = post(args.host, "/run")
    total = res.get("totalDistance", 0)
    print(f"   running; totalDistance={total:.1f} mm")
    print()
    print("Polling every 60 s. Don't poll much faster while a draw is running")
    print("— each /getState briefly stalls the stepper loop.")
    _monitor(args.host)


def cmd_warm(args):
    state = get_state(args.host)
    if state["phase"] != "SetTopDistance":
        sys.exit(f"Device is in {state['phase']}, expected SetTopDistance.")
    saved_distance = int(state.get("savedTopDistance") or 0)
    if saved_distance <= 0:
        sys.exit("No savedTopDistance in NVS — do a cold start first.")

    print(f"-> /resume distance={saved_distance}")
    post(args.host, "/resume", distance=saved_distance)

    print(f"-> /uploadCommandsRaw {args.file}")
    state = upload(args.host, args.file)
    if state["phase"] != "PenCalibration":
        sys.exit(f"Expected PenCalibration after upload, got {state['phase']}.")

    saved_angle = int(state.get("savedPenDistance") or 45)
    print(f"-> /setPenDistance angle={saved_angle} (from NVS)")
    post(args.host, "/setPenDistance", angle=saved_angle)

    print("-> /run")
    res = post(args.host, "/run")
    total = res.get("totalDistance", 0)
    print(f"   running; totalDistance={total:.1f} mm")
    _monitor(args.host)


def cmd_stop(args):
    post(args.host, "/stop")
    print("Stop requested. Plotter will finish the current segment,")
    print("return home, and reboot (~10-30 s offline).")


def _monitor(host):
    last = -2
    while True:
        try:
            state = get_state(host)
            if state.get("running"):
                p = state.get("progress", -1)
                if p != last:
                    print(f"   {p}%")
                    last = p
            else:
                print(f"Runner idle; phase={state['phase']}")
                return
        except URLError:
            print("   connection lost (reboot?) — retrying")
        time.sleep(60)


def main():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--host", default="mural.local")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("state").set_defaults(func=cmd_state)

    c = sub.add_parser("cold")
    c.add_argument("file")
    c.add_argument("--distance", type=int, help="Skip the interactive prompt for anchor distance.")
    c.set_defaults(func=cmd_cold)

    w = sub.add_parser("warm")
    w.add_argument("file")
    w.set_defaults(func=cmd_warm)

    sub.add_parser("stop").set_defaults(func=cmd_stop)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
