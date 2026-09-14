"""
GED Travel Agency
Main Flask Application — v2.0

Rotas principais:
    GET  /                       → redireciona para /pages/help.html
    GET  /pages/<file>           → serve páginas HTML
    GET  /api                    → índice de endpoints
    GET  /api/health             → status do backend + concierge
    GET  /api/diagnose           → testa modelos NVIDIA (novo)
    GET  /api/provinces          → dados demo (legacy)
    GET  /api/ask                → resposta demo (legacy)
    POST /api/concierge          → chat com GED Concierge (principal)
"""

import os
import sys
import time
import uuid
import webbrowser
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from flask import (
    Flask, jsonify, request, send_from_directory,
    redirect, make_response, Response,
)
from flask_cors import CORS


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=os.getenv("GED_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("ged.app")


# ============================================================
# PATHS
# ============================================================

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
PAGES_DIR = ROOT_DIR / "pages"
DATA_DIR = ROOT_DIR / "data"
CSS_DIR = ROOT_DIR / "css"
JS_DIR = ROOT_DIR / "js"
ASSETS_DIR = ROOT_DIR / "assets"


# ============================================================
# APP
# ============================================================

app = Flask(
    __name__,
    static_folder=str(ROOT_DIR),
    static_url_path="",
)

app.config.update(
    JSON_SORT_KEYS=False,
    JSONIFY_PRETTYPRINT_REGULAR=False,
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    SEND_FILE_MAX_AGE_DEFAULT=0,
    PROPAGATE_EXCEPTIONS=False,
)


# ============================================================
# CORS
# ============================================================

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": "*",
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Accept", "Authorization", "X-Request-ID"],
            "max_age": 3600,
        }
    },
)


# ============================================================
# PROJECT CONSTANTS
# ============================================================

PROJECT_NAME = "GED Travel Agency"
PROJECT_VERSION = "2.0.0"
PROJECT_MODE = "educational-demo"


# ============================================================
# CONCIERGE LOAD
# ============================================================

CONCIERGE_AVAILABLE = False
CONCIERGE_INFO: Dict[str, Any] = {}

try:
    from concierge import ask_concierge

    CONCIERGE_AVAILABLE = True

    # Coleta info sobre os modelos configurados (sem quebrar se faltar algo)
    try:
        from concierge import (
            KIMI_MODEL as _CONC_KIMI,
            DEEPSEEK_MODEL as _CONC_DS,
            FALLBACK_CHAIN as _CONC_FB,
            REQUEST_TIMEOUT as _CONC_TIMEOUT,
            REQUEST_RETRIES as _CONC_RETRIES,
        )
        CONCIERGE_INFO = {
            "primary_model": _CONC_KIMI,
            "reasoning_model": _CONC_DS,
            "fallback_chain": list(_CONC_FB),
            "timeout": _CONC_TIMEOUT,
            "retries": _CONC_RETRIES,
        }
    except Exception as e:
        logger.warning("Concierge loaded, but couldn't introspect config: %s", e)

    logger.info("✓ GED Concierge engine loaded.")
    if CONCIERGE_INFO:
        logger.info("  · Primary model : %s", CONCIERGE_INFO.get("primary_model"))
        logger.info("  · Reasoning     : %s", CONCIERGE_INFO.get("reasoning_model"))
        logger.info("  · Fallback chain: %d models", len(CONCIERGE_INFO.get("fallback_chain", [])))

except ImportError as e:
    ask_concierge = None  # type: ignore
    logger.warning("✗ GED Concierge engine NOT available: %s", e)


# Diagnóstico só existe no concierge v3+
DIAGNOSE_AVAILABLE = False
try:
    from concierge import diagnose_connection  # type: ignore
    DIAGNOSE_AVAILABLE = True
except ImportError:
    diagnose_connection = None  # type: ignore


# ============================================================
# HELPERS
# ============================================================

def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def api_response(data: Dict[str, Any], status_code: int = 200) -> Response:
    """Resposta JSON padronizada."""
    response = jsonify(data)
    response.status_code = status_code
    return response


def error_response(
    message: str,
    status_code: int = 400,
    error_code: Optional[str] = None,
) -> Response:
    """Erro padronizado — mesmo shape do sucesso (frontend lê .answer)."""
    payload: Dict[str, Any] = {
        "success": False,
        "answer": message,
        "error": message,
        "model": "GED Concierge (error)",
        "image": None,
        "sources": [],
        "timestamp": utc_timestamp(),
    }
    if error_code:
        payload["code"] = error_code
    return api_response(payload, status_code)


def clean_text(value: Any, max_length: int = 2000) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]


def safe_json(data: Dict[str, Any]) -> Dict[str, Any]:
    """Remove chaves internas; garante que só campos previstos passem."""
    if not isinstance(data, dict):
        return {"success": False, "answer": "Invalid payload."}

    allowed_keys = {
        # core
        "success", "answer", "error", "timestamp", "code",
        # metadata
        "model", "provider", "mode", "fallback_from",
        # media + sources
        "image", "sources",
        # metrics
        "usage", "latency_ms",
        # extras
        "recommendations", "value_score", "discount",
    }

    return {k: data[k] for k in allowed_keys if k in data}


# ============================================================
# SECURITY HEADERS + REQUEST ID
# ============================================================

@app.after_request
def _add_headers(response: Response) -> Response:
    """Headers de segurança + X-Request-ID + Cache-Control para API."""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")

    # Cache-Control: no-store para toda rota /api/*
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"

    # X-Request-ID — propaga se veio do cliente, senão gera
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
    response.headers["X-Request-ID"] = rid
    return response


# ============================================================
# ERROR HANDLERS
# ============================================================

def _is_api_request() -> bool:
    return request.path.startswith("/api/")


@app.errorhandler(400)
def bad_request(error):
    if _is_api_request():
        return error_response("Bad request.", 400, "BAD_REQUEST")
    return error, 400


@app.errorhandler(404)
def not_found(error):
    if _is_api_request():
        return error_response("Endpoint not found.", 404, "NOT_FOUND")

    if request.path.startswith("/pages/"):
        return error_response(
            f"Page not found: {request.path}",
            404,
            "PAGE_NOT_FOUND",
        )

    return redirect("/pages/help.html")


@app.errorhandler(405)
def method_not_allowed(error):
    return error_response(
        "HTTP method not supported for this endpoint.",
        405,
        "METHOD_NOT_ALLOWED",
    )


@app.errorhandler(413)
def request_too_large(error):
    return error_response(
        "Request body too large (max 2 MB).", 413, "REQUEST_TOO_LARGE"
    )


@app.errorhandler(415)
def unsupported_media_type(error):
    return error_response(
        "Unsupported media type. Send application/json.",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
    )


@app.errorhandler(500)
def internal_server_error(error):
    logger.exception("Internal GED API error")
    return error_response("Internal server error.", 500, "INTERNAL_ERROR")


# ============================================================
# STATIC PAGES
# ============================================================

@app.route("/")
def root():
    """Raiz redireciona direto para o Concierge."""
    return redirect("/pages/help.html")


@app.route("/pages/")
@app.route("/pages")
def pages_index():
    """Listagem simples das páginas disponíveis."""
    if not PAGES_DIR.exists():
        return error_response("pages/ directory not found.", 404, "PAGES_MISSING")

    files = sorted(
        p.name for p in PAGES_DIR.iterdir()
        if p.is_file() and p.suffix.lower() == ".html"
    )
    return api_response({
        "success": True,
        "pages": files,
        "count": len(files),
        "timestamp": utc_timestamp(),
    })


@app.route("/pages/<path:filename>")
def serve_page(filename: str):
    """Serve páginas em /pages/ com verificação de segurança."""
    if ".." in filename or filename.startswith("/"):
        return error_response("Invalid path.", 400, "INVALID_PATH")

    target = PAGES_DIR / filename
    if not target.exists() or not target.is_file():
        return error_response(
            f"Page not found: {filename}", 404, "PAGE_NOT_FOUND"
        )

    return send_from_directory(str(PAGES_DIR), filename)


# ============================================================
# API — INFO + HEALTH
# ============================================================

@app.get("/api")
def api_info():
    return api_response({
        "success": True,
        "name": PROJECT_NAME,
        "version": PROJECT_VERSION,
        "mode": PROJECT_MODE,
        "endpoints": {
            "health": "GET  /api/health",
            "diagnose": "GET  /api/diagnose",
            "provinces": "GET  /api/provinces",
            "legacy_ask": "GET  /api/ask",
            "concierge": "POST /api/concierge",
        },
        "concierge": {
            "available": CONCIERGE_AVAILABLE,
            "diagnose_available": DIAGNOSE_AVAILABLE,
            **CONCIERGE_INFO,
        },
        "static": {
            "root": "GET /  →  redirects to /pages/help.html",
            "help": "GET /pages/help.html",
            "pages_index": "GET /pages/",
        },
        "timestamp": utc_timestamp(),
    })


@app.get("/api/health")
def health():
    return api_response({
        "success": True,
        "status": "ok",
        "project": PROJECT_NAME,
        "version": PROJECT_VERSION,
        "mode": PROJECT_MODE,
        "service": "GED Backend API",
        "concierge": {
            "available": CONCIERGE_AVAILABLE,
            "endpoint": "/api/concierge",
            "diagnose_available": DIAGNOSE_AVAILABLE,
            **CONCIERGE_INFO,
        },
        "paths": {
            "root": str(ROOT_DIR),
            "pages": str(PAGES_DIR),
            "pages_exists": PAGES_DIR.exists(),
        },
        "timestamp": utc_timestamp(),
    })


# ============================================================
# API — DIAGNOSE (novo)
# ============================================================
# Testa a conectividade com cada modelo NVIDIA configurado.
# Útil quando o chat não responde e você precisa saber qual
# modelo realmente funciona na sua conta.
# ============================================================

@app.get("/api/diagnose")
def diagnose():
    if not DIAGNOSE_AVAILABLE:
        return error_response(
            "Diagnostic endpoint not available. "
            "Update concierge.py to v3+ to enable it.",
            501,
            "DIAGNOSE_NOT_AVAILABLE",
        )

    logger.info("→ /api/diagnose — starting model connectivity test…")
    start = time.time()

    try:
        report = diagnose_connection()
    except Exception as e:
        logger.exception("Diagnose failed: %s", e)
        return error_response(
            f"Diagnostic failed: {e}",
            500,
            "DIAGNOSE_ERROR",
        )

    elapsed = time.time() - start

    logger.info(
        "← /api/diagnose — %d/%d models working, took %.1fs",
        len(report.get("working", [])),
        len(report.get("results", [])),
        elapsed,
    )

    return api_response({
        "success": True,
        "working": report.get("working", []),
        "failed": report.get("failed", []),
        "results": report.get("results", []),
        "summary": {
            "total": len(report.get("results", [])),
            "working": len(report.get("working", [])),
            "failed": len(report.get("failed", [])),
        },
        "elapsed_seconds": round(elapsed, 2),
        "timestamp": utc_timestamp(),
    })


# ============================================================
# API — LEGACY (demo)
# ============================================================

@app.get("/api/provinces")
def provinces():
    return api_response({
        "success": True,
        "count": 13,
        "source": "local demo dataset",
        "country": "Canada",
        "timestamp": utc_timestamp(),
    })


@app.get("/api/ask")
def ask():
    return api_response({
        "success": True,
        "answer": "GED Concierge demo: try Toronto, Vancouver, Montréal or Banff.",
        "model": "GED Concierge Demo",
        "timestamp": utc_timestamp(),
    })


# ============================================================
# API — CONCIERGE (main)
# ============================================================

def _parse_conversation(raw: Any) -> list:
    """Valida e limpa o histórico de conversa enviado pelo frontend."""
    if not isinstance(raw, list):
        return []

    cleaned = []
    for item in raw[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"}:
            continue
        content = clean_text(content, max_length=4000)
        if not content:
            continue
        cleaned.append({"role": role, "content": content})
    return cleaned


def _classify_concierge_error(exc: Exception) -> tuple:
    """
    Classifica a exceção do concierge em (status_code, error_code, mensagem).
    Retorna códigos que o frontend pode usar para decidir o que mostrar.
    """
    msg = str(exc).lower()

    # Erros específicos da NVIDIA
    if "401" in msg or "unauthorized" in msg:
        return (
            502,
            "NVIDIA_UNAUTHORIZED",
            "The AI provider rejected our credentials. "
            "Check the NVIDIA API key configuration.",
        )
    if "403" in msg or "forbidden" in msg:
        return (
            502,
            "NVIDIA_FORBIDDEN",
            "The AI provider refused access to this model. "
            "The account may lack the 'Public API Endpoints' permission.",
        )
    if "404" in msg or "not exist" in msg or "not found" in msg:
        return (
            502,
            "NVIDIA_MODEL_NOT_FOUND",
            "The requested AI model doesn't exist on the provider.",
        )
    if "429" in msg or "rate limit" in msg:
        return (
            429,
            "NVIDIA_RATE_LIMIT",
            "The AI provider is rate limiting us. Please wait a moment and try again.",
        )
    if "timeout" in msg or "timed out" in msg:
        return (
            504,
            "NVIDIA_TIMEOUT",
            "The AI provider took too long to respond. "
            "Please try again with a shorter question.",
        )
    if "network" in msg or "connection" in msg or "unreachable" in msg:
        return (
            503,
            "NVIDIA_NETWORK",
            "Could not reach the AI provider. Check your internet connection.",
        )

    # Fallback genérico
    return (
        503,
        "CONCIERGE_UNAVAILABLE",
        "The GED Concierge is temporarily unavailable. "
        "Please try again in a moment.",
    )


@app.post("/api/concierge")
def concierge():
    request_id = (
        request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
    )
    start_time = time.time()

    # ---------- 1. Validar request ----------
    if not request.is_json:
        return error_response(
            "Request must contain JSON with Content-Type: application/json.",
            415,
            "JSON_REQUIRED",
        )

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error_response(
            "Invalid request body — expected a JSON object.",
            400,
            "INVALID_BODY",
        )

    message = clean_text(data.get("message"), max_length=2000)
    if not message:
        return error_response(
            "Please provide a non-empty 'message' field.",
            400,
            "MESSAGE_REQUIRED",
        )

    conversation = _parse_conversation(data.get("conversation", []))

    logger.info(
        "[%s] → /api/concierge — message_len=%d, history=%d",
        request_id, len(message), len(conversation),
    )

    # ---------- 2. Concierge disponível? ----------
    if not CONCIERGE_AVAILABLE:
        logger.warning("[%s] Concierge engine not available.", request_id)
        return api_response({
            "success": True,
            "answer": (
                "The GED Concierge engine is being configured. "
                "The interface works, but the AI engine isn't installed yet. "
                "Make sure `concierge.py` is in the `backend/` folder and its "
                "dependencies are installed."
            ),
            "model": "GED Concierge · Setup pending",
            "provider": "offline",
            "mode": "setup",
            "image": None,
            "sources": [],
            "timestamp": utc_timestamp(),
        })

    # ---------- 3. Chamar o engine ----------
    try:
        result = ask_concierge(message=message, conversation=conversation)
    except ValueError as e:
        logger.warning("[%s] Concierge validation error: %s", request_id, e)
        return error_response(
            "Invalid request to the Concierge engine.",
            400,
            "CONCIERGE_VALIDATION",
        )
    except Exception as e:
        logger.exception("[%s] Concierge crashed: %s", request_id, e)
        status, code, friendly = _classify_concierge_error(e)
        return error_response(friendly, status, code)

    elapsed_ms = int((time.time() - start_time) * 1000)

    # ---------- 4. Normalizar resposta ----------
    if isinstance(result, str):
        result = {"answer": result, "model": "GED Concierge"}

    if not isinstance(result, dict):
        logger.error("[%s] Concierge returned non-dict: %r",
                     request_id, type(result))
        return error_response(
            "The Concierge engine returned an invalid response.",
            502,
            "CONCIERGE_INVALID",
        )

    answer = result.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        logger.error("[%s] Concierge returned empty answer.", request_id)
        return error_response(
            "The Concierge engine returned an empty answer. "
            "Please try rephrasing your question.",
            502,
            "CONCIERGE_EMPTY",
        )

    # ---------- 5. Montar payload final ----------
    payload: Dict[str, Any] = {
        "success": True,
        "answer": answer.strip(),
        "model": result.get("model", "GED Concierge"),
        "provider": result.get("provider", "NVIDIA NIM"),
        "mode": result.get("mode", "conversation"),
        "image": result.get("image"),
        "sources": result.get("sources") or [],
        "usage": result.get("usage"),
        "latency_ms": elapsed_ms,
        "timestamp": utc_timestamp(),
    }

    # Informa se caiu no fallback (concierge v3+)
    if result.get("fallback_from"):
        payload["fallback_from"] = result["fallback_from"]

    # Chaves opcionais adicionais
    for key in ("recommendations", "value_score", "discount", "error"):
        if key in result and result[key] is not None:
            payload[key] = result[key]

    payload = safe_json(payload)

    # Log resumido (inclui fallback se houver)
    fallback_note = ""
    if payload.get("fallback_from"):
        fallback_note = f" [fallback from {payload['fallback_from']}]"

    logger.info(
        "[%s] ← /api/concierge — model=%s%s, provider=%s, mode=%s, "
        "answer_len=%d, sources=%d, image=%s, latency=%dms",
        request_id,
        payload.get("model"),
        fallback_note,
        payload.get("provider"),
        payload.get("mode"),
        len(payload.get("answer", "")),
        len(payload.get("sources", []) or []),
        "yes" if payload.get("image") else "no",
        elapsed_ms,
    )

    return api_response(payload)


# ============================================================
# OPTIONS preflight (redundante com flask-cors, mas explícito)
# ============================================================

@app.route("/api/concierge", methods=["OPTIONS"])
def concierge_options():
    response = make_response("", 204)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept, X-Request-ID"
    response.headers["Access-Control-Max-Age"] = "3600"
    return response


# ============================================================
# FAVICON
# ============================================================

@app.route("/favicon.ico")
def favicon():
    icon = ROOT_DIR / "favicon.ico"
    if icon.exists():
        return send_from_directory(str(ROOT_DIR), "favicon.ico")
    return ("", 204)


# ============================================================
# BOOT
# ============================================================

def _open_browser(url: str, delay: float = 1.5) -> None:
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url, new=2)
            logger.info("Browser opened at %s", url)
        except Exception as e:
            logger.warning("Could not auto-open browser: %s", e)

    threading.Thread(target=_open, daemon=True).start()


def _print_banner(port: int) -> None:
    base = f"http://127.0.0.1:{port}"

    print()
    print("=" * 62)
    print("  GED TRAVEL AGENCY — Flask Backend v" + PROJECT_VERSION)
    print("=" * 62)
    print(f"  Project            : {PROJECT_NAME}")
    print(f"  Mode               : {PROJECT_MODE}")
    print(f"  Port               : {port}")
    print(f"  Concierge ready    : {'OK' if CONCIERGE_AVAILABLE else 'FAIL'}")
    print(f"  Diagnose endpoint  : {'OK' if DIAGNOSE_AVAILABLE else 'N/A'}")
    print(f"  Static root        : {ROOT_DIR}")
    print(f"  Pages dir exists   : {'OK' if PAGES_DIR.exists() else 'MISSING'}")

    if CONCIERGE_INFO:
        print()
        print("  AI models:")
        print(f"    Primary          : {CONCIERGE_INFO.get('primary_model')}")
        print(f"    Reasoning        : {CONCIERGE_INFO.get('reasoning_model')}")
        fb = CONCIERGE_INFO.get("fallback_chain", [])
        print(f"    Fallback chain   : {len(fb)} model(s)")
        for m in fb[:3]:
            print(f"                       · {m}")
        if len(fb) > 3:
            print(f"                       · … e mais {len(fb) - 3}")
        print(f"    Timeout / retries: {CONCIERGE_INFO.get('timeout')}s / "
              f"{CONCIERGE_INFO.get('retries')}")

    print()
    print("  → Open in browser:")
    print(f"     {base}/")
    print()
    print("  → API endpoints:")
    print(f"     GET  {base}/api")
    print(f"     GET  {base}/api/health")
    print(f"     GET  {base}/api/diagnose   ← testes de conectividade NVIDIA")
    print(f"     POST {base}/api/concierge")
    print("=" * 62)
    print()


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug_mode = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    auto_open = os.environ.get("GED_AUTO_OPEN", "true").lower() == "true"

    base_url = f"http://127.0.0.1:{port}"

    _print_banner(port)

    if not PAGES_DIR.exists():
        print(f"  WARNING: pages/ not found at {PAGES_DIR}")
        print(f"           /pages/help.html will return 404.")
        print()

    if not CONCIERGE_AVAILABLE:
        print(f"  WARNING: Concierge engine not loaded.")
        print(f"           /api/concierge will return a 'setup pending' message.")
        print()

    if auto_open:
        _open_browser(base_url + "/", delay=1.5)

    try:
        app.run(
            host="127.0.0.1",
            port=port,
            debug=debug_mode,
            use_reloader=False,
            threaded=True,
        )
    except KeyboardInterrupt:
        print("\n  Server stopped by user (Ctrl+C).")
        sys.exit(0)
    except OSError as e:
        print()
        print("!" * 62)
        print("  ERROR: Could not start Flask.")
        print(f"  Reason: {e}")
        print()
        print(f"  Port {port} may be in use. Try:")
        print(f"    PORT=5001 python app.py")
        print("!" * 62)
        print()
        sys.exit(1)