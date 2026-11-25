#!/usr/bin/env python3
"""Mart Studio — laboratorio multimodal sobre la API de MartLLM.

Imagen, video, música/SFX, voz, transcripción y chat contra los ~800 modelos de
MartLLM, con biblioteca local, cotización previa (gratis) y registro de gasto.

Servidor local (stdlib) + UI en ui.html/app.js. Dependencias: Pillow (viaja en
python/). ffmpeg es opcional: si está, hace miniaturas de video y ondas de audio.

    python studio.py            # abre http://127.0.0.1:8775
    python studio.py --no-open
"""
from __future__ import annotations

import base64
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from PIL import Image

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UP = DATA / "uploads"
OUT = DATA / "out"
TH = DATA / "thumbs"
STORE = DATA / "store.json"
LEDGER = DATA / "ledger.json"
BALANCES = DATA / "balance.json"
CATALOG = DATA / "catalog.json"
SETTINGS = DATA / "settings.json"
BUILT = ROOT / "mart-studio.html"

for d in (DATA, UP, OUT, TH):
    d.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("MART_PORT", "8775"))
# 0.0.0.0 = accesible desde la LAN y Tailscale (detrás del login). MART_HOST=127.0.0.1 lo deja local.
HOST = os.environ.get("MART_HOST", "0.0.0.0")
ENV_FILE = Path(os.environ.get("MART_ENV", str(Path.home() / "Desktop" / ".env")))


# ------------------------------------------------------------------ .env
def read_env(path: Path) -> dict:
    """`clave = valor` o `clave=valor`; claves en minúscula. Ignora comentarios."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip().strip("\"'").lower()] = v.strip().strip("\"'")
    return out


def _pick(envs: list[dict], *names: str) -> str:
    for env in envs:
        for n in names:
            if env.get(n):
                return env[n]
    return ""


# el .env de la carpeta gana sobre el del Escritorio
_ENVS = [read_env(ROOT / ".env"), read_env(ENV_FILE)]
API_KEY = os.environ.get("MARTLLM_API_KEY") or _pick(_ENVS, "martllm_api_key", "martllm-key", "martllm_key")
API_BASE = (os.environ.get("MARTLLM_BASE_URL") or _pick(_ENVS, "martllm_base_url", "martllm-base-url")
            or "https://api.martllm.com/v1").rstrip("/")
AUTH_USER = _pick(_ENVS, "user")
AUTH_PASS = _pick(_ENVS, "pass", "password")

FFMPEG = os.environ.get("MART_FFMPEG") or shutil.which("ffmpeg") or ""
FFPROBE = (str(Path(FFMPEG).with_name("ffprobe" + Path(FFMPEG).suffix)) if FFMPEG else "") or shutil.which("ffprobe") or ""
if FFPROBE and not Path(FFPROBE).exists():
    FFPROBE = shutil.which("ffprobe") or ""

# Tipos de trabajo → ruta de la API
ROUTES = {
    "image": "/images/generations",
    "edit": "/images/edits",
    "video": "/video/generations",
    "music": "/music/generations",
    "speech": "/audio/speech",
    "transcribe": "/audio/transcriptions",
    "chat": "/chat/completions",
}
ASYNC_KINDS = {"video", "music"}
MEDIA_OF = {"image": "image", "edit": "image", "video": "video", "music": "audio", "speech": "audio",
            "transcribe": "text", "chat": "text"}
MAX_INFLIGHT = int(os.environ.get("MART_INFLIGHT", "4"))
SEM = threading.Semaphore(MAX_INFLIGHT)
UA = "mart-studio/1.0"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def slug(text: str, n: int = 34) -> str:
    import unicodedata
    base = unicodedata.normalize("NFKD", text or "pieza").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", base.lower()).strip("-")
    return (s[:n] or "pieza").strip("-")


def rel(p: Path) -> str:
    return p.resolve().relative_to(ROOT).as_posix()


def safe_rel(p: str) -> Path | None:
    try:
        target = (ROOT / unquote(p)).resolve()
        target.relative_to(DATA.resolve())
        return target if target.is_file() else None
    except Exception:
        return None


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


# ------------------------------------------------------------- cliente API
class MartError(RuntimeError):
    def __init__(self, msg: str, status: int = 0, code: str = ""):
        super().__init__(msg)
        self.status = status
        self.code = code


def _err_msg(raw: bytes, status: int) -> tuple[str, str]:
    try:
        e = json.loads(raw.decode("utf-8", "ignore")).get("error") or {}
        if isinstance(e, str):
            return e, ""
        return (e.get("message") or f"HTTP {status}"), (e.get("code") or e.get("type") or "")
    except Exception:
        txt = raw.decode("utf-8", "ignore").strip()[:300]
        return (txt or f"HTTP {status}"), ""


def mart(method: str, path: str, body=None, *, raw: bool = False, timeout: int = 180,
         data: bytes | None = None, ctype: str = "application/json") -> tuple[int, dict, object]:
    """Llama a la API. Devuelve (status, headers, json|bytes). Lanza MartError en 4xx/5xx."""
    if not API_KEY:
        raise MartError("No hay API key de MartLLM (martllm-key en el .env).", 401, "no_key")
    url = path if path.startswith("http") else API_BASE + path
    if data is None and body is not None:
        data = json.dumps(body).encode("utf-8")
    headers = {"Authorization": "Bearer " + API_KEY, "User-Agent": UA}
    if data is not None:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            if raw:
                return resp.status, hdrs, payload
            try:
                return resp.status, hdrs, json.loads(payload or b"{}")
            except ValueError:
                return resp.status, hdrs, payload
    except urllib.error.HTTPError as e:
        msg, code = _err_msg(e.read(), e.code)
        raise MartError(msg, e.code, code) from None
    except urllib.error.URLError as e:
        raise MartError(f"Sin conexión con MartLLM: {e.reason}", 0, "network") from None
    except TimeoutError:
        raise MartError("MartLLM tardó demasiado en responder.", 0, "timeout") from None


def multipart(fields: dict, files: dict) -> tuple[bytes, str]:
    boundary = "----mart" + uuid.uuid4().hex
    buf = io.BytesIO()
    for k, v in fields.items():
        if v is None or v == "":
            continue
        buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, (name, blob, ct) in files.items():
        buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{name}\"\r\n"
                  f"Content-Type: {ct}\r\n\r\n".encode())
        buf.write(blob)
        buf.write(b"\r\n")
    buf.write(f"--{boundary}--\r\n".encode())
    return buf.getvalue(), "multipart/form-data; boundary=" + boundary


def cost_of(hdrs: dict, body) -> float | None:
    if isinstance(body, dict):
        u = body.get("usage") or {}
        if isinstance(u, dict) and isinstance(u.get("cost_usd"), (int, float)):
            return float(u["cost_usd"])
    v = hdrs.get("x-uberllm-cost-usd") or hdrs.get("x-martllm-cost-usd")
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


# ----------------------------------------------------------------- saldo
BAL_LOCK = threading.Lock()
BAL_CACHE = {"at": 0.0, "data": None}


def balance(force: bool = False) -> dict:
    with BAL_LOCK:
        if not force and BAL_CACHE["data"] and time.time() - BAL_CACHE["at"] < 20:
            return BAL_CACHE["data"]
    _, _, b = mart("GET", "/balance", timeout=20)
    data = {"balance": b.get("balance_usd"), "held": b.get("held_usd", 0), "available": b.get("available_usd"),
            "saved_24h": b.get("saved_24h_usd"), "at": now_iso()}
    with BAL_LOCK:
        BAL_CACHE.update(at=time.time(), data=data)
        snaps = read_json(BALANCES, [])
        last = snaps[-1] if snaps else None
        # una foto por cambio de saldo (o una por hora si no cambia): sirve para ver recargas
        stale = not last or (time.time() - datetime.fromisoformat(last["at"]).timestamp()) > 3600
        if not last or abs((last.get("balance") or 0) - (data["balance"] or 0)) > 1e-6 or stale:
            snaps.append({"at": data["at"], "balance": data["balance"]})
            write_json(BALANCES, snaps[-5000:])
    return data


# --------------------------------------------------------------- ledger
LEDGER_LOCK = threading.Lock()


def ledger_add(entry: dict) -> dict:
    entry = {"id": "c_" + uuid.uuid4().hex[:10], "at": now_iso(), **entry}
    with LEDGER_LOCK:
        rows = read_json(LEDGER, [])
        rows.append(entry)
        write_json(LEDGER, rows)
    return entry


def ledger_patch(cid: str, **changes) -> None:
    with LEDGER_LOCK:
        rows = read_json(LEDGER, [])
        for r in rows:
            if r.get("id") == cid:
                r.update(changes)
                break
        write_json(LEDGER, rows)


# -------------------------------------------------------------- ajustes
DEFAULT_SETTINGS = {"max_cost": 1.0, "nsfw": False}


def settings() -> dict:
    return {**DEFAULT_SETTINGS, **read_json(SETTINGS, {})}


# --------------------------------------------------------------- catálogo
CAT_LOCK = threading.Lock()
CAT_TTL = 6 * 3600
MODEL_CACHE: dict[str, tuple[float, dict]] = {}


def _slim(m: dict) -> dict:
    p = m.get("pricing") or {}
    t = m.get("type")
    if t == "chat":
        price = {"unit": "1M tokens", "in": p.get("input_usd"), "out": p.get("output_usd"),
                 "list_in": p.get("list_input_usd"), "list_out": p.get("list_output_usd"),
                 "cache_read": p.get("cache_read_usd"), "basis": p.get("price_basis")}
    elif p:
        price = {"unit": p.get("unit"), "usd": p.get("usd", p.get("list_usd")), "list": p.get("list_usd"),
                 "res": [{"r": r.get("resolution"), "usd": r.get("usd", r.get("list_usd")), "s": r.get("seconds")}
                         for r in (p.get("resolutions") or [])]}
    else:
        price = None
    return {
        "id": m.get("id"), "name": m.get("display_name") or m.get("id"), "type": t,
        "owner": m.get("owned_by") or "", "endpoints": m.get("endpoints") or [],
        "in": m.get("input_modalities") or [], "out": m.get("output_modalities") or [],
        "nsfw": bool(m.get("nsfw")), "available": m.get("available", True), "created": m.get("created"),
        "ctx": m.get("context_length"), "max_out": m.get("max_output_tokens"),
        "vision": bool(m.get("supports_vision")), "reasoning": bool(m.get("supports_reasoning")),
        "alias": m.get("also_callable_as") or [], "price": price,
    }


def catalog(force: bool = False) -> dict:
    with CAT_LOCK:
        cur = read_json(CATALOG, None)
        if cur and not force and time.time() - cur.get("ts", 0) < CAT_TTL:
            return cur
        try:
            _, _, body = mart("GET", "/models?type=all", timeout=60)
            models = [_slim(m) for m in body.get("data", [])]
            picks = {}
            try:
                req = urllib.request.Request(API_BASE.rsplit("/v1", 1)[0] + "/api/v1/public/frontier",
                                             headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=20) as r:
                    picks = json.loads(r.read()).get("slots", {})
            except Exception:
                picks = (cur or {}).get("picks", {})
            cur = {"ts": time.time(), "at": now_iso(), "models": models, "picks": picks}
            write_json(CATALOG, cur)
        except MartError:
            if cur:  # sin red: sirve el último catálogo
                cur["stale"] = True
                return cur
            raise
        return cur


def model_detail(mid: str) -> dict:
    hit = MODEL_CACHE.get(mid)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    _, _, body = mart("GET", "/models/" + quote(mid, safe="/"), timeout=30)
    if not isinstance(body, dict):
        raise MartError("Respuesta rara del catálogo.")
    out = {**_slim(body), "parameters": body.get("parameters") or {}, "pricing": body.get("pricing") or {}}
    MODEL_CACHE[mid] = (time.time(), out)
    return out


# ------------------------------------------------------------- biblioteca
STORE_LOCK = threading.Lock()


def load_store() -> dict:
    d = read_json(STORE, None) or {"version": 1, "assets": [], "prompts": []}
    d.setdefault("assets", [])
    d.setdefault("prompts", [])
    return d


def save_store(d: dict) -> None:
    write_json(STORE, d)


def sniff_ext(blob: bytes, ctype: str = "") -> str:
    h = blob[:16]
    if h.startswith(b"\x89PNG"):
        return ".png"
    if h[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if h[:4] == b"RIFF" and h[8:12] == b"WEBP":
        return ".webp"
    if h[:4] == b"RIFF" and h[8:12] == b"WAVE":
        return ".wav"
    if h[:4] == b"GIF8":
        return ".gif"
    if h[:3] == b"ID3" or h[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return ".mp3"
    if h[:4] == b"OggS":
        return ".ogg"
    if h[:4] == b"fLaC":
        return ".flac"
    if h[4:8] == b"ftyp":
        brand = h[8:12]
        if brand in (b"M4A ", b"M4B "):
            return ".m4a"
        return ".mp4"
    if h[:4] == b"\x1aE\xdf\xa3":
        return ".webm"
    ext = mimetypes.guess_extension((ctype or "").split(";")[0].strip()) or ""
    return {".jpe": ".jpg", ".mpga": ".mp3"}.get(ext, ext or ".bin")


def media_of_ext(ext: str) -> str:
    ext = ext.lower()
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"):
        return "image"
    if ext in (".mp4", ".webm", ".mov", ".mkv"):
        return "video"
    if ext in (".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"):
        return "audio"
    return "text"


def probe(path: Path) -> dict:
    """Duración y medidas con ffprobe; WAV se lee sin ffprobe."""
    info: dict = {}
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path)) as w:
                info["duration"] = round(w.getnframes() / float(w.getframerate()), 2)
        except Exception:
            pass
    if FFPROBE and "duration" not in info:
        try:
            out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration:stream=width,height",
                                  "-of", "json", str(path)], capture_output=True, text=True, timeout=20,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            j = json.loads(out.stdout or "{}")
            dur = (j.get("format") or {}).get("duration")
            if dur:
                info["duration"] = round(float(dur), 2)
            for s in j.get("streams") or []:
                if s.get("width"):
                    info["w"], info["h"] = s["width"], s["height"]
                    break
        except Exception:
            pass
    return info


def make_thumb(path: Path, media: str) -> Path | None:
    stem = path.stem
    try:
        if media == "image":
            im = Image.open(path)
            alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
            im.thumbnail((560, 560), Image.Resampling.LANCZOS)
            out = TH / (stem + (".png" if alpha else ".jpg"))
            if alpha:
                im.save(out, "PNG")
            else:
                im.convert("RGB").save(out, "JPEG", quality=86)
            return out
        if not FFMPEG:
            return None
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if media == "video":
            out = TH / (stem + ".jpg")
            for ss in ("0.6", "0"):
                subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", ss, "-i", str(path), "-frames:v", "1",
                                "-vf", "scale=560:-2", str(out)], capture_output=True, timeout=60, creationflags=flags)
                if out.exists() and out.stat().st_size:
                    return out
            return None
        if media == "audio":
            out = TH / (stem + "-wave.png")
            subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(path), "-filter_complex",
                            "aformat=channel_layouts=mono,showwavespic=s=900x220:colors=#F4F1EA:scale=sqrt",
                            "-frames:v", "1", str(out)], capture_output=True, timeout=60, creationflags=flags)
            return out if out.exists() and out.stat().st_size else None
    except Exception:
        return None
    return None


def add_asset(path: Path, *, media: str, origin: str, prompt: str = "", model: str = "", params: dict | None = None,
              refs: list[str] | None = None, cost: float | None = None, meta: dict | None = None,
              job: str = "", text: str = "") -> dict:
    info = dict(meta or {})
    if media == "image":
        try:
            with Image.open(path) as im:
                info["w"], info["h"] = im.width, im.height
                info["alpha"] = im.mode in ("RGBA", "LA")
        except Exception:
            pass
    elif media in ("video", "audio") and not info.get("duration"):
        info = {**probe(path), **info}
    th = make_thumb(path, media)
    asset = {
        "id": "a_" + uuid.uuid4().hex[:10],
        "media": media, "origin": origin, "name": path.stem,
        "file": rel(path), "thumb": rel(th) if th else "",
        "bytes": path.stat().st_size, "created": now_iso(),
        "prompt": prompt, "model": model, "params": params or {}, "refs": list(refs or []),
        "cost": cost, "job": job, **{k: v for k, v in info.items() if v is not None},
    }
    if text:
        asset["text"] = text[:4000]
    with STORE_LOCK:
        store = load_store()
        store["assets"].insert(0, asset)
        save_store(store)
    return asset


def update_asset(aid: str, **changes) -> None:
    with STORE_LOCK:
        store = load_store()
        for a in store["assets"]:
            if a["id"] == aid:
                a.update(changes)
                break
        save_store(store)


def public(a: dict) -> dict:
    out = dict(a)
    out["url"] = "/media/" + a["file"]
    out["thumb_url"] = ("/media/" + a["thumb"]) if a.get("thumb") else ""
    return out


def find_asset(aid: str) -> dict | None:
    for a in load_store()["assets"]:
        if a["id"] == aid:
            return a
    return None


DATAURI_CACHE: dict[str, str] = {}


def image_datauri(a: dict) -> str:
    """Las referencias viajan como data: URI, reducidas a 2048 px de lado mayor."""
    if a["id"] in DATAURI_CACHE:
        return DATAURI_CACHE[a["id"]]
    if a.get("media") != "image":
        raise ValueError(f"«{a.get('name')}» no es una imagen.")
    with Image.open(ROOT / a["file"]) as im:
        im.load()
        alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if alpha else "RGB")
        im.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        if alpha:
            im.save(buf, "PNG", optimize=True)
            mime = "image/png"
        else:
            im.save(buf, "JPEG", quality=90)
            mime = "image/jpeg"
    uri = f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()
    if len(DATAURI_CACHE) > 24:
        DATAURI_CACHE.pop(next(iter(DATAURI_CACHE)))
    DATAURI_CACHE[a["id"]] = uri
    return uri


def to_trash(paths: list[Path]) -> str:
    """Papelera de Windows (recuperable). Si falla, data/papelera/. Nunca borra en duro."""
    files = [p.resolve() for p in paths if p.exists()]
    if not files:
        return "papelera"
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class SHFILEOPSTRUCTW(ctypes.Structure):
                _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT),
                            ("pFrom", ctypes.c_void_p), ("pTo", ctypes.c_void_p),
                            ("fFlags", ctypes.c_uint16), ("fAnyOperationsAborted", wintypes.BOOL),
                            ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", ctypes.c_void_p)]

            buf = ctypes.create_unicode_buffer("\0".join(str(p) for p in files) + "\0\0")
            op = SHFILEOPSTRUCTW()
            op.wFunc = 3  # FO_DELETE
            op.pFrom = ctypes.cast(buf, ctypes.c_void_p)
            op.fFlags = 0x40 | 0x10 | 0x4 | 0x400  # ALLOWUNDO | NOCONFIRMATION | SILENT | NOERRORUI
            rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
            if rc == 0 and not op.fAnyOperationsAborted and not any(p.exists() for p in files):
                return "papelera"
        except Exception:
            pass
    trash = DATA / "papelera"
    trash.mkdir(parents=True, exist_ok=True)
    for p in files:
        dst = trash / p.name
        if dst.exists():
            dst = trash / f"{p.stem}-{uuid.uuid4().hex[:4]}{p.suffix}"
        try:
            os.replace(p, dst)
        except Exception:
            pass
    return "data/papelera"


# ------------------------------------------------------------- peticiones
SKIP_PARAMS = {"model", "prompt", "input", "image_url", "end_image_url", "input_images", "images", "image",
               "file", "response_format", "validate", "max_cost", "quote_id", "provider", "models", "metadata"}


def clean_params(params: dict) -> dict:
    out = {}
    for k, v in (params or {}).items():
        if k in SKIP_PARAMS or v is None or v == "":
            continue
        if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]{0,40}", str(k)):
            continue
        out[k] = v
    return out


def build_body(kind: str, model: str, prompt: str, params: dict, images: dict) -> dict:
    body: dict = {"model": model, **clean_params(params)}
    if kind == "speech":
        body["input"] = prompt
    elif kind != "transcribe":
        body["prompt"] = prompt
    if kind in ("image", "edit"):
        body["response_format"] = "url"
    for slot in ("image_url", "end_image_url"):
        aid = (images or {}).get(slot)
        if aid:
            a = find_asset(aid)
            if not a:
                raise ValueError("Una de las imágenes ya no está en la biblioteca.")
            body[slot] = image_datauri(a)
    ids = [x for x in ((images or {}).get("input_images") or []) if x]
    if ids:
        uris = []
        for aid in ids[:8]:
            a = find_asset(aid)
            if not a:
                raise ValueError("Una de las referencias ya no está en la biblioteca.")
            uris.append(image_datauri(a))
        body["input_images"] = uris
    if kind == "edit" and not any(k in body for k in ("image_url", "input_images")):
        raise ValueError("Editar necesita al menos una imagen.")
    return body


def quote_req(kind: str, model: str, prompt: str, params: dict, images: dict, duration: float | None = None) -> dict:
    if kind == "chat":
        raise ValueError("El chat se estima por tokens, no se cotiza.")
    if kind == "transcribe":
        _, _, q = mart("POST", "/quote", {"model": model, "duration_seconds": max(1, int(round(duration or 60)))}, timeout=30)
        return q
    body = build_body(kind, model, prompt or "x", params, images)
    body["validate"] = True
    _, _, q = mart("POST", ROUTES[kind], body, timeout=45)
    return q if isinstance(q, dict) else {}


# ------------------------------------------------------------------ jobs
JOBS: dict[str, dict] = {}
JOBS_ORDER: list[str] = []
JOBS_LOCK = threading.Lock()
TERMINAL = {"succeeded", "failed", "canceled", "expired"}


def new_job(kind: str, model: str, prompt: str, extra: dict | None = None) -> dict:
    jid = "j_" + uuid.uuid4().hex[:10]
    job = {"id": jid, "kind": kind, "media": MEDIA_OF[kind], "model": model, "prompt": prompt[:600],
           "status": "queued", "created": now_iso(), "t0": time.time(), "elapsed": 0, "progress": None,
           "remote": "", "estimate": None, "max_cost": None, "cost": None, "cost_pending": False,
           "assets": [], "error": "", "text": "", **(extra or {})}
    with JOBS_LOCK:
        JOBS[jid] = job
        JOBS_ORDER.append(jid)
        for old in JOBS_ORDER[:-200]:
            JOBS.pop(old, None)
        del JOBS_ORDER[:-200]
    return job


def job_view(j: dict) -> dict:
    out = {k: v for k, v in j.items() if k not in ("t0", "payload")}
    if j["status"] not in TERMINAL:
        out["elapsed"] = round(time.time() - j["t0"], 1)
    return out


def download(url: str, base: str, idx: int) -> tuple[Path, str]:
    if url.startswith("data:"):
        head, b64 = url.split(",", 1)
        blob, ctype = base64.b64decode(b64), head[5:].split(";")[0]
    elif url.startswith(API_BASE.rsplit("/v1", 1)[0]):
        _, h, blob = mart("GET", url, raw=True, timeout=300)
        ctype = h.get("content-type", "")
    else:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=300) as r:
            blob, ctype = r.read(), r.headers.get("Content-Type", "")
    ext = sniff_ext(blob, ctype)
    path = OUT / f"{base}{'-' + str(idx + 1) if idx else ''}{ext}"
    path.write_bytes(blob)
    return path, ctype


def _finish_cost(job: dict, cid: str, poll_path: str) -> None:
    """Los jobs async quedan con cost_pending unos segundos: se asienta acá."""
    for wait in (3, 5, 8, 12, 20, 30, 60, 120):
        time.sleep(wait)
        try:
            _, _, j = mart("GET", poll_path, timeout=30)
        except MartError:
            continue
        u = (j or {}).get("usage") or {}
        if isinstance(u.get("cost_usd"), (int, float)):
            job["cost"], job["cost_pending"] = float(u["cost_usd"]), False
            ledger_patch(cid, cost=job["cost"], pending=False)
            for aid in job["assets"]:
                update_asset(aid, cost=job["cost"])
            return


def _run(job: dict, payload: dict) -> None:
    kind, model = job["kind"], job["model"]
    base = f"{datetime.now():%Y%m%d-%H%M%S}-{slug(job['prompt'] or kind, 28)}"
    cid = ""
    with SEM:
        job["status"] = "running"
        job["started"] = now_iso()
        try:
            if kind in ASYNC_KINDS:
                _, _, r = mart("POST", ROUTES[kind], payload["body"], timeout=120)
                job["remote"] = r.get("id", "")
                job["estimate"] = r.get("estimated_cost_usd")
                job["max_cost"] = r.get("max_cost_usd")
                poll = f"{ROUTES[kind]}/{job['remote']}"
                limit = time.time() + (45 * 60 if kind == "video" else 20 * 60)
                while r.get("status") not in TERMINAL:
                    if job.get("cancel"):
                        try:
                            _, _, r = mart("DELETE", poll, timeout=30)
                        except MartError:
                            pass
                        job["cancel"] = False
                    if time.time() > limit:
                        raise MartError("Se pasó el tiempo de espera; el trabajo sigue en MartLLM.")
                    time.sleep(6)
                    try:
                        _, _, r = mart("GET", poll, timeout=30)
                    except MartError as e:
                        if e.status in (0, 429, 502, 503, 504):
                            continue
                        raise
                    job["progress"] = r.get("progress")
                    if r.get("estimated_cost_usd") is not None:
                        job["estimate"] = r.get("estimated_cost_usd")
                if r.get("status") != "succeeded":
                    err = (r.get("error") or {}).get("message") or r.get("status")
                    job["status"] = "canceled" if r.get("status") == "canceled" else "failed"
                    job["error"] = "Cancelado." if r.get("status") == "canceled" else f"MartLLM: {err}"
                    return
                u = r.get("usage") or {}
                job["cost"] = u.get("cost_usd") if isinstance(u.get("cost_usd"), (int, float)) else None
                job["cost_pending"] = job["cost"] is None
                results = r.get("results") or []
                for i, res in enumerate(results):
                    path, _ = download(res["url"], base, i)
                    meta = {"duration": res.get("duration_seconds")}
                    if res.get("width"):
                        meta.update(w=res.get("width"), h=res.get("height"))
                    a = add_asset(path, media=media_of_ext(path.suffix), origin=kind, prompt=job["prompt"], model=model,
                                  params=payload["params"], refs=payload["refs"], job=job["id"],
                                  cost=job["cost"] if i == 0 else None, meta=meta)
                    job["assets"].append(a["id"])
                if not results:
                    raise MartError("El trabajo terminó sin archivos.")
                cid = ledger_add({"kind": kind, "model": model, "cost": job["cost"] if job["cost"] is not None else job["estimate"],
                                  "pending": job["cost_pending"], "est": job["estimate"], "job": job["id"],
                                  "remote": job["remote"], "prompt": job["prompt"][:140], "status": "ok"})["id"]
                if job["cost_pending"]:
                    threading.Thread(target=_finish_cost, args=(job, cid, poll), daemon=True).start()
            elif kind in ("image", "edit"):
                _, h, r = mart("POST", ROUTES[kind], payload["body"], timeout=420)
                job["remote"] = h.get("x-request-id", "")
                job["cost"] = cost_of(h, r)
                for i, item in enumerate((r or {}).get("data") or []):
                    src = item.get("url") or ("data:image/png;base64," + item["b64_json"] if item.get("b64_json") else "")
                    if not src:
                        continue
                    path, _ = download(src, base, i)
                    a = add_asset(path, media="image", origin=kind, prompt=job["prompt"], model=model,
                                  params=payload["params"], refs=payload["refs"], job=job["id"],
                                  cost=(job["cost"] / max(1, len(r["data"]))) if job["cost"] is not None else None,
                                  meta={"revised": item.get("revised_prompt")} if item.get("revised_prompt") else None)
                    job["assets"].append(a["id"])
                if not job["assets"]:
                    raise MartError("La API respondió sin imágenes.")
                cid = ledger_add({"kind": kind, "model": model, "cost": job["cost"], "job": job["id"],
                                  "remote": job["remote"], "prompt": job["prompt"][:140], "status": "ok",
                                  "n": len(job["assets"])})["id"]
            elif kind == "speech":
                _, h, blob = mart("POST", ROUTES[kind], payload["body"], raw=True, timeout=300)
                job["remote"] = h.get("x-request-id", "")
                job["cost"] = cost_of(h, None)
                ext = sniff_ext(blob, h.get("content-type", ""))
                path = OUT / f"{base}{ext}"
                path.write_bytes(blob)
                a = add_asset(path, media="audio", origin="speech", prompt=job["prompt"], model=model,
                              params=payload["params"], job=job["id"], cost=job["cost"])
                job["assets"].append(a["id"])
                cid = ledger_add({"kind": kind, "model": model, "cost": job["cost"], "job": job["id"],
                                  "remote": job["remote"], "prompt": job["prompt"][:140], "status": "ok",
                                  "chars": len(payload["body"].get("input", ""))})["id"]
            elif kind == "transcribe":
                src = find_asset(payload["source"])
                if not src:
                    raise MartError("El audio ya no está en la biblioteca.")
                fpath = ROOT / src["file"]
                fmt = payload["params"].get("response_format") or "json"
                fields = {"model": model, "language": payload["params"].get("language"),
                          "prompt": job["prompt"] or None, "response_format": fmt}
                data, ctype = multipart(fields, {"file": (fpath.name, fpath.read_bytes(),
                                                          mimetypes.guess_type(fpath.name)[0] or "application/octet-stream")})
                _, h, r = mart("POST", ROUTES[kind], data=data, ctype=ctype, timeout=600)
                job["remote"] = h.get("x-request-id", "")
                job["cost"] = cost_of(h, r)
                if isinstance(r, dict):
                    text = r.get("text") or ""
                    if fmt == "verbose_json":
                        body_txt, ext = json.dumps(r, ensure_ascii=False, indent=1), ".json"
                    else:
                        body_txt, ext = text, ".txt"
                else:
                    text = r.decode("utf-8", "ignore") if isinstance(r, bytes) else str(r)
                    body_txt, ext = text, {"srt": ".srt", "vtt": ".vtt"}.get(fmt, ".txt")
                path = OUT / f"{base}-{slug(src['name'], 20)}{ext}"
                path.write_text(body_txt, encoding="utf-8")
                job["text"] = text[:20000]
                a = add_asset(path, media="text", origin="transcribe", prompt=job["prompt"], model=model,
                              params=payload["params"], refs=[src["id"]], job=job["id"], cost=job["cost"],
                              text=text)
                job["assets"].append(a["id"])
                cid = ledger_add({"kind": kind, "model": model, "cost": job["cost"], "job": job["id"],
                                  "remote": job["remote"], "prompt": src["name"][:140], "status": "ok"})["id"]
            elif kind == "chat":
                _, h, r = mart("POST", ROUTES[kind], payload["body"], timeout=600)
                job["remote"] = h.get("x-request-id", "")
                job["cost"] = cost_of(h, None)
                msg = ((r.get("choices") or [{}])[0].get("message") or {}) if isinstance(r, dict) else {}
                job["text"] = msg.get("content") or ""
                job["reasoning"] = msg.get("reasoning_content") or msg.get("reasoning") or ""
                job["finish"] = ((r.get("choices") or [{}])[0] or {}).get("finish_reason")
                job["usage"] = r.get("usage") or {}
                cid = ledger_add({"kind": kind, "model": model, "cost": job["cost"], "job": job["id"],
                                  "remote": job["remote"], "prompt": job["prompt"][:140], "status": "ok",
                                  "tokens_in": job["usage"].get("prompt_tokens"),
                                  "tokens_out": job["usage"].get("completion_tokens")})["id"]
            job["status"] = "succeeded"
        except MartError as e:
            job["status"], job["error"] = "failed", str(e)
            job["code"] = e.code
            if e.status == 402 or e.code in ("insufficient_balance", "insufficient_funds"):
                job["error"] = "Saldo insuficiente en MartLLM. " + str(e)
        except Exception as e:  # noqa: BLE001
            job["status"], job["error"] = "failed", f"{type(e).__name__}: {e}"
        finally:
            job["elapsed"] = round(time.time() - job["t0"], 1)
            job["ended"] = now_iso()
            job["ledger"] = cid
            BAL_CACHE["at"] = 0  # el próximo /api/balance pide el saldo fresco


def start(body: dict) -> dict:
    kind = body.get("kind") or ""
    if kind not in ROUTES:
        raise ValueError("Tipo de trabajo inválido.")
    model = (body.get("model") or "").strip()
    if not model:
        raise ValueError("Elige un modelo.")
    prompt = (body.get("prompt") or "").strip()
    params = body.get("params") or {}
    images = body.get("images") or {}
    refs = [x for x in [images.get("image_url"), images.get("end_image_url"), *(images.get("input_images") or [])] if x]
    payload: dict = {"params": clean_params(params), "refs": refs}
    cfg = settings()
    if kind == "chat":
        msgs = body.get("messages") or []
        if not msgs:
            raise ValueError("Escribe un mensaje.")
        out_msgs = []
        for m in msgs[-60:]:
            role = m.get("role") if m.get("role") in ("system", "user", "assistant") else "user"
            content = m.get("content") or ""
            imgs = [x for x in (m.get("images") or []) if x]
            if imgs and role == "user":
                parts = [{"type": "text", "text": content}] if content else []
                for aid in imgs[:6]:
                    a = find_asset(aid)
                    if a:
                        parts.append({"type": "image_url", "image_url": {"url": image_datauri(a)}})
                out_msgs.append({"role": role, "content": parts})
            else:
                out_msgs.append({"role": role, "content": content})
        req = {"model": model, "messages": out_msgs, **clean_params(params)}
        payload["body"] = req
        prompt = prompt or next((m.get("content") for m in reversed(msgs) if m.get("role") == "user"), "")
    elif kind == "transcribe":
        src = body.get("source") or ""
        if not find_asset(src):
            raise ValueError("Elige un audio o video de la biblioteca.")
        payload["source"] = src
    else:
        if kind == "speech" and not prompt:
            raise ValueError("Escribe el texto a decir.")
        if kind != "speech" and len(prompt) < 3:
            raise ValueError("Escribe un prompt.")
        payload["body"] = build_body(kind, model, prompt, params, images)
        cap = body.get("max_cost", cfg.get("max_cost"))
        if cap:
            payload["body"]["max_cost"] = float(cap)
        payload["body"]["metadata"] = {"app": "mart-studio"}
    job = new_job(kind, model, prompt, {"params": payload["params"], "refs": refs,
                                         "source": payload.get("source", "")})
    threading.Thread(target=_run, args=(job, payload), daemon=True).start()
    return job


# ---------------------------------------------------------------- build
def build() -> Path:
    ui = (ROOT / "ui.html").read_text(encoding="utf-8")
    js = (ROOT / "app.js").read_text(encoding="utf-8")
    html = ui.replace("__APP_JS__", js)
    tmp = BUILT.with_suffix(".tmp")
    tmp.write_text(html, encoding="utf-8")
    os.replace(tmp, BUILT)
    return BUILT


# ---------------------------------------------------------------- login
SESSION_COOKIE = "mart_sess"
SESSION_TTL = 7 * 24 * 3600
SESSIONS: dict[str, float] = {}
SESS_LOCK = threading.Lock()
FAILS: dict[str, list] = {}
FAILS_LOCK = threading.Lock()


def auth_enabled() -> bool:
    if os.environ.get("MART_AUTH", "").strip().lower() in ("off", "0", "no", "false"):
        return False
    return bool(AUTH_USER and AUTH_PASS)


def new_session() -> str:
    tok = secrets.token_urlsafe(32)
    with SESS_LOCK:
        SESSIONS[tok] = time.time() + SESSION_TTL
        for k in [k for k, exp in SESSIONS.items() if exp < time.time()]:
            SESSIONS.pop(k, None)
    return tok


def session_valid(tok: str) -> bool:
    if not tok:
        return False
    with SESS_LOCK:
        exp = SESSIONS.get(tok)
        if exp and exp > time.time():
            return True
        if exp:
            SESSIONS.pop(tok, None)
    return False


def login_page(error: str = "") -> bytes:
    err = f'<p class="err">{error}</p>' if error else ""
    return ("""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
<title>Entrar — Mart Studio</title><style>
@font-face{font-family:'Anton';src:url('/assets/fonts/ttf/Anton-Regular.ttf') format('truetype')}
:root{--bg:#0B0B0C;--field:#1F1F23;--paper:#F4F1EA;--dim:#8F8B83;--line:rgba(244,241,234,.16);--ink:#FF2E88;--bad:#FF4F45}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);
  color:var(--paper);font-family:'Segoe UI',system-ui,sans-serif}
.card{width:min(380px,100%);background:#141416;border-radius:4px;overflow:hidden;box-shadow:0 40px 90px -40px #000}
.bar{height:6px;background:linear-gradient(90deg,#FF2E88 0 20%,#FFE600 20% 40%,#22E07A 40% 60%,#A98BFF 60% 80%,#FF7A00 80%)}
.in{padding:26px 24px 22px}
h1{font-family:'Anton',Impact,sans-serif;font-weight:400;font-size:44px;line-height:.9;margin:0;text-transform:uppercase}
h1 span{color:var(--ink)}
.sub{font-size:13px;color:var(--dim);margin:8px 0 22px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}
input{width:100%;background:var(--field);border:1px solid var(--line);border-radius:4px;color:var(--paper);
  padding:12px 13px;font-size:15px;margin-bottom:15px}
input:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px rgba(255,46,136,.2)}
button{width:100%;height:48px;border:0;border-radius:4px;background:var(--ink);color:#0B0B0C;
  font-family:'Anton',Impact,sans-serif;font-size:22px;text-transform:uppercase;cursor:pointer}
.err{color:var(--bad);font-size:13px;margin:0 0 14px;border-left:2px solid var(--bad);padding-left:8px}
</style></head><body><form class="card" method="post" action="/login"><div class="bar"></div><div class="in">
<h1>Mart <span>Studio</span></h1>
<p class="sub">Laboratorio multimodal · acceso privado</p>
""" + err + """
<label for="u">Usuario</label><input id="u" name="user" autocomplete="username" autocapitalize="off" required autofocus>
<label for="p">Contraseña</label><input id="p" name="pass" type="password" autocomplete="current-password" required>
<button type="submit">Entrar</button>
</div></form></body></html>""").encode("utf-8")


# --------------------------------------------------------------- server
class Handler(BaseHTTPRequestHandler):
    server_version = "MartStudio/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str, headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _redirect(self, where: str, headers: dict | None = None):
        self._send(303, b"", "text/plain; charset=utf-8", {"Location": where, **(headers or {})})

    def _cookies(self) -> dict:
        out = {}
        for part in (self.headers.get("Cookie") or "").split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
        return out

    def _authed(self) -> bool:
        return (not auth_enabled()) or session_valid(self._cookies().get(SESSION_COOKIE, ""))

    def _guard(self, path: str) -> bool:
        if self._authed():
            return True
        if path.startswith("/api/"):
            self._json({"ok": False, "error": "Sesión vencida. Vuelve a entrar."}, 401)
        else:
            self._redirect("/login")
        return False

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _err(self, msg: str, code=400):
        self._json({"ok": False, "error": msg}, code)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 140 * 1024 * 1024:
            raise ValueError("Archivo demasiado grande (máx. 100 MB).")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            txt = raw.decode("utf-8")
        except UnicodeDecodeError:  # clientes que mandan Latin-1 (curl desde consolas viejas)
            txt = raw.decode("cp1252", "replace")
        return json.loads(txt or "{}")

    def _file(self, path: Path, ctype: str, cache: bool = False):
        """Sirve archivos con soporte de Range (los <video>/<audio> lo necesitan para buscar)."""
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return self._err("No existe el archivo.", 404)
        rng = self.headers.get("Range") or ""
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        start, end = 0, size - 1
        code = 200
        if m and size:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            elif m.group(2):
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            code = 206
        length = end - start + 1 if size else 0
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, max-age=86400" if cache else "no-store")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(1 << 16, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    # -- GET
    def do_GET(self):
        u = urlparse(self.path)
        p, qs = u.path, parse_qs(u.query or "")
        if p == "/login":
            if self._authed():
                return self._redirect("/")
            return self._send(200, login_page(), "text/html; charset=utf-8")
        if p == "/logout":
            with SESS_LOCK:
                SESSIONS.pop(self._cookies().get(SESSION_COOKIE, ""), None)
            return self._redirect("/login", {"Set-Cookie": f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"})
        if p.startswith("/assets/"):
            assets_root = (ROOT / "assets").resolve()
            try:
                target = (assets_root / unquote(p[len("/assets/"):])).resolve()
                target.relative_to(assets_root)
            except Exception:
                return self._err("Archivo no encontrado.", 404)
            if not target.is_file():
                return self._err("Archivo no encontrado.", 404)
            ct = "font/woff2" if target.suffix == ".woff2" else (mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            return self._file(target, ct, cache=True)
        if not self._guard(p):
            return
        if p in ("/", "/index.html"):
            try:
                if (not BUILT.exists() or (ROOT / "ui.html").stat().st_mtime > BUILT.stat().st_mtime
                        or (ROOT / "app.js").stat().st_mtime > BUILT.stat().st_mtime):
                    build()
            except Exception:
                if not BUILT.exists():
                    build()
            return self._file(BUILT, "text/html; charset=utf-8")
        if p == "/health":
            return self._json({"ok": True})
        try:
            if p == "/api/config":
                return self._json({"ok": True, "has_key": bool(API_KEY), "base": API_BASE, "ffmpeg": bool(FFMPEG),
                                   "settings": settings(), "auth": auth_enabled(), "inflight_max": MAX_INFLIGHT})
            if p == "/api/catalog":
                return self._json({"ok": True, **catalog(force=qs.get("force") == ["1"])})
            if p == "/api/model":
                return self._json({"ok": True, "model": model_detail((qs.get("id") or [""])[0])})
            if p == "/api/balance":
                return self._json({"ok": True, **balance(force=qs.get("force") == ["1"])})
            if p == "/api/usage":
                return self._json({"ok": True, "ledger": read_json(LEDGER, [])[-3000:],
                                   "balances": read_json(BALANCES, [])[-2000:], "settings": settings()})
            if p == "/api/library":
                store = load_store()
                return self._json({"ok": True, "assets": [public(a) for a in store["assets"]], "prompts": store["prompts"]})
            if p.startswith("/api/job/"):
                j = JOBS.get(p.rsplit("/", 1)[-1])
                return self._json({"ok": True, "job": job_view(j)}) if j else self._err("Trabajo no encontrado.", 404)
            if p == "/api/jobs":
                with JOBS_LOCK:
                    ids = list(JOBS_ORDER)[-40:][::-1]
                jobs = [job_view(JOBS[i]) for i in ids if i in JOBS]
                for j in jobs:
                    j.pop("text", None) if j["kind"] == "chat" else None
                return self._json({"ok": True, "jobs": jobs,
                                   "inflight": sum(1 for j in jobs if j["status"] not in TERMINAL)})
        except MartError as e:
            return self._err(str(e), 502 if e.status in (0, 500, 502, 503) else (e.status or 502))
        except Exception as e:  # noqa: BLE001
            return self._err(f"{type(e).__name__}: {e}", 500)
        if p.startswith("/media/"):
            target = safe_rel(p[len("/media/"):])
            if not target:
                return self._err("Archivo no encontrado.", 404)
            ct = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix.lower() in (".txt", ".srt", ".vtt", ".json"):
                ct = "text/plain; charset=utf-8"
            return self._file(target, ct, cache=True)
        return self._err("Ruta no encontrada.", 404)

    # -- POST
    def do_POST(self):
        p = urlparse(self.path).path
        if p == "/login":
            n = int(self.headers.get("Content-Length") or 0)
            form = parse_qs(self.rfile.read(min(n, 8192)).decode("utf-8", "ignore") if n else "")
            user, pw = (form.get("user") or [""])[0], (form.get("pass") or [""])[0]
            ip, now = self.client_address[0], time.time()
            with FAILS_LOCK:
                fails, first = FAILS.get(ip, [0, now])
                if now - first > 600:
                    fails, first = 0, now
                if fails >= 8:
                    return self._send(429, login_page("Demasiados intentos. Espera unos minutos."), "text/html; charset=utf-8")
            ok = hmac.compare_digest(user, AUTH_USER) & hmac.compare_digest(pw, AUTH_PASS)
            if not ok:
                with FAILS_LOCK:
                    FAILS[ip] = [fails + 1, first]
                time.sleep(0.4)
                return self._send(401, login_page("Usuario o contraseña incorrectos."), "text/html; charset=utf-8")
            with FAILS_LOCK:
                FAILS.pop(ip, None)
            return self._redirect("/", {"Set-Cookie": f"{SESSION_COOKIE}={new_session()}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; SameSite=Lax"})
        if not self._guard(p):
            return
        try:
            body = self._body()
        except Exception as e:  # noqa: BLE001
            return self._err(f"Petición inválida: {e}")
        try:
            if p == "/api/run":
                job = start(body)
                return self._json({"ok": True, "job": job_view(job)})
            if p == "/api/quote":
                q = quote_req(body.get("kind") or "", body.get("model") or "", body.get("prompt") or "",
                              body.get("params") or {}, body.get("images") or {}, body.get("duration"))
                return self._json({"ok": True, "quote": q})
            if p == "/api/cancel":
                j = JOBS.get(body.get("id") or "")
                if not j:
                    return self._err("Trabajo no encontrado.", 404)
                if j["kind"] in ASYNC_KINDS and j["status"] not in TERMINAL:
                    j["cancel"] = True
                    return self._json({"ok": True, "note": "Pedí a MartLLM que lo detenga. Si ya terminó, se cobra."})
                return self._err("Este trabajo no se puede cancelar (ya va en camino o terminó).")
            if p == "/api/upload":
                return self._upload(body)
            if p == "/api/settings":
                cur = settings()
                if "max_cost" in body:
                    v = body.get("max_cost")
                    cur["max_cost"] = None if v in (None, "", 0) else max(0.001, min(100.0, float(v)))
                if "nsfw" in body:
                    cur["nsfw"] = bool(body["nsfw"])
                write_json(SETTINGS, cur)
                return self._json({"ok": True, "settings": cur})
            if p == "/api/prompt":
                name, text = (body.get("name") or "").strip()[:60], (body.get("text") or "").strip()
                if not name or not text:
                    return self._err("Faltan nombre o texto del prompt.")
                with STORE_LOCK:
                    store = load_store()
                    store["prompts"] = [x for x in store["prompts"] if x.get("name") != name]
                    store["prompts"].insert(0, {"name": name, "text": text, "kind": body.get("kind") or "", "created": now_iso()})
                    save_store(store)
                return self._json({"ok": True})
            if p == "/api/delete":
                want = {str(x) for x in (body.get("ids") or []) if x}
                if not want:
                    return self._err("No elegiste ninguna pieza.")
                with STORE_LOCK:
                    store = load_store()
                    drop = [a for a in store["assets"] if a["id"] in want]
                    store["assets"] = [a for a in store["assets"] if a["id"] not in want]
                    save_store(store)
                where = to_trash([ROOT / a["file"] for a in drop])
                for a in drop:
                    if a.get("thumb"):
                        (ROOT / a["thumb"]).unlink(missing_ok=True)
                    DATAURI_CACHE.pop(a["id"], None)
                return self._json({"ok": True, "ids": [a["id"] for a in drop], "where": where})
            if p == "/api/reveal":
                os.startfile(str(OUT))  # noqa: S606
                return self._json({"ok": True})
        except ValueError as e:
            return self._err(str(e))
        except MartError as e:
            return self._err(str(e), 502 if e.status in (0, 500, 502, 503) else (e.status or 502))
        except Exception as e:  # noqa: BLE001
            return self._err(f"{type(e).__name__}: {e}", 500)
        return self._err("Ruta no encontrada.", 404)

    def _upload(self, body: dict):
        data_url = body.get("data_url") or ""
        if "," not in data_url or "base64" not in data_url.split(",", 1)[0]:
            return self._err("Falta el archivo (data_url en base64).")
        head, b64 = data_url.split(",", 1)
        try:
            blob = base64.b64decode(b64)
        except Exception:
            return self._err("No se pudo decodificar el archivo.")
        ext = sniff_ext(blob, head[5:].split(";")[0])
        if ext == ".bin":
            ext = Path(body.get("name") or "").suffix.lower() or ".bin"
        media = media_of_ext(ext)
        if media == "text" and ext not in (".txt", ".srt", ".vtt"):
            return self._err("Formato no soportado. Sube imagen, audio o video.")
        if media == "image":
            try:
                Image.open(io.BytesIO(blob)).verify()
            except Exception:
                return self._err("Ese archivo no es una imagen válida.")
        name = slug(Path(body.get("name") or "subida").stem)
        path = UP / f"{name}-{uuid.uuid4().hex[:6]}{ext}"
        path.write_bytes(blob)
        a = add_asset(path, media=media, origin="upload", prompt=body.get("note", ""),
                      text=blob.decode("utf-8", "ignore") if media == "text" else "")
        return self._json({"ok": True, "asset": public(a)})


def _lan_ips() -> list[str]:
    ips: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=3,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        ips += [ln.strip() for ln in out.stdout.splitlines() if ln.strip() and ln.strip() not in ips]
    except Exception:
        pass
    return ips


def main():
    build()
    host = HOST
    if not auth_enabled() and host not in ("127.0.0.1", "localhost"):
        print("! Sin user/pass en el .env: el servidor queda solo en 127.0.0.1.")
        host = "127.0.0.1"
    port = PORT
    while True:
        try:
            httpd = ThreadingHTTPServer((host, port), Handler)
            break
        except OSError:
            port += 1
            if port > PORT + 20:
                raise
    url = f"http://127.0.0.1:{port}/"
    print(f"Mart Studio en {url}")
    print(f"Escuchando en {host}:{port}" + ("  (todas las interfaces)" if host in ("0.0.0.0", "") else ""))
    print("API key: " + ("ok" if API_KEY else "FALTA (martllm-key en el .env)") + f" · {API_BASE}")
    print("ffmpeg: " + (FFMPEG or "no encontrado (sin miniaturas de video ni ondas)"))
    print("Login: " + ("activo" if auth_enabled() else "desactivado"))
    for ip in _lan_ips():
        print(f"  desde otro equipo: http://{ip}:{port}/")
    print("Ctrl+C para cerrar.")
    if API_KEY:
        threading.Thread(target=lambda: (catalog(), balance(force=True)), daemon=True).start()
    if "--no-open" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrado.")


if __name__ == "__main__":
    main()
