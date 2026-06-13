"""Capa de proveedores de IA para el CLI (equivalente a extension/providers.js).

Soporta Google (Gemini/Gemma), OpenAI, Anthropic (Claude) y cualquier API
compatible con OpenAI (OpenRouter, Groq, Together, Mistral, DeepSeek, xAI,
Ollama/LM Studio local…). Habla con todas por REST vía httpx, sin SDKs.

Configuración (de mayor a menor prioridad):
  1. Variables de entorno: JOB_AI_PROVIDER, JOB_AI_MODEL, JOB_AI_BASE_URL,
     JOB_AI_API_KEY, o la key específica del proveedor (ANTHROPIC_API_KEY,
     OPENAI_API_KEY, GOOGLE_API_KEY/GEMINI_API_KEY).
  2. Sección `ai:` de perfil.yaml (provider, model, base_url, api_key,
     temperature, max_tokens, json_mode, timeout).
  3. Valores por defecto (provider=anthropic, para no romper el flujo actual).

Las peticiones se hacen en streaming (SSE) y `timeout` (env JOB_AI_TIMEOUT o
ai.timeout, por defecto 180 s) es de INACTIVIDAD entre tokens, no un tope total:
mientras el modelo siga generando, la espera es indefinida.
"""
from __future__ import annotations
import os
import re
import json
import time
import httpx
import i18n
from i18n import t

# Errores transitorios del servidor del proveedor: merece la pena reintentar.
RETRY_STATUS = {500, 502, 503, 504}


class AIConfigError(Exception):
    """La IA no está configurada (falta key, modelo o base URL)."""


def _is_reasoning(model: str) -> bool:
    # Modelos de razonamiento de OpenAI (o1, o3, o4-mini…): API distinta.
    return bool(re.match(r"^o[1-9]", model or ""))


# Cada proveedor llama en STREAMING (Server-Sent Events): el servidor manda el
# texto token a token. `stream_body` arma el cuerpo con el flag de streaming y
# `stream_delta` extrae el trozo de texto de cada evento SSE ya parseado a dict.

# --- formato OpenAI Chat Completions (compartido por openai y custom) --------
def _openai_body(model, prompt, opts):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}]}
    if _is_reasoning(model):
        # o-series renombró max_tokens y no admite temperature != 1.
        body["max_completion_tokens"] = opts["max_tokens"]
    else:
        body["temperature"] = opts["temperature"]
        body["max_tokens"] = opts["max_tokens"]
    if opts.get("json_mode"):
        body["response_format"] = {"type": "json_object"}
    return body


def _openai_stream_body(model, prompt, opts):
    return {**_openai_body(model, prompt, opts), "stream": True}


def _openai_stream_delta(obj):
    try:
        return obj["choices"][0]["delta"].get("content") or ""
    except (KeyError, IndexError, TypeError):
        return ""


# --- formato Google (Gemini / Gemma) ----------------------------------------
def _google_body(model, prompt, opts):
    gc = {"temperature": opts["temperature"], "maxOutputTokens": opts["max_tokens"]}
    # Gemma no soporta responseMimeType (JSON mode); el prompt ya pide JSON.
    if not model.startswith("gemma"):
        gc["responseMimeType"] = "application/json"
    return {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gc}


def _google_stream_delta(obj):
    try:
        parts = obj["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return ""
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict))


# --- formato Anthropic (Claude) ---------------------------------------------
def _anthropic_body(model, prompt, opts):
    return {
        "model": model,
        "max_tokens": opts["max_tokens"],
        "temperature": opts["temperature"],
        "messages": [{"role": "user", "content": prompt}],
    }


def _anthropic_stream_body(model, prompt, opts):
    return {**_anthropic_body(model, prompt, opts), "stream": True}


def _anthropic_stream_delta(obj):
    # Los eventos de texto son content_block_delta con delta.type == text_delta.
    if obj.get("type") == "content_block_delta":
        return (obj.get("delta") or {}).get("text", "") or ""
    return ""


PROVIDERS = {
    # --------------------------------------------------------------- Google
    "google": {
        "label": "Google (Gemini / Gemma)",
        "env_keys": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
        "fixed_base_url": True,
        "default_base_url": "https://generativelanguage.googleapis.com/v1beta",
        "default_model": "gemini-3.5-flash",
        "json_mode_configurable": False,
        "headers": lambda key: {"Content-Type": "application/json", "x-goog-api-key": key},
        "stream_endpoint": lambda base, model: f"{base}/models/{model}:streamGenerateContent?alt=sse",
        "stream_body": _google_body,
        "stream_delta": _google_stream_delta,
    },
    # --------------------------------------------------------------- OpenAI
    "openai": {
        "label": "OpenAI (GPT)",
        "env_keys": ["OPENAI_API_KEY"],
        "fixed_base_url": True,
        "default_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "json_mode_configurable": True,
        "default_json_mode": True,
        "headers": lambda key: {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        "stream_endpoint": lambda base, model: f"{base}/chat/completions",
        "stream_body": _openai_stream_body,
        "stream_delta": _openai_stream_delta,
    },
    # ------------------------------------------------------------ Anthropic
    "anthropic": {
        "label": "Anthropic (Claude)",
        "env_keys": ["ANTHROPIC_API_KEY"],
        "fixed_base_url": True,
        "default_base_url": "https://api.anthropic.com/v1",
        "default_model": "claude-opus-4-8",  # conserva el comportamiento previo del CLI
        "json_mode_configurable": False,
        "headers": lambda key: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        "stream_endpoint": lambda base, model: f"{base}/messages",
        "stream_body": _anthropic_stream_body,
        "stream_delta": _anthropic_stream_delta,
    },
    # -------------------------------------------- compatible con OpenAI (libre)
    "custom": {
        "label": "Compatible con OpenAI (personalizado)",
        "env_keys": [],
        "fixed_base_url": False,
        "default_base_url": "",
        "default_model": "",
        "allow_empty_key": True,
        "json_mode_configurable": True,
        "default_json_mode": False,
        "headers": lambda key: (
            {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
            if key else {"Content-Type": "application/json"}
        ),
        "stream_endpoint": lambda base, model: f"{base}/chat/completions",
        "stream_body": _openai_stream_body,
        "stream_delta": _openai_stream_delta,
    },
}

DEFAULT_PROVIDER = "anthropic"


def resolve_ai_config(profile: dict) -> dict:
    """Resuelve la config efectiva desde entorno + perfil.yaml. Lanza
    AIConfigError si falta algo imprescindible (key, modelo, base URL)."""
    ai = (profile or {}).get("ai", {}) or {}
    provider = os.environ.get("JOB_AI_PROVIDER") or ai.get("provider") or DEFAULT_PROVIDER
    P = PROVIDERS.get(provider)
    if not P:
        raise AIConfigError(t("provider_unknown", provider=provider))

    key = os.environ.get("JOB_AI_API_KEY") or ai.get("api_key") or ""
    if not key:
        for env in P["env_keys"]:
            if os.environ.get(env):
                key = os.environ[env]
                break
    key = (key or "").strip()
    if not key and not P.get("allow_empty_key"):
        sep = " o " if i18n.lang() == "es" else " or "
        envs = sep.join(P["env_keys"]) or "JOB_AI_API_KEY"
        raise AIConfigError(t("missing_api_key", label=P['label'], envs=envs))

    model = (os.environ.get("JOB_AI_MODEL") or ai.get("model") or P["default_model"] or "").strip()
    if not model:
        raise AIConfigError(t("missing_model", label=P['label']))

    base = P["default_base_url"] if P["fixed_base_url"] else (
        os.environ.get("JOB_AI_BASE_URL") or ai.get("base_url") or ""
    )
    base = (base or "").rstrip("/")
    if not base:
        raise AIConfigError(t("missing_base_url"))

    if P.get("json_mode_configurable"):
        json_mode = bool(ai.get("json_mode", P.get("default_json_mode", False)))
    else:
        json_mode = False

    return {
        "provider": provider,
        "P": P,
        "api_key": key,
        "model": model,
        "base_url": base,
        "temperature": float(ai.get("temperature", 0.4)),
        "max_tokens": int(ai.get("max_tokens", 8192)),  # igual que la extensión
        "json_mode": json_mode,
        "timeout": float(os.environ.get("JOB_AI_TIMEOUT") or ai.get("timeout") or 180.0),
    }


def call_provider(cfg: dict, prompt: str, timeout: float | None = None, tries: int = 3) -> str:
    """Llama al proveedor en STREAMING y acumula la respuesta token a token.

    `timeout` es de INACTIVIDAD (segundos), no un tope total: mientras el modelo
    siga emitiendo tokens la petición se mantiene viva indefinidamente; solo se
    aborta si el servidor deja de enviar datos durante ese tiempo (modelo
    colgado). Reintenta los errores transitorios del servidor (5xx) con backoff.
    Si no se indica timeout, usa el de la config (cfg['timeout'])."""
    if timeout is None:
        timeout = cfg.get("timeout", 180.0)
    P = cfg["P"]
    url = P["stream_endpoint"](cfg["base_url"], cfg["model"])
    headers = P["headers"](cfg["api_key"])
    delta = P["stream_delta"]
    body = P["stream_body"](cfg["model"], prompt, {
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
        "json_mode": cfg["json_mode"],
    })
    # connect: tope corto para fallar rápido si el servidor es inalcanzable.
    # read: inactividad entre tokens (el "indefinido mientras funcione").
    to = httpx.Timeout(timeout, connect=min(timeout, 30.0))
    for i in range(tries):
        with httpx.stream("POST", url, headers=headers, json=body, timeout=to) as r:
            if r.status_code in RETRY_STATUS and i < tries - 1:
                wait = 1.0 * (i + 1)  # 1s, 2s…
                print(t("provider_retry", model=cfg['model'], status=r.status_code,
                        n=i + 1, total=tries - 1, wait=wait))
                time.sleep(wait)
                continue
            if r.status_code >= 400:
                r.read()  # consume el cuerpo para poder leer el mensaje de error
                r.raise_for_status()
            chunks = []
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    obj = json.loads(payload)
                except ValueError:
                    continue  # keep-alives / fragmentos no-JSON
                chunks.append(delta(obj))
            text = "".join(chunks)
            if not text:
                raise RuntimeError(t("provider_empty", model=cfg["model"]))
            return text
    raise RuntimeError("unreachable")  # el último intento siempre sale por return/raise


def extract_json_object(text: str) -> dict:
    """Extrae el objeto JSON de la respuesta del modelo: quita las vallas
    markdown (```json … ```) y recorta al {…} exterior. Lanza ValueError si la
    respuesta no contiene un objeto JSON reconocible."""
    clean = re.sub(r"```(?:json)?", "", text or "")
    a, b = clean.find("{"), clean.rfind("}")
    if a < 0 or b <= a:
        raise ValueError(t("provider_no_json", start=(text or "").strip()[:120]))
    return json.loads(clean[a:b + 1])
