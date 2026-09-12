"""
GED Travel Agency
GED Concierge AI Engine

Responsável por:
- Comunicar com NVIDIA NIM (Kimi K3 / DeepSeek V4 Pro)
- Decidir qual modelo usar
- Gerar imagens contextuais via Unsplash
- Retornar respostas estruturadas para o Flask

Fluxo:
    help.js → app.py → concierge.py → NVIDIA NIM
"""

import os
import logging
import re
from typing import Any, Dict, List, Optional

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
# CONFIGURAÇÃO NVIDIA
# ============================================================

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

KIMI_MODEL = os.getenv("NVIDIA_KIMI_MODEL", "moonshotai/kimi-k3")
DEEPSEEK_MODEL = os.getenv("NVIDIA_DEEPSEEK_MODEL", "deepseek-ai/deepseek-v4-pro-0813")


# ============================================================
# CHAVES DE API — CORRIGIDO
# ============================================================
# Ordem de prioridade:
#   1. Variável de ambiente (produção / CI)
#   2. Fallback literal (demo educacional — projeto escolar)
#
# IMPORTANTE:
# A chave NVIDIA já inclui o prefixo "nvapi-".
# NÃO inclua "Bearer " no valor; o header é montado depois.
# ============================================================

KIMI_API_KEY = os.getenv(
    "NVIDIA_API_KEY_KIMI",
    "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",
)

DEEPSEEK_API_KEY = os.getenv(
    "NVIDIA_API_KEY_DEEPSEEK",
    "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",
)


# ============================================================
# PARÂMETROS DE REQUEST
# ============================================================

REQUEST_TIMEOUT = int(os.getenv("NVIDIA_REQUEST_TIMEOUT", "60"))
MAX_CONVERSATION_MESSAGES = 12
MAX_USER_MESSAGE_LENGTH = 2000
MAX_HISTORY_MESSAGE_LENGTH = 4000

DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_P = 0.95
DEFAULT_MAX_TOKENS = 4096       # suficiente para travel chat; 16k é lento demais
DEFAULT_SEED = 42


# ============================================================
# SYSTEM PROMPT — English primary, French secondary
# ============================================================

GED_SYSTEM_PROMPT = """
You are GED Concierge, the official virtual travel assistant of GED Travel
Agency, an educational school project created by Geovana, Edgar, and Aline.

============================================================
LANGUAGE POLICY (VERY IMPORTANT)
============================================================

1. DEFAULT LANGUAGE: ENGLISH.
   Always reply in English unless the user clearly writes in another
   language.

2. SECONDARY LANGUAGE: FRENCH.
   If the user writes in French, reply in French naturally.

3. OTHER LANGUAGES: only if the user writes in them.
   - Portuguese → reply in Portuguese
   - Spanish    → reply in Spanish
   - German     → reply in German
   - etc.

4. If the user explicitly requests a language
   ("answer in French", "fale em português", "responde em espanhol"),
   honor the request.

5. Never mix languages within the same reply.

============================================================
IDENTITY
============================================================

You are not a generic chatbot — you are a specialized Canadian travel
concierge.

Personality:
- intelligent
- warm
- sophisticated
- practical
- concise when possible, detailed when useful
- professional and natural
- confident, but honest about what you don't know

Avoid sounding robotic. Avoid filler. Be genuinely useful.

============================================================
GEOGRAPHIC SCOPE
============================================================

You focus on CANADA: provinces, territories, cities, neighborhoods,
attractions, hotels, flights, transportation, events, sports, seasons,
itineraries, and travel packages.

If a user asks about another country, briefly acknowledge it and pivot
to a relevant Canadian alternative, since GED specializes in Canada.

============================================================
TRUTHFULNESS — CRITICAL
============================================================

NEVER invent:
- hotels, flights, prices, availability
- event dates, schedules, opening hours
- reservations, booking confirmations
- discounts (the maximum GED discount is 25%)
- ratings, awards, statistics

If reliable GED data isn't available, say so clearly.
Never claim a real reservation was made — this is an educational demo.

============================================================
STYLE
============================================================

- Use short paragraphs.
- Bold key destination names with **markdown**.
- When helpful, use short bullet lists or numbered steps.
- For itineraries, use a Day 1 / Day 2 / Day 3 format.
- Recommend based on the user's interests — not assumptions.
- Keep replies focused; avoid long generic lists.

============================================================
CORE OBJECTIVE
============================================================

Understand the traveler first. Then recommend.

Think like a sophisticated Canadian travel concierge,
not like a directory of tourist attractions.
""".strip()


# ============================================================
# GERADOR DE IMAGENS (Unsplash fallback)
# ============================================================

def detect_image_intent(message: str) -> Optional[str]:
    """Detecta se o usuário pediu uma imagem e extrai um termo de busca."""
    text = message.lower()
    visual_keywords = [
        "imagem", "image", "picture", "photo", "foto",
        "mostre", "show me", "ver", "look", "veja", "voir", "montre",
        "visualizar", "visualize", "what does",
    ]
    if not any(kw in text for kw in visual_keywords):
        return None

    places = re.findall(
        r"\b(Toronto|Vancouver|Montréal|Montreal|Ottawa|Calgary|Edmonton|"
        r"Québec|Quebec|Winnipeg|Halifax|Victoria|Banff|Whistler|"
        r"Niagara|Jasper|Yellowknife|Canada|Rockies|Rocky|"
        r"British Columbia|Ontario|Alberta|Nova Scotia|"
        r"Manitoba|Saskatchewan|Newfoundland|PEI|Prince Edward Island)\b",
        text,
        re.IGNORECASE,
    )
    if places:
        return places[0].capitalize()
    if "canada" in text or "canadá" in text:
        return "Canada"
    if "nature" in text or "natureza" in text:
        return "Canadian nature"
    if "city" in text or "cidade" in text:
        return "Canadian city"
    return "Canada"


def generate_image_url(query: str) -> Dict[str, str]:
    """Gera URL do Unsplash para o termo pesquisado."""
    fallback_images = {
        "toronto": "https://images.unsplash.com/photo-1517090504586-fde19ea6066f?auto=format&fit=crop&w=800&q=80",
        "vancouver": "https://images.unsplash.com/photo-1559511260-66a654ae982a?auto=format&fit=crop&w=800&q=80",
        "montreal": "https://images.unsplash.com/photo-1519178614-68673b201f36?auto=format&fit=crop&w=800&q=80",
        "banff": "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=800&q=80",
        "canada": "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80",
        "nature": "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80",
        "city": "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=800&q=80",
        "default": "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80",
    }
    key = query.lower()
    url = fallback_images.get(key, fallback_images["default"])
    return {"url": url, "caption": f"{query} — via Unsplash"}


# ============================================================
# ROTEADOR DE MODELO
# ============================================================

def choose_model(message: str) -> Dict[str, str]:
    """Decide qual modelo usar com base na complexidade da mensagem."""
    text = message.lower()
    complex_keywords = [
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
    ]
    if any(kw in text for kw in complex_keywords):
        return {
            "model": DEEPSEEK_MODEL,
            "provider": "NVIDIA NIM",
            "mode": "reasoning",
        }
    return {
        "model": KIMI_MODEL,
        "provider": "NVIDIA NIM",
        "mode": "conversation",
    }


# ============================================================
# SELEÇÃO DE CHAVE
# ============================================================

def get_api_key(model: str) -> Optional[str]:
    if model == KIMI_MODEL:
        return KIMI_API_KEY
    if model == DEEPSEEK_MODEL:
        return DEEPSEEK_API_KEY
    return None


# ============================================================
# LIMPEZA DE MENSAGENS
# ============================================================

def clean_message(content: Any, max_length: int) -> str:
    if not isinstance(content, str):
        return ""
    return content.strip()[:max_length]


def clean_conversation(conversation: Any) -> List[Dict[str, str]]:
    if not isinstance(conversation, list):
        return []
    cleaned = []
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


# ============================================================
# CHAMADA À NVIDIA — CORRIGIDO
# ============================================================

def call_nvidia(
    model: str,
    messages: List[Dict[str, str]],
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Envia requisição para a NVIDIA NIM.

    - Kimi K3: reasoning_effort = "low" (respostas rápidas)
    - DeepSeek V4 Pro: thinking = False
    - Se image_url for passada e o modelo suportar visão (Kimi),
      inclui a imagem no último turno do usuário.
    """
    api_key = get_api_key(model)
    if not api_key:
        raise RuntimeError(f"No API key configured for model: {model}")

    # A chave já contém "nvapi-" — adicionamos "Bearer " uma única vez.
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    # Constrói o payload final de mensagens
    payload_messages = list(messages)  # cópia defensiva

    if image_url:
        # Formato multimodal (Kimi suporta visão)
        last = payload_messages[-1]
        user_text = last["content"]
        payload_messages[-1] = {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }

    payload: Dict[str, Any] = {
        "model": model,
        "messages": payload_messages,
        "temperature": DEFAULT_TEMPERATURE,
        "top_p": DEFAULT_TOP_P,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "seed": DEFAULT_SEED,
        "stream": False,
    }

    # Parâmetros específicos por modelo
    if model == KIMI_MODEL:
        payload["reasoning_effort"] = "low"
    elif model == DEEPSEEK_MODEL:
        payload["extra_body"] = {
            "chat_template_kwargs": {
                "thinking": False,
            }
        }

    logger.info(
        "→ NVIDIA request: model=%s, messages=%d, image=%s",
        model, len(payload_messages), "yes" if image_url else "no",
    )

    try:
        response = requests.post(
            NVIDIA_BASE_URL,
            headers=headers,
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.exceptions.Timeout as e:
        logger.error("NVIDIA request timed out after %ss", REQUEST_TIMEOUT)
        raise RuntimeError("NVIDIA request timed out") from e
    except requests.exceptions.RequestException as e:
        logger.error("NVIDIA request failed: %s", e)
        raise RuntimeError(f"NVIDIA request failed: {e}") from e

    if not response.ok:
        logger.error(
            "NVIDIA HTTP %s: %s",
            response.status_code,
            response.text[:800],
        )
        raise RuntimeError(f"NVIDIA API returned HTTP {response.status_code}")

    try:
        data = response.json()
    except ValueError as e:
        logger.error("NVIDIA returned invalid JSON: %s", response.text[:300])
        raise RuntimeError("NVIDIA returned invalid JSON") from e

    try:
        answer = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        logger.error("Unexpected NVIDIA payload: %s", str(data)[:500])
        raise RuntimeError("Unexpected response format from NVIDIA") from e

    if not answer:
        raise RuntimeError("NVIDIA returned an empty answer")

    logger.info("← NVIDIA OK: model=%s, answer_len=%d", model, len(answer))

    return {
        "answer": answer,
        "model": model,
        "provider": "NVIDIA NIM",
        "usage": data.get("usage", {}),
    }


# ============================================================
# FUNÇÃO PRINCIPAL — ask_concierge
# ============================================================

def ask_concierge(
    message: str,
    conversation: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Ponto de entrada principal para o Flask.

    Retorna:
    {
        "answer": "...",
        "model": "...",
        "provider": "...",
        "mode": "...",
        "image": {"url": "...", "caption": "..."} | None
    }
    """
    # 1. Valida entrada
    message = clean_message(message, MAX_USER_MESSAGE_LENGTH)
    if not message:
        raise ValueError("Message cannot be empty")

    conversation = clean_conversation(conversation or [])

    # 2. Detecta intenção de imagem
    image_query = detect_image_intent(message)
    image_data = generate_image_url(image_query) if image_query else None

    # 3. Escolhe modelo
    routing = choose_model(message)
    model = routing["model"]

    # 4. Prepara mensagens para a NVIDIA
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": GED_SYSTEM_PROMPT}
    ]
    messages.extend(conversation)
    messages.append({"role": "user", "content": message})

    # 5. Chama NVIDIA (com imagem se aplicável)
    image_url_for_vision = (
        image_data["url"] if image_data and model == KIMI_MODEL else None
    )

    try:
        result = call_nvidia(model, messages, image_url=image_url_for_vision)
    except Exception as e:
        logger.exception("NVIDIA call failed: %s", e)
        # Fallback amigável — em inglês (idioma padrão)
        return {
            "answer": (
                "I couldn't reach the GED Concierge service right now. "
                "Please try again in a moment."
            ),
            "model": "GED Concierge (fallback)",
            "provider": "offline",
            "mode": routing["mode"],
            "image": image_data,
            "error": str(e),
        }

    # 6. Monta resposta final
    response: Dict[str, Any] = {
        "answer": result["answer"],
        "model": result["model"],
        "provider": result["provider"],
        "mode": routing["mode"],
        "image": image_data,
    }

    if "usage" in result:
        response["usage"] = result["usage"]

    return response


# ============================================================
# TESTE DIRETO (opcional)
# ============================================================

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("GED CONCIERGE — DIRECT TEST")
    print("=" * 60)
    print(f"Kimi K3 key    : {'✅ configured' if KIMI_API_KEY else '❌ missing'}")
    print(f"DeepSeek key   : {'✅ configured' if DEEPSEEK_API_KEY else '❌ missing'}")
    print()

    test_messages = [
        "What is the best time to visit Toronto?",
        "Plan a 5-day trip to Canada.",
        "Bonjour, je veux visiter Montréal en octobre.",
        "Mostre imagens de Banff",
    ]

    for msg in test_messages:
        print(f"\n📨 {msg}")
        try:
            r = ask_concierge(msg, [])
            print(f"   🤖 model  : {r['model']}")
            print(f"   🧠 mode   : {r['mode']}")
            print(f"   📝 answer : {r['answer'][:220]}...")
            if r.get("image"):
                print(f"   🖼️  image : {r['image']['url']}")
        except Exception as e:
            print(f"   ❌ {e}")
        print("-" * 50)