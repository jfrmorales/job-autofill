"""Construcción de respuestas.

Dos fuentes:
  1. Determinista (sin IA): datos directos de perfil.yaml -> nombre, email, CV,
     LinkedIn, salario, y selects frecuentes (work authorization, EEO...).
  2. IA (por oferta): redacta las preguntas abiertas (cover letter, "why this
     company"...) usando tu CV + la descripción de la oferta.

Si hay un proveedor de IA configurado (key de Anthropic/OpenAI/Google o sección
`ai:` en perfil.yaml) -> genera la parte IA automáticamente. Si no -> deja esas
respuestas en blanco para revisarlas a mano. Ver providers.py para los
proveedores soportados y cómo configurarlos.
"""
from __future__ import annotations
import os
import i18n
from i18n import t
from ats.base import Job, Question, Answer, TEXT, TEXTAREA, FILE, SELECT, MULTISELECT
from providers import resolve_ai_config, call_provider, extract_json_object, AIConfigError


# --------------------------------------------------------------- CV -> texto
def extract_cv_text(path: str) -> str:
    p = os.path.expanduser(path or "")
    if not p or not os.path.exists(p):
        return ""
    try:
        from pypdf import PdfReader
        return "\n".join((pg.extract_text() or "") for pg in PdfReader(p).pages).strip()
    except Exception:
        return ""


# ------------------------------------------------ mapeo determinista de perfil
_EEO_HINTS = ("gender", "race", "ethnic", "veteran", "disability", "hispanic", "latino")


def _profile_value(q: Question, profile: dict):
    key = q.key.lower()
    label = q.label.lower()
    b = profile.get("basics", {})

    if key == "first_name":
        return b.get("first_name")
    if key == "last_name":
        return b.get("last_name")
    if key == "preferred_name":
        return b.get("preferred_name") or b.get("first_name")
    if key == "email":
        return b.get("email")
    if key == "phone":
        return b.get("phone")
    if q.type == FILE and ("resume" in key or "cv" in label or "resume" in label):
        return profile.get("cv_path")
    if "linkedin" in label or "linkedin" in key:
        return b.get("linkedin")
    if "github" in label or "github" in key:
        return b.get("github")
    if any(w in label for w in ("portfolio", "website", "web site", "personal site")):
        return b.get("website")
    if any(w in label for w in ("salary", "compensation", "salario", "remuneration", "expected pay")):
        return profile.get("salary_expectation")
    if any(w in label for w in ("location", "where are you", "city", "country", "ubicaci")):
        return b.get("location")

    # selects frecuentes definidos por el usuario en perfil.yaml
    if q.type in (SELECT, MULTISELECT):
        for rule in profile.get("selects", []):
            if any(m.lower() in label for m in rule.get("match", [])):
                return _match_option(q, rule.get("answer", ""))
        if any(h in label for h in _EEO_HINTS):
            return _match_option(q, profile.get("eeo_default", "Decline To Self Identify"))
    return None


def _match_option(q: Question, wanted: str) -> str:
    """Devuelve la etiqueta de opción más parecida a `wanted` (case-insensitive)."""
    if not q.options:
        return wanted
    wl = wanted.lower().strip()
    for o in q.options:
        if o.label.lower().strip() == wl:
            return o.label
    for o in q.options:
        if wl in o.label.lower():
            return o.label
    return wanted


# ------------------------------------------------------------------ principal
def build_answers(job: Job, profile: dict):
    """Devuelve (answers: dict[key->Answer], open_qs: list[Question])."""
    answers: dict[str, Answer] = {}
    open_qs: list[Question] = []

    for q in job.questions:
        val = _profile_value(q, profile)
        if val:
            answers[q.key] = Answer(q.key, q.label, q.type, str(val))
            continue
        if q.type in (TEXTAREA,) or (q.type == TEXT and q.required and not q.options):
            # pregunta abierta -> IA
            open_qs.append(q)
            answers[q.key] = Answer(q.key, q.label, q.type, "")
        else:
            # desconocida: la dejamos en blanco para revisión manual
            answers[q.key] = Answer(q.key, q.label, q.type, "", skip=(not q.required))
    return answers, open_qs


def ia_prompt(job: Job, profile: dict, open_qs: list[Question], cv_text: str) -> str:
    qs = "\n".join(f"- [{q.key}] {q.label}" for q in open_qs)
    candidate = (f"{profile.get('basics', {}).get('first_name','')} "
                 f"{profile.get('basics', {}).get('last_name','')}\n"
                 f"{profile.get('pitch','')}")
    if i18n.lang() == "es":
        return f"""Eres un asistente que redacta respuestas para una candidatura de empleo.
Responde en el MISMO idioma de la oferta. Tono profesional, concreto, sin clichés.
No inventes EXPERIENCIA que no esté en el CV.

# Reglas (importante)
- PROHIBIDO evadir. Nada de "lo discutiré en la entrevista" / "abierto a negociar".
  Comprométete con datos concretos.
- Salario: usa profile['salary_expectation'] si tiene valor; si está vacío, ESTIMA un
  rango bruto anual de mercado realista para el puesto + seniority del CV + remoto
  España/EU, con moneda (p.ej. "55.000–65.000 € brutos/año").
- Preaviso / incorporación: usa profile['notice_period'] (p.ej. "15 días").

# Candidato (perfil)
{candidate}

# CV
{cv_text[:6000]}

# Oferta: {job.title} @ {job.company}
{job.description[:4000]}

# Preguntas a responder (devuelve JSON {{clave: respuesta}})
{qs}
"""
    return f"""You are an assistant that drafts answers for a job application.
Answer in the SAME language as the job posting. Professional, concrete tone, no clichés.
Do NOT invent EXPERIENCE that is not in the CV.

# Rules (important)
- NO evasions. None of "I'll discuss it in the interview" / "open to negotiate".
  Commit to concrete data.
- Salary: use profile['salary_expectation'] if it has a value; if empty, ESTIMATE a
  realistic gross annual market range for the role + CV seniority + remote
  Spain/EU, with currency (e.g. "55,000–65,000 € gross/year").
- Notice period / start date: use profile['notice_period'] (e.g. "15 days").

# Candidate (profile)
{candidate}

# CV
{cv_text[:6000]}

# Job: {job.title} @ {job.company}
{job.description[:4000]}

# Questions to answer (return JSON {{key: answer}})
{qs}
"""


def ia_generate(job: Job, profile: dict, open_qs: list[Question], cv_text: str):
    """Genera respuestas IA si hay un proveedor configurado. Devuelve
    dict[key->texto] o {} si no hay IA o falla."""
    if not open_qs:
        return {}
    try:
        cfg = resolve_ai_config(profile)
    except AIConfigError as e:
        print(t("ai_not_configured", error=e))
        return {}
    try:
        json_only = ("\n\nDevuelve únicamente el JSON, sin texto adicional."
                     if i18n.lang() == "es"
                     else "\n\nReturn only the JSON, with no extra text.")
        prompt = ia_prompt(job, profile, open_qs, cv_text) + json_only
        data = extract_json_object(call_provider(cfg, prompt))
        print(t("ai_using", label=cfg['P']['label'], model=cfg['model']))
        return data
    except Exception as e:
        print(t("ai_unavailable", error=e))
        return {}
