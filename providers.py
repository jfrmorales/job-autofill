"""Capa de proveedores de IA para el CLI (equivalente a extension/providers.js).

Soporta Google (Gemini/Gemma), OpenAI, Anthropic (Claude) y cualquier API
compatible con OpenAI (OpenRouter, Groq, Together, Mistral, DeepSeek, xAI,
Ollama/LM Studio local…). Habla con todas por REST vía httpx, sin SDKs.

Configuración (de mayor a menor prioridad):
  1. Variables de entorno: JOB_AI_PROVIDER, JOB_AI_MODEL, JOB_AI_BASE_URL,
     JOB_AI_API_KEY, o la key específica del proveedor (ANTHROPIC_API_KEY,
     OPENAI_API_KEY, GOOGLE_API_KEY/GEMINI_API_KEY).
  2. Sección `ai:` de perfil.yaml (provider, model, base_url, api_key,
     temperature, max_tokens, json_mode).
  3. Valores por defecto (provider=anthropic, para no romper el flujo actual).
"""
from __future__ import annotations
import os
import re
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


def _openai_extract(data):
    txt = data["choices"][0]["message"]["content"]
    if not txt:
        raise RuntimeError(f"respuesta vacía (finish={data['choices'][0].get('finish_reason')})")
    return txt


PROVIDERS = {
    # --------------------------------------------------------------- Google
    "google": {
        "label": "Google (Gemini / Gemma)",
        "env_keys": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
        "fixed_base_url": True,
        "default_base_url": "https://generativelanguage.googleapis.com/v1beta",
        "default_model": "gemini-3.5-flash",
        "json_mode_configurable": False,
        "endpoint": lambda base, model: f"{base}/models/{model}:generateContent",
        "headers": lambda key: {"Content-Type": "application/json", "x-goog-api-key": key},
        "body": lambda model, prompt, opts: {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": opts["temperature"],
                "maxOutputTokens": opts["max_tokens"],
                **({} if model.startswith("gemma") else {"responseMimeType": "application/json"}),
            },
        },
        "extract": lambda data: "".join(
            p.get("text", "") for p in data["candidates"][0]["content"]["parts"]
        ),
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
        "endpoint": lambda base, model: f"{base}/chat/completions",
        "headers": lambda key: {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        "body": _openai_body,
        "extract": _openai_extract,
    },
    # ------------------------------------------------------------ Anthropic
    "anthropic": {
        "label": "Anthropic (Claude)",
        "env_keys": ["ANTHROPIC_API_KEY"],
        "fixed_base_url": True,
        "default_base_url": "https://api.anthropic.com/v1",
        "default_model": "claude-opus-4-8",  # conserva el comportamiento previo del CLI
        "json_mode_configurable": False,
        "endpoint": lambda base, model: f"{base}/messages",
        "headers": lambda key: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        "body": lambda model, prompt, opts: {
            "model": model,
            "max_tokens": opts["max_tokens"],
            "temperature": opts["temperature"],
            "messages": [{"role": "user", "content": prompt}],
        },
        "extract": lambda data: "".join(
            b.get("text", "") for b in data["content"] if b.get("type") == "text"
        ),
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
        "endpoint": lambda base, model: f"{base}/chat/completions",
        "headers": lambda key: (
            {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
            if key else {"Content-Type": "application/json"}
        ),
        "body": _openai_body,
        "extract": _openai_extract,
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
        "max_tokens": int(ai.get("max_tokens", 2000)),
        "json_mode": json_mode,
    }


def call_provider(cfg: dict, prompt: str, timeout: float = 90.0, tries: int = 3) -> str:
    """Hace la petición al proveedor y devuelve el texto de la respuesta.
    Reintenta los errores transitorios del servidor (5xx) con backoff."""
    P = cfg["P"]
    url = P["endpoint"](cfg["base_url"], cfg["model"])
    headers = P["headers"](cfg["api_key"])
    body = P["body"](cfg["model"], prompt, {
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
        "json_mode": cfg["json_mode"],
    })
    for i in range(tries):
        r = httpx.post(url, headers=headers, json=body, timeout=timeout)
        if r.status_code in RETRY_STATUS and i < tries - 1:
            wait = 1.0 * (i + 1)  # 1s, 2s…
            print(t("provider_retry", model=cfg['model'], status=r.status_code,
                    n=i + 1, total=tries - 1, wait=wait))
            time.sleep(wait)
            continue
        r.raise_for_status()
        return P["extract"](r.json())
