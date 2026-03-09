#!/usr/bin/env python3
import argparse
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import boxlite


def parse_memory_mib(raw):
    if not raw:
        return None
    text = str(raw).strip().lower()
    if text.endswith("mi"):
        text = text[:-2]
    try:
        return int(text)
    except ValueError:
        return None


class BoxLiteBridge:
    def __init__(self, runtime_home: str, state_dir: str):
        self.runtime_home = runtime_home
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.names_path = self.state_dir / "box-names.json"
        self.lock = threading.Lock()

    def runtime(self):
        return boxlite.Boxlite(boxlite.Options(home_dir=self.runtime_home))

    def load_names(self):
        with self.lock:
            if not self.names_path.exists():
                return {}
            try:
                return json.loads(self.names_path.read_text(encoding="utf-8"))
            except Exception:
                return {}

    def save_names(self, mapping):
        with self.lock:
            self.names_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")

    async def get_box(self, identifier: str):
        mapping = self.load_names()
        box_id = mapping.get(identifier, identifier)
        try:
            box = self.runtime().get(box_id)
            name = next((n for n, value in mapping.items() if value == box_id), identifier)
            return {"id": box_id, "name": name}, box
        except Exception:
            if identifier in mapping:
                mapping.pop(identifier, None)
                self.save_names(mapping)
            return None, None

    async def list_boxes(self):
        mapping = self.load_names()
        return [{"id": box_id, "name": name} for name, box_id in mapping.items()]

    async def create_box(self, payload):
        name = payload.get("name") or "deeting-box"
        existing, _ = await self.get_box(name)
        if existing:
            return existing

        options = boxlite.BoxOptions(
            image=payload.get("image") or "python:3.11-slim",
            cpus=int(payload.get("cpu")) if payload.get("cpu") else None,
            memory_mib=parse_memory_mib(payload.get("memory")),
            working_dir=payload.get("cwd") or "/workspace",
            auto_remove=False,
        )
        box = self.runtime().create(options)
        mapping = self.load_names()
        mapping[name] = box.id
        self.save_names(mapping)
        return {"id": box.id, "name": name}

    async def stop_box(self, identifier: str):
        meta, box = await self.get_box(identifier)
        if not box:
            return False
        try:
            await box.stop()
        except Exception:
            pass
        return bool(meta)

    async def exec_sync(self, identifier: str, payload):
        _, box = await self.get_box(identifier)
        if not box:
            raise KeyError(identifier)
        cmd = payload.get("cmd") or []
        if not cmd:
            raise ValueError("missing command")
        execution = await box.exec(*cmd)
        timeout_ms = payload.get("timeout_ms")
        timeout = (float(timeout_ms) / 1000.0) if timeout_ms else None
        try:
            result = await asyncio.wait_for(execution.wait(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            try:
                await execution.kill()
            except Exception:
                pass
            raise TimeoutError("execution timed out") from exc
        return {
            "stdout": getattr(result, "stdout", "") or "",
            "stderr": getattr(result, "stderr", "") or "",
            "exit_code": int(getattr(result, "exit_code", -1)),
            "error": None,
        }


def make_handler(bridge: BoxLiteBridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return

        def send_json(self, status: int, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def parse_json(self):
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8")) if raw else {}

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/v1/boxes":
                self.send_json(200, asyncio.run(bridge.list_boxes()))
                return
            if path.startswith("/v1/boxes/"):
                identifier = unquote(path.removeprefix("/v1/boxes/"))
                meta, _ = asyncio.run(bridge.get_box(identifier))
                self.send_json(200 if meta else 404, meta or {"error": "not found"})
                return
            self.send_json(404, {"error": "not found"})

        def do_POST(self):
            path = urlparse(self.path).path
            payload = self.parse_json()
            try:
                if path == "/v1/boxes":
                    self.send_json(200, asyncio.run(bridge.create_box(payload)))
                    return
                if path.endswith(":stop") and path.startswith("/v1/boxes/"):
                    identifier = unquote(path[len("/v1/boxes/") : -len(":stop")])
                    stopped = asyncio.run(bridge.stop_box(identifier))
                    self.send_json(200 if stopped else 404, {"ok": stopped})
                    return
                if path.endswith("/exec-sync") and path.startswith("/v1/boxes/"):
                    identifier = unquote(path[len("/v1/boxes/") : -len("/exec-sync")])
                    self.send_json(200, asyncio.run(bridge.exec_sync(identifier, payload)))
                    return
            except KeyError:
                self.send_json(404, {"error": "not found"})
                return
            except TimeoutError as exc:
                self.send_json(408, {"error": str(exc)})
                return
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
                return
            self.send_json(404, {"error": "not found"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Deeting BoxLite bridge")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--runtime-home", required=True)
    parser.add_argument("--state-dir", required=True)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(BoxLiteBridge(args.runtime_home, args.state_dir)))
    server.serve_forever()


if __name__ == "__main__":
    main()