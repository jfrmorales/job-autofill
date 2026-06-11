"""Modelos comunes y registro de adapters de ATS.

Cada adapter implementa:
  - matches(url) -> bool | dict   (detección; devuelve contexto si hace match)
  - fetch(ctx)   -> Job          (lee la oferta + sus preguntas)
  - fill(page, job, answers, profile)  (rellena el form en el navegador, SIN enviar)
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional, Callable


# Tipos normalizados de pregunta (independientes del ATS)
TEXT = "text"
TEXTAREA = "textarea"
FILE = "file"
SELECT = "select"          # elegir 1 de varias opciones
MULTISELECT = "multiselect" # elegir varias
BOOLEAN = "boolean"


@dataclass
class Option:
    label: str
    value: str


@dataclass
class Question:
    key: str                       # clave estable para mapear respuestas (p.ej. "first_name", "q_salary")
    label: str
    type: str
    required: bool = False
    options: list[Option] = field(default_factory=list)
    # pistas para la fase de relleno (rellenadas por el adapter)
    field_name: Optional[str] = None   # atributo name del input en el form
    field_id: Optional[str] = None     # id del input, si lo hay

    def to_dict(self):
        d = asdict(self)
        return d


@dataclass
class Job:
    ats: str
    company: str
    job_id: str
    title: str
    description: str        # texto plano de la descripción
    apply_url: str
    questions: list[Question] = field(default_factory=list)

    def to_dict(self):
        return {
            "ats": self.ats,
            "company": self.company,
            "job_id": self.job_id,
            "title": self.title,
            "apply_url": self.apply_url,
            "description": self.description,
            "questions": [q.to_dict() for q in self.questions],
        }


@dataclass
class Answer:
    key: str
    label: str
    type: str
    value: str = ""        # texto, valor de opción, o ruta de fichero
    skip: bool = False     # si True, no se rellena (lo deja para revisión manual)


# ------------------------------------------------------------------ registro
_ADAPTERS: list = []


def register(adapter):
    _ADAPTERS.append(adapter)
    return adapter


def detect(url: str):
    """Devuelve (adapter, ctx) para la URL, o (None, None) si ninguno hace match."""
    for ad in _ADAPTERS:
        ctx = ad.matches(url)
        if ctx:
            return ad, (ctx if isinstance(ctx, dict) else {})
    return None, None


def all_adapters():
    return list(_ADAPTERS)
