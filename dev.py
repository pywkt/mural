#!/usr/bin/env python3
"""
Local dev server for the Mural web UI.

Serves data/www/ statically and mocks the ESP32 HTTP API with an in-memory
phase state machine so the frontend can be iterated on without flashing
the device.

Usage:  python3 dev.py [PORT]   (default port 8000)
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

WWW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "www")
DEFAULT_PORT = 8000

state = {
    "phase": "SetTopDistance",
    "moving": False,
    "topDistance": -1,
    "safeWidth": -1,
    "homeX": 307.5,
    "homeY": 350,
    "leftMotorInverted": False,
    "rightMotorInverted": False,
    "servoInverted": False,
    "penLiftAmount": 10,
    "servoDelay": 100,
    "savedTopDistance": 0,
    "savedPenDistance": 0,
    "drawSpeed": 500,
    "defaultDrawSpeed": 500,
}

homed = False
commands_bytes = b""

MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def parse_form(body):
    if not body:
        return {}
    try:
        return {k: v[0] for k, v in parse_qs(body.decode("utf-8")).items()}
    except UnicodeDecodeError:
        return {}


def bool_param(params, key, default=False):
    v = params.get(key)
    if v is None:
        return default
    return v.lower() in ("1", "true", "yes", "on")


def set_phase(phase):
    state["phase"] = phase


def set_top_distance(d):
    state["topDistance"] = d
    state["safeWidth"] = d * 0.6
    state["homeX"] = (d * 0.6) / 2
    state["savedTopDistance"] = d


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write("[dev] {}\n".format(format % args))

    def _send(self, body, status=200, content_type="text/plain", extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_state(self):
        self._send(json.dumps(state), content_type="application/json")

    def _send_404(self):
        self._send("", status=404)

    def _serve_file(self, relpath):
        path = os.path.normpath(os.path.join(WWW_DIR, relpath))
        if not path.startswith(WWW_DIR):
            self._send_404()
            return
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if not os.path.exists(path):
            self._send_404()
            return
        ext = os.path.splitext(path)[1].lower()
        mime = MIME_TYPES.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        self._send(data, content_type=mime, extra_headers={"Cache-Control": "no-cache"})

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/getState":
            self._send_state()
            return
        if path == "/debug":
            self._send(
                json.dumps({"freeHeap": 150000, "uptime": 12345, "wifiRSSI": -50}),
                content_type="application/json",
            )
            return
        if path == "/downloadCommands":
            # Commands are stored gzipped (as uploaded); return with gzip header
            # so the browser auto-decompresses just like on the real device.
            self._send(
                commands_bytes,
                content_type="text/plain",
                extra_headers={"Content-Encoding": "gzip"},
            )
            return

        relpath = path.lstrip("/") or "index.html"
        self._serve_file(relpath)

    def do_POST(self):
        global homed, commands_bytes
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length > 0 else b""
        params = parse_form(body)

        if path == "/setTopDistance":
            set_top_distance(float(params.get("topDistance", 0)))
            self._send_state()
        elif path == "/setPhase":
            p = params.get("phase", "")
            if p in ("SetTopDistance", "SvgSelect", "RetractBelts",
                     "ExtendToHome", "PenCalibration", "BeginDrawing"):
                set_phase(p)
                self._send_state()
            else:
                self._send_404()
        elif path == "/extendToHome":
            homed = True
            set_phase("PenCalibration")
            self._send_state()
        elif path == "/setServo":
            self._send_state()
        elif path == "/setPenDistance":
            state["savedPenDistance"] = float(params.get("penDistance", 0))
            self._send_state()
        elif path == "/estepsCalibration":
            self._send_state()
        elif path == "/doneWithPhase":
            self._send_state()
        elif path == "/command":
            self._send_state()
        elif path == "/run":
            self._send_state()
        elif path == "/resume":
            self._send_state()
        elif path == "/setPenLift":
            state["penLiftAmount"] = int(float(params.get("amount", 10)))
            self._send_state()
        elif path == "/setDrawSpeed":
            state["drawSpeed"] = int(float(params.get("speed", 500)))
            self._send_state()
        elif path == "/setServoDelay":
            state["servoDelay"] = int(float(params.get("delay", 100)))
            self._send_state()
        elif path == "/setServoInversion":
            state["servoInverted"] = bool_param(params, "inverted")
            self._send_state()
        elif path == "/setMotorInversion":
            if "left" in params:
                state["leftMotorInverted"] = bool_param(params, "left")
            if "right" in params:
                state["rightMotorInverted"] = bool_param(params, "right")
            self._send_state()
        elif path in ("/uploadCommandsRaw", "/uploadCommands"):
            commands_bytes = body
            sys.stderr.write("[dev] stored {} bytes of gzipped commands\n".format(len(body)))
            set_phase("PenCalibration" if homed else "RetractBelts")
            self._send_state()
        else:
            self._send_404()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = HTTPServer(("", port), Handler)
    print("Mural dev server listening on http://localhost:{}/".format(port))
    print("Serving {}/".format(WWW_DIR))
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
