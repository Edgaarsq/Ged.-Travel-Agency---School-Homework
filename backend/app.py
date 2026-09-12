"""
GED Travel Agency
Main Flask Application

Como rodar:
    cd backend
    python app.py

O navegador abre automaticamente em:
    http://127.0.0.1:5000/

E o /api/concierge fica disponível no mesmo host.
"""

import os
import sys
import time
import webbrowser
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, redirect
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
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,  # 2 MB
    SEND_FILE_MAX_AGE_DEFAULT=0,          # no cache while developing
)


# ============================================================
# CORS — dev mode: permite qualquer origem
# ============================================================
# Isso resolve o caso de Live Server (5500), 8000, file://, etc.
# Em produção, restrinja para o domínio real.
# ============================================================

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": "*",
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Accept"],
        }
    },
)


# ============================================================
# PROJETO
# ============================================================

PROJECT_NAME = "GED Travel Agency"
PROJECT_VERSION = "1.0.0"
PROJECT_MODE = "educational-demo"


# ============================================================
# CONCIERGE
# ============================================================

try:
    from concierge import ask_concierge

    CONCIERGE_AVAILABLE = True
    logger.info("✓ GED Concierge engine loaded.")
except ImportError as e:
    ask_concierge = None
    CONCIERGE_AVAILABLE = False
    logger.warning("✗ GED Concierge engine NOT available: %s", e)


# ============================================================
# HELPERS
# ============================================================

def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def api_response(data, status_code: int = 200):
    return jsonify(data), status_code


def error_response(message: str, status_code: int = 400, error_code: str = None):
    payload = {
        "success": False,
        "answer": message,
        "error": message,
        "model": "GED Concierge (error)",
        "image": None,
        "timestamp": utc_timestamp(),
    }
    if error_code:
        payload["code"] = error_code
    return jsonify(payload), status_code


def clean_text(value, max_length: int = 2000) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return error_response("Endpoint not found.", 404, "NOT_FOUND")
    return error, 404


@app.errorhandler(405)
def method_not_allowed(error):
    return error_response(
        "HTTP method not supported for this endpoint.", 405, "METHOD_NOT_ALLOWED"
    )


@app.errorhandler(413)
def request_too_large(error):
    return error_response("Request body too large.", 413, "REQUEST_TOO_LARGE")


@app.errorhandler(500)
def internal_server_error(error):
    logger.exception("Internal GED API error")
    return error_response("Internal server error.", 500, "INTERNAL_ERROR")


# ============================================================
# STATIC PAGES
# ============================================================
# Objetivo: abrir http://127.0.0.1:5000/ e já cair no help.html
# ============================================================

@app.route("/")
def root():
    """Raiz redireciona direto para o Concierge."""
    return redirect("/pages/help.html")


@app.route("/pages/help.html")
def serve_help():
    """Serve a página do Concierge."""
    help_path = ROOT_DIR / "pages" / "help.html"
    if not help_path.exists():
        return (
            f"help.html not found at {help_path}. "
            f"Check the project structure.",
            404,
        )
    return send_from_directory(str(ROOT_DIR / "pages"), "help.html")


@app.route("/pages/<path:filename>")
def serve_any_page(filename):
    """Serve qualquer outra página em /pages/."""
    return send_from_directory(str(ROOT_DIR / "pages"), filename)


# ============================================================
# API — HEALTH
# ============================================================

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
        },
        "timestamp": utc_timestamp(),
    })


# ============================================================
# API — LEGACY
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

@app.post("/api/concierge")
def concierge():
    if not request.is_json:
        return error_response("Request must contain JSON.", 415, "JSON_REQUIRED")

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error_response("Invalid request body.", 400, "INVALID_BODY")

    message = clean_text(data.get("message"), max_length=2000)
    if not message:
        return error_response("Please provide a message.", 400, "MESSAGE_REQUIRED")

    conversation = data.get("conversation", [])
    if not isinstance(conversation, list):
        conversation = []

    cleaned_conversation = []
    for item in conversation[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"}:
            continue
        content = clean_text(content, max_length=4000)
        if not content:
            continue
        cleaned_conversation.append({"role": role, "content": content})

    if not CONCIERGE_AVAILABLE:
        logger.warning("Concierge not available.")
        return api_response({
            "success": True,
            "answer": (
                "The GED Concierge engine is being configured. "
                "The interface works, but the AI engine isn't installed yet."
            ),
            "model": "GED Concierge · Setup pending",
            "image": None,
            "timestamp": utc_timestamp(),
        })

    logger.info(
        "→ /api/concierge — message_len=%d, history=%d",
        len(message), len(cleaned_conversation),
    )

    try:
        result = ask_concierge(
            message=message,
            conversation=cleaned_conversation,
        )

        if isinstance(result, str):
            result = {"answer": result, "model": "GED Concierge"}

        if not isinstance(result, dict):
            raise RuntimeError("Concierge returned invalid response type.")

        answer = result.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            raise RuntimeError("Concierge returned an empty answer.")

        payload = {
            "success": True,
            "answer": answer.strip(),
            "model": result.get("model", "GED Concierge"),
            "image": result.get("image"),
            "timestamp": utc_timestamp(),
        }

        for key in (
            "provider",
            "mode",
            "recommendations",
            "value_score",
            "discount",
            "usage",
            "error",
        ):
            if key in result:
                payload[key] = result[key]

        logger.info(
            "← /api/concierge — model=%s, answer_len=%d",
            payload["model"], len(payload["answer"]),
        )

        return api_response(payload)

    except Exception as error:
        logger.exception("GED Concierge request failed: %s", error)
        return error_response(
            "The GED Concierge is temporarily unavailable. "
            "Please try again in a moment.",
            503,
            "CONCIERGE_UNAVAILABLE",
        )


# ============================================================
# API — INFO
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
            "provinces": "GET  /api/provinces",
            "legacy_ask": "GET  /api/ask",
            "concierge": "POST /api/concierge",
        },
        "concierge": {"available": CONCIERGE_AVAILABLE},
        "static": {
            "root": "GET /  →  redirects to /pages/help.html",
            "help": "GET /pages/help.html",
        },
        "timestamp": utc_timestamp(),
    })


# ============================================================
# BOOT — auto-open browser
# ============================================================

def _open_browser(url: str, delay: float = 1.2) -> None:
    """Abre o navegador depois de um pequeno delay."""
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url, new=2)
            logger.info("Browser opened at %s", url)
        except Exception as e:
            logger.warning("Could not auto-open browser: %s", e)

    t = threading.Thread(target=_open, daemon=True)
    t.start()


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug_mode = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    auto_open = os.environ.get("GED_AUTO_OPEN", "true").lower() == "true"

    base_url = f"http://127.0.0.1:{port}"

    print()
    print("=" * 62)
    print("  GED TRAVEL AGENCY — Flask Backend")
    print("=" * 62)
    print(f"  Project            : {PROJECT_NAME}")
    print(f"  Version            : {PROJECT_VERSION}")
    print(f"  Mode               : {PROJECT_MODE}")
    print(f"  Port               : {port}")
    print(f"  Concierge ready    : {CONCIERGE_AVAILABLE}")
    print(f"  Static root        : {ROOT_DIR}")
    print()
    print("  → Open in browser:")
    print(f"     {base_url}/")
    print()
    print("  → API endpoints:")
    print(f"     GET  {base_url}/api")
    print(f"     GET  {base_url}/api/health")
    print(f"     POST {base_url}/api/concierge")
    print("=" * 62)
    print()

    if auto_open and not debug_mode:
        # Em produção, abre automaticamente
        _open_browser(f"{base_url}/")
    elif auto_open and debug_mode:
        # Em debug, também abre (mais conveniente para o dev)
        _open_browser(f"{base_url}/")

    try:
        app.run(
            host="127.0.0.1",
            port=port,
            debug=debug_mode,
            use_reloader=False,   # evita abrir o browser duas vezes
        )
    except OSError as e:
        print()
        print("!" * 62)
        print(f"  ERROR: Could not start Flask.")
        print(f"  Reason: {e}")
        print()
        print(f"  Port {port} may be in use. Try:")
        print(f"    PORT=5001 python app.py")
        print("!" * 62)
        print()
        sys.exit(1)