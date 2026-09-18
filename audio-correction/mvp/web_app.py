#!/usr/bin/env python3
"""Local manager workstation for iterative acoustic matching."""

from __future__ import annotations

import argparse
import cgi
import io
import json
import mimetypes
import shutil
import tempfile
import threading
import uuid
import zipfile
from dataclasses import asdict
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from acoustic_matcher import (
    ProcessingOptions,
    SUPPORTED_EXTENSIONS,
    analyze_file,
    process_one,
    recommend_settings,
)


MAX_UPLOAD_BYTES = 500 * 1024 * 1024
STATIC_DIR = Path(__file__).resolve().parent / "static"
SESSIONS: dict[str, dict] = {}
SESSIONS_LOCK = threading.RLock()


def safe_name(name: str, fallback: str) -> str:
    cleaned = Path(name or fallback).name.replace("\x00", "").strip()
    return cleaned[:180] or fallback


def session_for(handler: BaseHTTPRequestHandler) -> tuple[str, dict, bool]:
    jar = cookies.SimpleCookie(handler.headers.get("Cookie", ""))
    sid = jar.get("acoustic_session")
    session_id = sid.value if sid and len(sid.value) == 32 else uuid.uuid4().hex
    created = False
    with SESSIONS_LOCK:
        if session_id not in SESSIONS:
            root = Path(tempfile.mkdtemp(prefix="acoustic_manager_"))
            SESSIONS[session_id] = {
                "root": root,
                "reference": None,
                "reference_profile": None,
                "reference_metrics": None,
                "targets": {},
            }
            created = True
        session = SESSIONS[session_id]
    return session_id, session, created


def public_target(item: dict) -> dict:
    return {
        "id": item["id"],
        "filename": item["filename"],
        "status": item["status"],
        "version": item["version"],
        "metrics": item["metrics"],
        "recommendation": item["recommendation"],
        "original_url": f"/audio?kind=original&id={item['id']}",
        "processed_url": (
            f"/audio?kind=processed&id={item['id']}&v={item['version']}"
            if item.get("processed_path") else None
        ),
        "processed_metrics": item.get("processed_metrics"),
        "last_result": item.get("last_result"),
        "last_settings": item.get("last_settings"),
    }


def public_state(session: dict) -> dict:
    reference = None
    if session["reference"]:
        reference = {
            "filename": session["reference"].name,
            "metrics": session["reference_metrics"],
            "audio_url": "/audio?kind=reference",
        }
    return {
        "reference": reference,
        "targets": [public_target(item) for item in session["targets"].values()],
    }


def parse_multipart(handler: BaseHTTPRequestHandler) -> cgi.FieldStorage:
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if length <= 0 or length > MAX_UPLOAD_BYTES:
        raise ValueError("Размер загрузки должен быть от 1 байта до 500 МБ")
    return cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": handler.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(length),
        },
    )


def clamp(value: object, low: float, high: float, default: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


def options_from_json(data: dict, reference_profile: dict) -> ProcessingOptions:
    ref = reference_profile["loudness"]
    return ProcessingOptions(
        dereverb_strength=clamp(data.get("dereverb_strength"), 0.0, 0.85, 0.0),
        denoise_strength=clamp(data.get("denoise_strength"), 0.0, 1.0, 0.0),
        eq_strength=clamp(data.get("eq_strength"), 0.0, 1.0, 0.30),
        dynamics_strength=clamp(data.get("dynamics_strength"), 0.0, 1.0, 0.25),
        room_strength=clamp(data.get("room_strength"), 0.0, 1.0, 0.0),
        early_reflection_strength=clamp(
            data.get("early_reflection_strength"), 0.0, 1.0, 0.0
        ),
        room_decay_scale=clamp(data.get("room_decay_scale"), 0.5, 1.8, 1.0),
        room_pre_delay_ms=clamp(data.get("room_pre_delay_ms"), 0.0, 120.0, 18.0),
        room_damping=clamp(data.get("room_damping"), 0.0, 1.0, 0.55),
        noise_strength=clamp(data.get("noise_strength"), 0.0, 1.0, 0.0),
        max_eq_db=clamp(data.get("max_eq_db"), 0.5, 12.0, 3.0),
        low_tone_db=clamp(data.get("low_tone_db"), -9.0, 9.0, 0.0),
        presence_db=clamp(data.get("presence_db"), -9.0, 9.0, 0.0),
        high_tone_db=clamp(data.get("high_tone_db"), -9.0, 9.0, 0.0),
        target_lufs=clamp(data.get("target_lufs"), -40.0, -8.0, ref["integrated_lufs"]),
        target_lra_lu=clamp(data.get("target_lra_lu"), 1.0, 18.0, ref["loudness_range_lu"]),
        target_true_peak_dbfs=clamp(
            data.get("target_true_peak_dbfs"), -9.0, -1.0, min(ref["true_peak_dbfs"], -1.0)
        ),
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "AcousticManager/0.2"

    def _session(self) -> tuple[str, dict]:
        sid, session, created = session_for(self)
        self._session_id = sid
        self._new_session = created
        return sid, session

    def _headers(self, status: int, content_type: str, length: int | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "_new_session", False):
            self.send_header(
                "Set-Cookie",
                f"acoustic_session={self._session_id}; Path=/; HttpOnly; SameSite=Lax",
            )
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.end_headers()

    def send_json(self, data: dict, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(payload))
        self.wfile.write(payload)

    def send_error_json(self, error: Exception | str, status: int = 400) -> None:
        self.send_json({"error": str(error)}, status)

    def do_GET(self) -> None:
        _, session = self._session()
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/":
                payload = (STATIC_DIR / "index.html").read_bytes()
                self._headers(200, "text/html; charset=utf-8", len(payload))
                self.wfile.write(payload)
            elif parsed.path == "/api/state":
                self.send_json(public_state(session))
            elif parsed.path == "/audio":
                self.send_audio(session, parse_qs(parsed.query))
            elif parsed.path == "/api/export":
                self.send_export(session, parse_qs(parsed.query))
            else:
                self.send_error_json("Не найдено", 404)
        except Exception as error:
            self.send_error_json(error, 500)

    def do_POST(self) -> None:
        _, session = self._session()
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/reference":
                self.upload_reference(session)
            elif parsed.path == "/api/targets":
                self.upload_targets(session)
            elif parsed.path == "/api/process":
                self.process_targets(session)
            else:
                self.send_error_json("Не найдено", 404)
        except Exception as error:
            self.send_error_json(f"{type(error).__name__}: {error}", 500)

    def upload_reference(self, session: dict) -> None:
        form = parse_multipart(self)
        if "reference" not in form:
            raise ValueError("Не передан файл-образец")
        item = form["reference"]
        filename = safe_name(item.filename, "reference.wav")
        if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("Неподдерживаемый формат аудио")
        reference_dir = session["root"] / "reference"
        reference_dir.mkdir(parents=True, exist_ok=True)
        reference = reference_dir / filename
        with reference.open("wb") as stream:
            shutil.copyfileobj(item.file, stream)
        profile, metrics = analyze_file(reference)
        session["reference"] = reference
        session["reference_profile"] = profile
        session["reference_metrics"] = metrics
        session["targets"] = {}
        self.send_json(public_state(session))

    def upload_targets(self, session: dict) -> None:
        if not session["reference"]:
            raise ValueError("Сначала загрузите образец")
        form = parse_multipart(self)
        if "targets" not in form:
            raise ValueError("Не переданы рабочие файлы")
        items = form["targets"]
        if not isinstance(items, list):
            items = [items]
        target_dir = session["root"] / "targets"
        target_dir.mkdir(parents=True, exist_ok=True)
        for upload in items:
            filename = safe_name(upload.filename, "target.wav")
            if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            item_id = uuid.uuid4().hex[:12]
            path = target_dir / f"{item_id}_{filename}"
            with path.open("wb") as stream:
                shutil.copyfileobj(upload.file, stream)
            _, metrics = analyze_file(path, session["reference_profile"])
            session["targets"][item_id] = {
                "id": item_id,
                "filename": filename,
                "path": path,
                "metrics": metrics,
                "recommendation": recommend_settings(session["reference_profile"], metrics),
                "status": "Не обработан",
                "version": 0,
                "processed_path": None,
                "processed_metrics": None,
                "last_result": None,
            }
        self.send_json(public_state(session))

    def process_targets(self, session: dict) -> None:
        if not session["reference"]:
            raise ValueError("Сначала загрузите образец")
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 1024 * 1024:
            raise ValueError("Некорректный запрос")
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        ids = data.get("ids") or []
        if not ids:
            raise ValueError("Выберите хотя бы один рабочий файл")
        options = options_from_json(data.get("settings") or {}, session["reference_profile"])
        output_dir = session["root"] / "processed"
        output_dir.mkdir(parents=True, exist_ok=True)
        for item_id in ids:
            item = session["targets"].get(str(item_id))
            if not item:
                continue
            version = int(item["version"]) + 1
            output = output_dir / f"{item_id}_v{version}.wav"
            result = process_one(
                session["reference"], item["path"], output,
                session["reference_profile"], options,
            )
            _, processed_metrics = analyze_file(output, session["reference_profile"])
            item.update({
                "status": f"Обработан · версия {version}",
                "version": version,
                "processed_path": output,
                "processed_metrics": processed_metrics,
                "last_result": result,
                "last_settings": asdict(options),
            })
        self.send_json(public_state(session))

    def send_audio(self, session: dict, query: dict) -> None:
        kind = (query.get("kind") or [""])[0]
        if kind == "reference":
            path = session.get("reference")
        else:
            item_id = (query.get("id") or [""])[0]
            item = session["targets"].get(item_id)
            path = None if not item else item.get("path" if kind == "original" else "processed_path")
        if not path or not Path(path).exists():
            self.send_error_json("Аудиофайл не найден", 404)
            return
        payload = Path(path).read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "audio/wav"
        self._headers(200, content_type, len(payload))
        self.wfile.write(payload)

    def send_export(self, session: dict, query: dict) -> None:
        raw_ids = (query.get("ids") or [""])[0]
        requested = set(filter(None, raw_ids.split(",")))
        selected = [
            item for item_id, item in session["targets"].items()
            if item.get("processed_path") and (not requested or item_id in requested)
        ]
        if not selected:
            self.send_error_json("Нет обработанных файлов для скачивания", 400)
            return
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipper:
            for item in selected:
                arcname = f"matched_{Path(item['filename']).stem}.wav"
                zipper.write(item["processed_path"], arcname)
        payload = archive.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", 'attachment; filename="acoustic-matched.zip"')
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({"url": f"http://{args.host}:{args.port}"}, ensure_ascii=False))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
