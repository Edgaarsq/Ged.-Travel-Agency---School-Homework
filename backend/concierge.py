"""
GED Travel Agency
GED Concierge AI Engine — v3.3

Responsável por:
- Comunicar com NVIDIA NIM (Kimi K3 / DeepSeek V4 Pro / fallbacks)
- Cadeia de fallback automática entre modelos ativos
- Diagnóstico standalone de conectividade
- Detectar intenção de imagem e gerar URLs contextuais (Unsplash)
- Anexar fontes curadas (sites oficiais de turismo/gov) por tópico
- Fallback offline no idioma do usuário (EN/FR/PT/ES)
- Deduplicar mensagem repetida (bug do frontend)
- Retornar respostas estruturadas para o Flask

Fluxo:
    help.html → app.py → concierge.py → NVIDIA NIM
                                       → Unsplash (imagens)
                                       → CURATED_SOURCES (fontes)

Changelog v3.3:
    - Removidos modelos EOL: meta/llama-3.3-70b, meta/llama-3.1-70b,
      nvidia/llama-3.3-nemotron-super-49b-v1 (retornavam HTTP 410)
    - Promovido mistralai/mistral-nemotron como 1º fallback
    - Removido parâmetro extra_body (causava HTTP 400 no DeepSeek)
    - Tratamento explícito para HTTP 410 (modelo descontinuado)

Campos de retorno de ask_concierge():
    {
        "answer":   str,
        "model":    str,
        "provider": str,
        "mode":     "conversation" | "reasoning",
        "image":    {"url": str, "caption": str} | None,
        "sources":  [{"label": str, "url": str}, ...],
        "usage":    {...} | None,
    }
"""

import os
import re
import time
import uuid
import logging
from typing import Any, Dict, List, Optional, Tuple

import requests


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=os.getenv("GED_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("ged.concierge")


# ============================================================
# CONFIG — NVIDIA
# ============================================================

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"


# ------------------------------------------------------------
# MODELOS PRIMÁRIOS (configuráveis via env)
# ------------------------------------------------------------
# Estes são os modelos "preferidos" para cada modo.
# Se falharem (timeout/permissão), a cadeia de fallback assume.
# ------------------------------------------------------------

KIMI_MODEL = os.getenv("NVIDIA_KIMI_MODEL", "moonshotai/kimi-k3")
DEEPSEEK_MODEL = os.getenv("NVIDIA_DEEPSEEK_MODEL", "deepseek-ai/deepseek-v4-pro-0813")


# ------------------------------------------------------------
# CADEIA DE FALLBACK (v3.3 — modelos ativos)
# ------------------------------------------------------------
# Ordem testada em Setembro/2026.
#
# 1. mistralai/mistral-nemotron  ← CONFIRMADO ativo (fallback principal)
# 2. meta/llama-3.3-70b-instruct ← se voltar a funcionar, ativa
# 3. demais modelos — alternativa progressiva
#
# Se um modelo retornar HTTP 410 (EOL), ele é pulado automaticamente.
# Você pode descobrir os modelos ativos em:
#     https://build.nvidia.com/explore/reasoning
# ------------------------------------------------------------

FALLBACK_CHAIN = [
    "mistralai/mistral-nemotron",
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-70b-instruct",
    "qwen/qwen2.5-72b-instruct",
    "nvidia/nemotron-4-340b-instruct",
    "mistralai/mistral-large-2-instruct",
]


# ============================================================
# API KEYS
# ============================================================
# Prioridade:
#   1. Variável de ambiente NVIDIA_API_KEY_KIMI / NVIDIA_API_KEY_DEEPSEEK
#   2. Fallback literal (apenas modo escolar — REMOVER em produção)
#
# A chave já inclui o prefixo "nvapi-". NÃO adicionar "Bearer ".
# ============================================================

KIMI_API_KEY = os.getenv(
    "NVIDIA_API_KEY_KIMI",
    "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",
)

DEEPSEEK_API_KEY = os.getenv(
    "NVIDIA_API_KEY_DEEPSEEK",
    "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",
)

if KIMI_API_KEY and KIMI_API_KEY.startswith("nvapi-"):
    logger.debug(
        "Kimi API key loaded (source: %s)",
        "env" if "NVIDIA_API_KEY_KIMI" in os.environ else "hardcoded-fallback",
    )
    if "NVIDIA_API_KEY_KIMI" not in os.environ:
        logger.warning("Using HARDCODED Kimi key. Move to .env before sharing this project.")


# ============================================================
# PARÂMETROS DE REQUEST
# ============================================================

# Timeout curto para feedback rápido. Se o modelo primário travar,
# o fallback entra rapidamente.
REQUEST_TIMEOUT = int(os.getenv("NVIDIA_REQUEST_TIMEOUT", "20"))
REQUEST_RETRIES = int(os.getenv("NVIDIA_REQUEST_RETRIES", "1"))
RETRY_BACKOFF_SECONDS = float(os.getenv("NVIDIA_RETRY_BACKOFF", "0.8"))

MAX_CONVERSATION_MESSAGES = 12
MAX_USER_MESSAGE_LENGTH = 2000
MAX_HISTORY_MESSAGE_LENGTH = 4000

DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_P = 0.95
DEFAULT_MAX_TOKENS = 4096
DEFAULT_SEED = 42

MAX_SOURCES = 3


# ============================================================
# SYSTEM PROMPT
# ============================================================

GED_SYSTEM_PROMPT = """
You are GED Concierge, the official virtual travel assistant of GED Travel
Agency, an educational school project created by Geovana, Edgar, and Aline.

============================================================
LANGUAGE POLICY (VERY IMPORTANT)
============================================================

1. DEFAULT LANGUAGE: ENGLISH. Always reply in English unless the user
   clearly writes in another language.
2. SECONDARY: FRENCH. If the user writes in French, reply in French.
3. OTHER LANGUAGES: reply in the user's language (Portuguese, Spanish, German…).
4. If the user explicitly requests a language, honor it.
5. Never mix languages within the same reply.

============================================================
IDENTITY
============================================================

You are a specialized Canadian travel concierge — not a generic chatbot.

Personality:
- intelligent, warm, sophisticated, practical
- concise when possible, detailed when useful
- professional and natural
- confident, but honest about what you don't know

Avoid sounding robotic. Avoid filler. Be genuinely useful.

============================================================
GEOGRAPHIC SCOPE
============================================================

You focus on CANADA: provinces, territories, cities, neighborhoods,
attractions, hotels, flights, transportation, events, seasons,
itineraries, and travel packages.

If a user asks about another country, briefly acknowledge it and pivot
to a relevant Canadian alternative.

============================================================
TRUTHFULNESS — CRITICAL
============================================================

NEVER invent: hotels, flights, prices, availability, event dates,
reservations, discounts (max 25%), ratings, statistics.

If reliable GED data isn't available, say so clearly.
Never claim a real reservation was made — this is an educational demo.

============================================================
STYLE
============================================================

- Short paragraphs.
- Bold key destinations with **markdown**.
- Use short bullet lists or numbered steps when helpful.
- For itineraries, use Day 1 / Day 2 / Day 3 format.
- Recommend based on the user's interests — not assumptions.

============================================================
CORE OBJECTIVE
============================================================

Understand the traveler first. Then recommend.
Think like a sophisticated Canadian travel concierge.
""".strip()


# ============================================================
# CURATED SOURCES
# ============================================================

CURATED_SOURCES: Dict[str, List[Dict[str, str]]] = {
    # ---------- Cities ----------
    "toronto": [
        {"label": "Destination Toronto", "url": "https://www.destinationtoronto.com/"},
        {"label": "City of Toronto", "url": "https://www.toronto.ca/explore-enjoy/"},
    ],
    "vancouver": [
        {"label": "Destination Vancouver", "url": "https://www.destinationvancouver.com/"},
        {"label": "Tourism BC", "url": "https://www.hellobc.com/"},
    ],
    "montréal": [
        {"label": "Tourisme Montréal", "url": "https://www.mtl.org/en"},
        {"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"},
    ],
    "montreal": [
        {"label": "Tourisme Montréal", "url": "https://www.mtl.org/en"},
        {"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"},
    ],
    "québec city": [
        {"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"},
        {"label": "Ville de Québec", "url": "https://www.ville.quebec.qc.ca/en/"},
    ],
    "quebec city": [
        {"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"},
        {"label": "Ville de Québec", "url": "https://www.ville.quebec.qc.ca/en/"},
    ],
    "old québec": [{"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"}],
    "old quebec": [{"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"}],
    "ottawa": [
        {"label": "Ottawa Tourism", "url": "https://ottawatourism.ca/en"},
        {"label": "Parliament of Canada", "url": "https://www.ourcommons.ca/"},
    ],
    "calgary": [
        {"label": "Tourism Calgary", "url": "https://www.visitcalgary.com/"},
        {"label": "Travel Alberta", "url": "https://www.travelalberta.com/"},
    ],
    "edmonton": [
        {"label": "Explore Edmonton", "url": "https://exploreedmonton.com/"},
        {"label": "Travel Alberta", "url": "https://www.travelalberta.com/"},
    ],
    "banff": [
        {"label": "Banff & Lake Louise Tourism", "url": "https://www.banfflakelouise.com/"},
        {"label": "Parks Canada — Banff", "url": "https://parks.canada.ca/pn-np/ab/banff"},
    ],
    "jasper": [
        {"label": "Parks Canada — Jasper", "url": "https://parks.canada.ca/pn-np/ab/jasper"},
        {"label": "Travel Alberta", "url": "https://www.travelalberta.com/"},
    ],
    "whistler": [
        {"label": "Whistler.com", "url": "https://www.whistler.com/"},
        {"label": "Tourism BC", "url": "https://www.hellobc.com/"},
    ],
    "victoria": [
        {"label": "Tourism Victoria", "url": "https://www.tourismvictoria.com/"},
        {"label": "Tourism BC", "url": "https://www.hellobc.com/"},
    ],
    "halifax": [
        {"label": "Discover Halifax", "url": "https://www.discoverhalifaxns.com/"},
        {"label": "Nova Scotia Tourism", "url": "https://novascotia.com/"},
    ],
    "winnipeg": [{"label": "Tourism Winnipeg", "url": "https://www.tourismwinnipeg.com/"}],
    "churchill": [{"label": "Travel Manitoba — Churchill", "url": "https://www.travelmanitoba.com/churchill/"}],
    "st. john's": [{"label": "Newfoundland & Labrador Tourism", "url": "https://www.newfoundlandlabrador.com/"}],
    "charlottetown": [{"label": "Tourism PEI", "url": "https://www.tourismpei.com/"}],
    "yellowknife": [{"label": "Spectacular NWT", "url": "https://spectacularnwt.com/"}],
    "whitehorse": [{"label": "Travel Yukon", "url": "https://www.travelyukon.com/"}],
    "iqaluit": [{"label": "Travel Nunavut", "url": "https://travelnunavut.ca/"}],
    "niagara": [{"label": "Niagara Falls Tourism", "url": "https://www.niagarafallstourism.com/"}],
    "kelowna": [{"label": "Tourism Kelowna", "url": "https://www.tourismkelowna.com/"}],
    "tofino": [{"label": "Tourism Tofino", "url": "https://www.tourismtofino.com/"}],
    # ---------- Provinces / Territories ----------
    "british columbia": [{"label": "Tourism BC", "url": "https://www.hellobc.com/"}],
    "alberta": [{"label": "Travel Alberta", "url": "https://www.travelalberta.com/"}],
    "ontario": [{"label": "Destination Ontario", "url": "https://www.destinationontario.com/"}],
    "québec": [{"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"}],
    "quebec": [{"label": "Bonjour Québec", "url": "https://www.bonjourquebec.com/en"}],
    "nova scotia": [{"label": "Nova Scotia Tourism", "url": "https://novascotia.com/"}],
    "new brunswick": [{"label": "Tourism New Brunswick", "url": "https://tourismnewbrunswick.ca/"}],
    "manitoba": [{"label": "Travel Manitoba", "url": "https://www.travelmanitoba.com/"}],
    "saskatchewan": [{"label": "Tourism Saskatchewan", "url": "https://www.tourismsaskatchewan.com/"}],
    "newfoundland": [{"label": "Newfoundland & Labrador Tourism", "url": "https://www.newfoundlandlabrador.com/"}],
    "prince edward island": [{"label": "Tourism PEI", "url": "https://www.tourismpei.com/"}],
    "pei": [{"label": "Tourism PEI", "url": "https://www.tourismpei.com/"}],
    "yukon": [{"label": "Travel Yukon", "url": "https://www.travelyukon.com/"}],
    "northwest territories": [{"label": "Spectacular NWT", "url": "https://spectacularnwt.com/"}],
    "nunavut": [{"label": "Travel Nunavut", "url": "https://travelnunavut.ca/"}],
    # ---------- Canada (fallback) ----------
    "canada": [
        {"label": "Destination Canada", "url": "https://www.destinationcanada.com/en"},
        {"label": "Travel Canada (Gov)", "url": "https://travel.gc.ca/"},
    ],
}

# Chaves mais longas vencem (mais específicas primeiro).
_SOURCES_ORDERED: List[Tuple[str, List[Dict[str, str]]]] = sorted(
    CURATED_SOURCES.items(),
    key=lambda kv: (-len(kv[0]), kv[0]),
)


# ============================================================
# FALLBACK MESSAGES — offline, em múltiplos idiomas
# ============================================================

OFFLINE_FALLBACK: Dict[str, str] = {
    "en": "I couldn't reach the GED Concierge service right now. Please try again in a moment.",
    "fr": "Je n'ai pas pu joindre le service GED Concierge pour le moment. Veuillez réessayer dans un instant.",
    "pt": "Não consegui contactar o GED Concierge agora. Tente novamente em instantes.",
    "es": "No pude contactar al GED Concierge en este momento. Inténtalo de nuevo en un momento.",
}

_LANG_MARKERS = {
    "pt": ("não", "nao", "estou", "você", "voce", "quero", "como", "qual",
           "melhor", "viagem", "onde", "quando", "preciso"),
    "es": ("cómo", "como", "quiero", "mejor", "viaje", "cuál", "cual",
           "dónde", "donde", "cuándo", "cuando", "necesito"),
    "fr": ("je ", "vous", "voulez", "quel", "quelle", "meilleur", "voyage",
           "où ", "quand", "comment", "j'aimerais"),
    "en": ("what ", "where ", "which ", "best ", "how ", "want ", "trip ",
           "when ", "should "),
}


def detect_language(message: str) -> str:
    """Detecção simples de idioma por marcadores comuns. Retorna 'en' por padrão."""
    if not isinstance(message, str) or not message:
        return "en"
    text = " " + message.lower() + " "
    scores = {lang: sum(1 for m in markers if m in text)
              for lang, markers in _LANG_MARKERS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "en"


def _offline_answer(message: str) -> str:
    return OFFLINE_FALLBACK.get(detect_language(message), OFFLINE_FALLBACK["en"])


# ============================================================
# IMAGE INTENT + GENERATOR
# ============================================================

_IMAGE_FALLBACKS: Dict[str, str] = {
    "toronto":     "https://images.unsplash.com/photo-1517090504586-fde19ea6066f?auto=format&fit=crop&w=1000&q=80",
    "vancouver":   "https://images.unsplash.com/photo-1559511260-66a654ae982a?auto=format&fit=crop&w=1000&q=80",
    "montreal":    "https://images.unsplash.com/photo-1519178614-68673b201f36?auto=format&fit=crop&w=1000&q=80",
    "québec":      "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1000&q=80",
    "quebec":      "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1000&q=80",
    "ottawa":      "https://images.unsplash.com/photo-1517935706615-2717063c2225?auto=format&fit=crop&w=1000&q=80",
    "calgary":     "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1000&q=80",
    "edmonton":    "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1000&q=80",
    "banff":       "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1000&q=80",
    "jasper":      "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1000&q=80",
    "whistler":    "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?auto=format&fit=crop&w=1000&q=80",
    "victoria":    "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1000&q=80",
    "halifax":     "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80",
    "winnipeg":    "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1000&q=80",
    "yellowknife": "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?auto=format&fit=crop&w=1000&q=80",
    "niagara":     "https://images.unsplash.com/photo-1433086966358-54859d0ed716?auto=format&fit=crop&w=1000&q=80",
    "rockies":     "https://images.unsplash.com/photo-1503614472-8c93d56e92ce?auto=format&fit=crop&w=1000&q=80",
    "nature":      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1000&q=80",
    "city":        "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=1000&q=80",
    "canada":      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1000&q=80",
    "default":     "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1000&q=80",
}

_IMAGE_INTENT_KEYWORDS = (
    "imagem", "image", "picture", "photo", "foto", "fotografia",
    "mostre", "mostrar", "show me", "show",
    "ver", "look", "veja", "voir", "montre", "montrez",
    "visualizar", "visualize", "visualise",
    "what does", "como é", "como e",
    "ilustre", "ilustração",
)

_PLACE_REGEX = re.compile(
    r"\b("
    r"Toronto|Vancouver|Montréal|Montreal|Ottawa|Calgary|Edmonton|"
    r"Québec|Quebec|Winnipeg|Halifax|Victoria|Banff|Jasper|Whistler|"
    r"Niagara|Yellowknife|Whitehorse|Iqaluit|Churchill|Kelowna|Tofino|"
    r"Canada|Canadá|Rockies|Rocky|"
    r"British Columbia|Ontario|Alberta|Nova Scotia|Nova Escócia|"
    r"Manitoba|Saskatchewan|Newfoundland|PEI|Prince Edward Island|"
    r"Yukon|Nunavut|Northwest Territories"
    r")\b",
    re.IGNORECASE,
)


def detect_image_intent(message: str) -> Optional[str]:
    """Retorna termo de busca se o usuário pediu imagem; senão None."""
    if not isinstance(message, str) or not message:
        return None

    text = message.lower()
    if not any(kw in text for kw in _IMAGE_INTENT_KEYWORDS):
        return None

    places = _PLACE_REGEX.findall(message)
    if places:
        return places[0].strip()

    if "canada" in text or "canadá" in text:
        return "Canada"
    if "nature" in text or "natureza" in text:
        return "Canadian nature"
    if "city" in text or "cidade" in text:
        return "Canadian city"
    if "montanha" in text or "mountain" in text:
        return "Canadian Rockies"
    if "praia" in text or "beach" in text:
        return "Canadian coast"

    return "Canada"


def generate_image_url(query: str) -> Dict[str, str]:
    """Gera URL do Unsplash para o termo pesquisado."""
    if not isinstance(query, str) or not query.strip():
        query = "Canada"

    key = query.strip().lower()
    url = _IMAGE_FALLBACKS.get(key)

    if not url:
        # Match parcial — "old montreal" → "montreal"
        for k, v in _IMAGE_FALLBACKS.items():
            if k != "default" and k in key:
                url = v
                break

    if not url:
        url = _IMAGE_FALLBACKS["default"]

    return {"url": url, "caption": f"{query} — via Unsplash"}


# ============================================================
# SOURCES DETECTION
# ============================================================

def detect_sources(
    message: str,
    answer: str = "",
    max_sources: int = MAX_SOURCES,
) -> List[Dict[str, str]]:
    """Detecta tópicos e devolve fontes curadas (dedup por URL)."""
    if not message and not answer:
        return []

    text = ((message or "") + " " + (answer or "")).lower()
    found: List[Dict[str, str]] = []
    seen_urls: set = set()

    for keyword, sources in _SOURCES_ORDERED:
        if keyword not in text:
            continue
        for src in sources:
            url = src.get("url")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            found.append({"label": src["label"], "url": url})
            if len(found) >= max_sources:
                return found

    return found


# ============================================================
# MODEL ROUTER — word-boundary (não substring)
# ============================================================

_COMPLEX_KEYWORDS = (
    # EN
    "plan", "planning", "itinerary", "compare", "comparison",
    "best option", "best trip", "budget", "optimize",
    "multiple cities", "road trip", "family trip",
    "days", "cost", "cheaper", "value",
    "pros and cons", "which should i choose",
    # FR
    "itinéraire", "comparer", "meilleur voyage", "plusieurs villes",
    "voyage en famille", "jours", "coût", "moins cher", "valeur",
    "lequel choisir",
    # PT
    "itinerário", "comparar", "melhor viagem", "várias cidades",
    "dias", "custo", "mais barato", "valor", "qual devo escolher",
    # ES
    "itinerario", "comparar", "mejor viaje", "varias ciudades",
    "días", "costo", "más barato", "valor", "cuál elegir",
)

_COMPLEX_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _COMPLEX_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


def choose_model(message: str) -> Dict[str, str]:
    """Escolhe o modelo com base na complexidade da mensagem."""
    text = message or ""
    if _COMPLEX_PATTERN.search(text):
        return {"model": DEEPSEEK_MODEL, "provider": "NVIDIA NIM", "mode": "reasoning"}
    return {"model": KIMI_MODEL, "provider": "NVIDIA NIM", "mode": "conversation"}


def get_api_key(model: str) -> Optional[str]:
    """Retorna a API key apropriada para o modelo."""
    if model == KIMI_MODEL:
        return KIMI_API_KEY
    if model == DEEPSEEK_MODEL:
        return DEEPSEEK_API_KEY
    # Modelos de fallback usam a mesma chave do Kimi (conta NVIDIA)
    return KIMI_API_KEY


# ============================================================
# CLEANING + DEDUP
# ============================================================

def clean_message(content: Any, max_length: int) -> str:
    if not isinstance(content, str):
        return ""
    return content.strip()[:max_length]


def clean_conversation(conversation: Any) -> List[Dict[str, str]]:
    if not isinstance(conversation, list):
        return []
    cleaned: List[Dict[str, str]] = []
    for item in conversation[-MAX_CONVERSATION_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"}:
            continue
        content = clean_message(content, MAX_HISTORY_MESSAGE_LENGTH)
        if not content:
            continue
        cleaned.append({"role": role, "content": content})
    return cleaned


def dedupe_last_user(conversation: List[Dict[str, str]], message: str) -> List[Dict[str, str]]:
    """
    Remove a última mensagem se for idêntica à mensagem atual.
    O frontend atual (help.html) faz state.history.push() antes de
    chamar /api/concierge, então a mensagem aparece duas vezes.
    """
    if not conversation:
        return conversation
    last = conversation[-1]
    if last.get("role") == "user" and last.get("content", "").strip() == message.strip():
        return conversation[:-1]
    return conversation


# ============================================================
# NVIDIA CALL
# ============================================================

def _build_payload_messages(
    messages: List[Dict[str, Any]],
    image_url: Optional[str],
) -> List[Dict[str, Any]]:
    """Se houver imagem, converte a última mensagem em formato multimodal."""
    payload_messages = [dict(m) for m in messages]

    if image_url and payload_messages:
        last = payload_messages[-1]
        user_text = last.get("content", "")
        if isinstance(user_text, str):
            payload_messages[-1] = {
                "role": last.get("role", "user"),
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }

    return payload_messages


def _build_payload(
    model: str,
    messages: List[Dict[str, Any]],
    image_url: Optional[str],
) -> Dict[str, Any]:
    """
    Monta o payload para a NVIDIA NIM.

    IMPORTANTE (v3.3): removido o parâmetro `extra_body`, que causava
    HTTP 400 em modelos que não o suportam (DeepSeek V4 Pro).
    """
    payload: Dict[str, Any] = {
        "model": model,
        "messages": _build_payload_messages(messages, image_url),
        "temperature": DEFAULT_TEMPERATURE,
        "top_p": DEFAULT_TOP_P,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "seed": DEFAULT_SEED,
        "stream": False,
    }

    # Parâmetro específico apenas do Kimi — é suportado oficialmente.
    if model == KIMI_MODEL:
        payload["reasoning_effort"] = "low"

    return payload


def _extract_answer(data: Dict[str, Any]) -> str:
    """Extrai o texto da resposta, cobrindo formatos str, list e reasoning_content."""
    try:
        message = data["choices"][0]["message"]
        content = message.get("content", "")

        if isinstance(content, list):
            answer = "".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            ).strip()
        else:
            answer = (content or "").strip()

        if not answer and isinstance(message.get("reasoning_content"), str):
            answer = message["reasoning_content"].strip()

        return answer
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError("Unexpected response format from NVIDIA") from e


def call_nvidia(
    model: str,
    messages: List[Dict[str, Any]],
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Chama a NVIDIA NIM com retry em erros transientes.
    Erros HTTP são reportados com detalhes (status code + mensagem).
    """
    api_key = get_api_key(model)
    if not api_key:
        raise RuntimeError(f"No API key configured for model: {model}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    payload = _build_payload(model, messages, image_url)
    request_id = uuid.uuid4().hex[:8]

    logger.info(
        "[%s] → NVIDIA: model=%s, messages=%d, image=%s",
        request_id, model, len(payload["messages"]),
        "yes" if image_url else "no",
    )

    last_error: Optional[Exception] = None

    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            response = requests.post(
                NVIDIA_BASE_URL,
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.exceptions.Timeout as e:
            last_error = e
            logger.warning("[%s] Timeout (attempt %d/%d)",
                           request_id, attempt, REQUEST_RETRIES)
            if attempt < REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue
            raise RuntimeError("NVIDIA request timed out") from e
        except requests.exceptions.RequestException as e:
            last_error = e
            logger.warning("[%s] Request error (attempt %d/%d): %s",
                           request_id, attempt, REQUEST_RETRIES, e)
            if attempt < REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue
            raise RuntimeError(f"NVIDIA request failed: {e}") from e

        # Retry para 5xx e 429
        if response.status_code >= 500 or response.status_code == 429:
            logger.warning(
                "[%s] NVIDIA HTTP %s (attempt %d/%d): %s",
                request_id, response.status_code, attempt, REQUEST_RETRIES,
                response.text[:300],
            )
            if attempt < REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue

        if not response.ok:
            # Erros específicos com pistas úteis
            status = response.status_code
            detail = response.text[:400]

            if status == 401:
                raise RuntimeError("NVIDIA 401 Unauthorized — API key inválida")
            if status == 403:
                raise RuntimeError("NVIDIA 403 Forbidden — conta sem permissão para este modelo")
            if status == 404:
                raise RuntimeError(f"NVIDIA 404 — modelo '{model}' não existe")
            if status == 410:
                # Modelo descontinuado (End of Life) — não vale retentar
                raise RuntimeError(f"NVIDIA 410 — modelo '{model}' foi descontinuado (EOL)")
            if status == 429:
                raise RuntimeError("NVIDIA 429 — rate limit atingido")

            logger.error("[%s] NVIDIA HTTP %s: %s", request_id, status, detail)
            raise RuntimeError(f"NVIDIA API returned HTTP {status}")

        try:
            data = response.json()
        except ValueError as e:
            logger.error("[%s] Invalid JSON: %s", request_id, response.text[:300])
            raise RuntimeError("NVIDIA returned invalid JSON") from e

        answer = _extract_answer(data)
        if not answer:
            raise RuntimeError("NVIDIA returned an empty answer")

        logger.info("[%s] ← NVIDIA OK: model=%s, answer_len=%d",
                    request_id, model, len(answer))

        return {
            "answer": answer,
            "model": model,
            "provider": "NVIDIA NIM",
            "usage": data.get("usage", {}),
        }

    raise RuntimeError(
        f"NVIDIA request failed after {REQUEST_RETRIES} attempts: {last_error}"
    )


def call_nvidia_with_fallback(
    primary_model: str,
    messages: List[Dict[str, Any]],
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Tenta o modelo primário. Se falhar (timeout/401/403/404/410/429),
    tenta os modelos da cadeia de fallback em ordem.

    Retorna o primeiro resultado bem-sucedido.
    Levanta RuntimeError se TODOS falharem.
    """
    tried: List[str] = []
    errors: List[str] = []

    # 1. Tenta o primário
    try:
        return call_nvidia(primary_model, messages, image_url=image_url)
    except Exception as e:
        tried.append(primary_model)
        errors.append(f"{primary_model}: {e}")
        logger.warning(
            "Modelo primário '%s' falhou (%s). Tentando fallbacks…",
            primary_model, e,
        )

    # 2. Tenta a cadeia de fallback
    for fallback_model in FALLBACK_CHAIN:
        if fallback_model in tried:
            continue
        tried.append(fallback_model)
        try:
            result = call_nvidia(fallback_model, messages, image_url=image_url)
            # Avisa que caiu no fallback
            result["_fallback_used"] = True
            result["_fallback_from"] = primary_model
            logger.info(
                "Fallback bem-sucedido: '%s' respondeu (era '%s')",
                fallback_model, primary_model,
            )
            return result
        except Exception as e:
            errors.append(f"{fallback_model}: {e}")
            logger.warning("Fallback '%s' também falhou: %s", fallback_model, e)

    # 3. Todos falharam
    joined = " | ".join(errors)
    raise RuntimeError(
        f"Todos os {len(tried)} modelos falharam. Detalhes: {joined}"
    )


# ============================================================
# DIAGNÓSTICO
# ============================================================

def diagnose_connection() -> Dict[str, Any]:
    """
    Testa a conexão com cada modelo da cadeia de fallback.
    Retorna um relatório com o status de cada um.
    """
    test_message = [
        {"role": "system", "content": "You are a test."},
        {"role": "user", "content": "Say OK."},
    ]

    models_to_test = [KIMI_MODEL, DEEPSEEK_MODEL] + FALLBACK_CHAIN
    seen = set()
    unique_models = []
    for m in models_to_test:
        if m not in seen:
            seen.add(m)
            unique_models.append(m)

    report: Dict[str, Any] = {"results": [], "working": [], "failed": []}

    for model in unique_models:
        start = time.time()
        entry = {"model": model, "ok": False, "elapsed": 0.0, "error": None}
        try:
            result = call_nvidia(model, test_message)
            elapsed = time.time() - start
            entry["ok"] = True
            entry["elapsed"] = round(elapsed, 2)
            entry["preview"] = (result.get("answer") or "")[:60]
            report["working"].append(model)
        except Exception as e:
            elapsed = time.time() - start
            entry["elapsed"] = round(elapsed, 2)
            entry["error"] = str(e)
            report["failed"].append(model)
        report["results"].append(entry)

    return report


# ============================================================
# PUBLIC API
# ============================================================

def ask_concierge(
    message: str,
    conversation: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Ponto de entrada principal para o Flask."""
    # 1. Valida entrada
    message = clean_message(message, MAX_USER_MESSAGE_LENGTH)
    if not message:
        raise ValueError("Message cannot be empty")

    conversation = clean_conversation(conversation or [])

    # 2. Deduplica a última mensagem (bug do frontend)
    conversation = dedupe_last_user(conversation, message)

    # 3. Detecta intenção de imagem
    image_query = detect_image_intent(message)
    image_data = generate_image_url(image_query) if image_query else None

    # 4. Escolhe modelo
    routing = choose_model(message)
    model = routing["model"]

    # 5. Prepara mensagens
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": GED_SYSTEM_PROMPT}
    ]
    messages.extend(conversation)
    messages.append({"role": "user", "content": message})

    # 6. Chama NVIDIA (com imagem se aplicável) + fallback em cascata
    image_url_for_vision = (
        image_data["url"] if image_data and model == KIMI_MODEL else None
    )

    try:
        result = call_nvidia_with_fallback(
            model, messages, image_url=image_url_for_vision
        )
    except Exception as e:
        logger.exception("Todos os modelos NVIDIA falharam: %s", e)

        fallback_answer = _offline_answer(message)

        return {
            "answer": fallback_answer,
            "model": "GED Concierge (fallback)",
            "provider": "offline",
            "mode": routing["mode"],
            "image": image_data,
            "sources": detect_sources(message, fallback_answer),
            "usage": None,
            "error": str(e),
        }

    # 7. Detecta fontes
    sources = detect_sources(message, result["answer"])

    # 8. Monta resposta
    response: Dict[str, Any] = {
        "answer": result["answer"],
        "model": result["model"],
        "provider": result["provider"],
        "mode": routing["mode"],
        "image": image_data,
        "sources": sources,
    }

    if "usage" in result:
        response["usage"] = result["usage"]

    # Informa se caiu no fallback
    if result.get("_fallback_used"):
        response["fallback_from"] = result.get("_fallback_from")

    return response


# ============================================================
# DIRECT TEST / DIAGNÓSTICO
# ============================================================

if __name__ == "__main__":
    print()
    print("=" * 62)
    print("  GED CONCIERGE — DIAGNÓSTICO v3.3")
    print("=" * 62)
    print(f"  Kimi K3 key      : {'OK' if KIMI_API_KEY else 'MISSING'}")
    print(f"  DeepSeek key     : {'OK' if DEEPSEEK_API_KEY else 'MISSING'}")
    print(f"  Timeout          : {REQUEST_TIMEOUT}s por modelo")
    print(f"  Retries          : {REQUEST_RETRIES} por modelo")
    print(f"  Modelo primário  : {KIMI_MODEL}")
    print(f"  Modelo reasoning : {DEEPSEEK_MODEL}")
    print(f"  Fallback chain   :")
    for m in FALLBACK_CHAIN:
        print(f"     · {m}")
    print("=" * 62)

    # ---------- 1. Teste de conectividade com cada modelo ----------
    print("\n[1/2] Testando conectividade com cada modelo…\n")

    report = diagnose_connection()

    for entry in report["results"]:
        status = "OK" if entry["ok"] else "FAIL"
        model_short = entry["model"][:42]
        elapsed = f"{entry['elapsed']}s"
        print(f"  [{status:<4}] {model_short:<44} {elapsed:>7}")
        if not entry["ok"]:
            print(f"           → {entry['error'][:90]}")

    print()
    print(f"  Funcionando: {len(report['working'])}/{len(report['results'])}")
    if report["working"]:
        print(f"  Modelos disponíveis: {', '.join(report['working'])}")
    else:
        print("  NENHUM modelo disponível. Verifique:")
        print("     · Chave NVIDIA (build.nvidia.com)")
        print("     · Permissão 'Public API Endpoints' na conta")
        print("     · Conexão de internet / firewall")

    # ---------- 2. Teste end-to-end (só se algum modelo funciona) ----------
    if report["working"]:
        print("\n[2/2] Testando ask_concierge() end-to-end…\n")

        tests = [
            ("EN simple",  "What is the best time to visit Toronto?"),
            ("EN complex", "Plan a 5-day trip to Canada."),
            ("FR",         "Bonjour, je veux visiter Montréal en octobre."),
            ("PT image",   "Mostre imagens de Banff"),
        ]

        for label, msg in tests:
            print(f"  [{label}] {msg}")
            start = time.time()
            try:
                r = ask_concierge(msg, [])
                elapsed = time.time() - start
                print(f"     model   : {r['model']}")
                print(f"     mode    : {r['mode']}")
                print(f"     elapsed : {elapsed:.1f}s")
                print(f"     answer  : {r['answer'][:120]}…")
                if r.get("sources"):
                    print(f"     sources : {len(r['sources'])}")
                if r.get("image"):
                    print(f"     image   : {r['image']['url'][:60]}…")
            except Exception as e:
                print(f"     ERROR: {type(e).__name__}: {e}")
            print()
    else:
        print("\n[2/2] Pulado — nenhum modelo disponível.\n")

    print("=" * 62)
    print("  Diagnóstico concluído.")
    print("=" * 62)
    print()