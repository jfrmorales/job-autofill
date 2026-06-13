"""Internacionalización del CLI (español / inglés).

Selección de idioma, por prioridad (de mayor a menor):
  1. flag --lang es|en
  2. variable de entorno JOB_LANG
  3. clave `lang:` en perfil.yaml
  4. locale del sistema (LANG / LC_ALL / LC_MESSAGES)
  5. inglés por defecto

Uso:
    import i18n
    i18n.set_lang(i18n.detect_lang(cli=args.lang, profile=profile))
    print(i18n.t("ats_detected", name=ad.name))

----

CLI internationalization (Spanish / English).

Language selection, highest priority first:
  1. --lang es|en flag
  2. JOB_LANG environment variable
  3. `lang:` key in perfil.yaml
  4. system locale (LANG / LC_ALL / LC_MESSAGES)
  5. English by default
"""
from __future__ import annotations
import os

LANGS = ("en", "es")
_state = {"lang": "en"}


def _normalize(value: str | None) -> str | None:
    if not value:
        return None
    code = str(value).strip().lower().replace("_", "-")[:2]
    return code if code in LANGS else None


def detect_lang(cli: str | None = None, profile: dict | None = None) -> str:
    """Resuelve el idioma según la prioridad documentada arriba."""
    candidates = [
        cli,
        os.environ.get("JOB_LANG"),
        (profile or {}).get("lang"),
        os.environ.get("LC_ALL"),
        os.environ.get("LC_MESSAGES"),
        os.environ.get("LANG"),
    ]
    for c in candidates:
        norm = _normalize(c)
        if norm:
            return norm
    return "en"


def set_lang(lang: str) -> None:
    _state["lang"] = _normalize(lang) or "en"


def lang() -> str:
    return _state["lang"]


def t(key: str, **kwargs) -> str:
    """Texto traducido para `key`; cae a inglés si falta en el idioma activo."""
    table = MESSAGES.get(_state["lang"], MESSAGES["en"])
    template = table.get(key) or MESSAGES["en"].get(key, key)
    return template.format(**kwargs) if kwargs else template


# --------------------------------------------------------------------- mensajes
MESSAGES: dict[str, dict[str, str]] = {
    "en": {
        # aplicar.py — argparse
        "cli_description": "Semi-automate job applications.",
        "help_url": "job posting URL",
        "help_fetch": "only prepare answers.json",
        "help_fill": "open browser with answers.json",
        "help_status": "list runs and their state, then exit",
        "help_lang": "interface language (es / en)",
        "err_need_url": "the job posting URL is missing (or use --status to see run states)",
        # aplicar.py — resolve / fetch
        "download_failed": "Could not download the page: {error}",
        "ats_unrecognized": "✗ I don't recognize the ATS for that URL (Greenhouse/Lever/Ashby/Teamtailor).",
        "ats_detected": "✓ ATS detected: {name}",
        "offer_line": "  Job    : {title} @ {company}",
        "run_dir_line": "  Run dir: {path}",
        "open_questions_header": "\n  ✎ Open questions with NO answer (fill them in or ask Claude):",
        "open_question_item": "     - [{key}] {label}",
        "edit_then_fill": "\n  Edit {path} and then:  python aplicar.py '{url}' --fill",
        # aplicar.py — fill
        "ats_unrecognized_short": "✗ ATS not recognized.",
        "no_answers_file": "✗ No answers.json; run first without --fill.",
        "pending_no_browser": "\n→ There are pending answers; not opening the browser yet.",
        # aplicar.py — status
        "no_runs": "No runs yet.",
        "status_line": "  [{state:5}] {name}: {ok} ok / {fail} failed · {finished}{error}",
        "status_error_suffix": " · ERROR: {error}",
        "status_prepared": "  [prep ] {name}: answers prepared, not filled yet",
        "status_empty": "  [empty] {name}: no answers.json",
        # generate.py
        "ai_not_configured": "⚠ AI not configured ({error}); leaving open questions blank",
        "ai_using": "  AI: {label} · {model}",
        "ai_unavailable": "⚠ AI unavailable ({error}); leaving open questions blank",
        # filler.py
        "fill_header": "── fill: {title} @ {company} ({time})",
        "opening": "\n→ Opening: {title} @ {company}",
        "fill_error": "⚠ error while filling: {error}",
        "review_banner_1": "  REVIEW the browser, fix anything you want and press the",
        "review_banner_2": "  Submit button YOURSELF. I have NOT submitted anything.",
        "press_enter": "\nPress ENTER here when you're done to close the browser... ",
        "log_saved": "→ Log: {log} · state: {status}",
        "cv_not_found": "CV not found: {path}",
        "dropdown_open_failed": "couldn't open the dropdown",
        # providers.py
        "provider_unknown": "unknown provider: {provider}",
        "missing_api_key": "missing API key for {label} (set {envs})",
        "missing_model": "missing model for {label}",
        "missing_base_url": "missing base_url for the custom provider",
        "provider_retry": "  ⚠ {model}: {status}; retry {n}/{total} in {wait:g}s…",
        "provider_empty": "empty response from {model}",
        "provider_no_json": "the response did not contain JSON. It started with: {start}",
        # ats adapters
        "fill_field_failed": "couldn't fill «{label}»: {error}",
    },
    "es": {
        # aplicar.py — argparse
        "cli_description": "Semi-automatiza candidaturas de empleo.",
        "help_url": "URL de la oferta",
        "help_fetch": "solo preparar answers.json",
        "help_fill": "abrir navegador con answers.json",
        "help_status": "listar runs y su estado, y salir",
        "help_lang": "idioma de la interfaz (es / en)",
        "err_need_url": "falta la URL de la oferta (o usa --status para ver el estado de los runs)",
        # aplicar.py — resolve / fetch
        "download_failed": "No pude descargar la página: {error}",
        "ats_unrecognized": "✗ No reconozco el ATS de esa URL (Greenhouse/Lever/Ashby/Teamtailor).",
        "ats_detected": "✓ ATS detectado: {name}",
        "offer_line": "  Oferta : {title} @ {company}",
        "run_dir_line": "  Run dir: {path}",
        "open_questions_header": "\n  ✎ Preguntas abiertas SIN respuesta (rellénalas o pídeselas a Claude):",
        "open_question_item": "     - [{key}] {label}",
        "edit_then_fill": "\n  Edita {path} y luego:  python aplicar.py '{url}' --fill",
        # aplicar.py — fill
        "ats_unrecognized_short": "✗ ATS no reconocido.",
        "no_answers_file": "✗ No hay answers.json; ejecuta primero sin --fill.",
        "pending_no_browser": "\n→ Hay respuestas pendientes; no abro el navegador todavía.",
        # aplicar.py — status
        "no_runs": "No hay runs todavía.",
        "status_line": "  [{state:5}] {name}: {ok} ok / {fail} fallos · {finished}{error}",
        "status_error_suffix": " · ERROR: {error}",
        "status_prepared": "  [prep ] {name}: respuestas preparadas, sin rellenar aún",
        "status_empty": "  [vacío] {name}: sin answers.json",
        # generate.py
        "ai_not_configured": "⚠ IA no configurada ({error}); deja las abiertas en blanco",
        "ai_using": "  IA: {label} · {model}",
        "ai_unavailable": "⚠ IA no disponible ({error}); deja las abiertas en blanco",
        # filler.py
        "fill_header": "── relleno: {title} @ {company} ({time})",
        "opening": "\n→ Abriendo: {title} @ {company}",
        "fill_error": "⚠ error rellenando: {error}",
        "review_banner_1": "  REVISA el navegador, corrige lo que quieras y pulsa TÚ el botón",
        "review_banner_2": "  de Enviar/Submit. NO he enviado nada.",
        "press_enter": "\nPulsa ENTER aquí cuando termines para cerrar el navegador... ",
        "log_saved": "→ Registro: {log} · estado: {status}",
        "cv_not_found": "CV no encontrado: {path}",
        "dropdown_open_failed": "no pude abrir el desplegable",
        # providers.py
        "provider_unknown": "proveedor desconocido: {provider}",
        "missing_api_key": "falta la API key de {label} (define {envs})",
        "missing_model": "falta el modelo de {label}",
        "missing_base_url": "falta la base_url del proveedor personalizado",
        "provider_retry": "  ⚠ {model}: {status}; reintento {n}/{total} en {wait:g}s…",
        "provider_empty": "respuesta vacía de {model}",
        "provider_no_json": "la respuesta no contenía JSON. Empezaba con: {start}",
        # ats adapters
        "fill_field_failed": "no pude rellenar «{label}»: {error}",
    },
}
