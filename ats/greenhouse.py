"""Adapter Greenhouse.

Detección:  *.greenhouse.io/<token>/jobs/<id>  (job-boards / boards)
Lectura:    boards-api.greenhouse.io  (API pública, devuelve preguntas + opciones)
Relleno:    el formulario está inline en la página de la oferta (form React).
"""
from __future__ import annotations
import re
import json
import urllib.request
from urllib.parse import urlparse

from .base import (
    register, Job, Question, Option,
    TEXT, TEXTAREA, FILE, SELECT, MULTISELECT,
)

API = "https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?questions=true"

_GH_TYPE = {
    "input_text": TEXT,
    "textarea": TEXTAREA,
    "input_file": FILE,
    "multi_value_single_select": SELECT,
    "multi_value_multi_select": MULTISELECT,
}


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 job-autofill"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


class Greenhouse:
    name = "greenhouse"

    @staticmethod
    def matches(url: str):
        host = urlparse(url).netloc.lower()
        path = urlparse(url).path
        if "greenhouse.io" not in host:
            # dominios propios que embeben greenhouse se resuelven en aplicar.py (sniff)
            return None
        m = re.search(r"/([a-z0-9_-]+)/jobs/(\d+)", path)
        if not m:
            return None
        return {"token": m.group(1), "job_id": m.group(2)}

    @staticmethod
    def sniff(url, page_html):
        """Dominios propios que embeben Greenhouse -> extraer board token + job id."""
        m = re.search(r"greenhouse\.io/embed/job_app\?for=([a-z0-9_-]+)", page_html) \
            or re.search(r'data-board-token=["\']([a-z0-9_-]+)["\']', page_html)
        if not m:
            return None
        token = m.group(1)
        j = re.search(r"gh_jid=(\d+)", page_html) or re.search(r"/jobs/(\d+)", urlparse(url).path)
        if not j:
            return None
        return {"token": token, "job_id": j.group(1)}

    @staticmethod
    def fetch(ctx) -> Job:
        token, job_id = ctx["token"], ctx["job_id"]
        data = json.loads(_get(API.format(token=token, job_id=job_id)))

        # descripción: viene en HTML escapado -> a texto plano simple
        raw = data.get("content", "")
        import html
        desc = re.sub(r"<[^>]+>", " ", html.unescape(raw))
        desc = re.sub(r"\s+", " ", desc).strip()

        questions: list[Question] = []
        for q in data.get("questions", []):
            fields = q.get("fields") or []
            if not fields:
                continue
            primary = fields[0]
            # para la cover letter preferimos el textarea (que la IA escriba texto)
            if "cover letter" in q.get("label", "").lower():
                ta = next((f for f in fields if f.get("type") == "textarea"), None)
                if ta:
                    primary = ta
            name = primary.get("name")
            gtype = _GH_TYPE.get(primary.get("type"), TEXT)
            opts = [Option(label=str(v.get("label")), value=str(v.get("value")))
                    for v in (primary.get("values") or [])]
            questions.append(Question(
                key=name,
                label=q.get("label", name),
                type=gtype,
                required=bool(q.get("required")),
                options=opts,
                field_name=name,
                field_id=name,   # en los boards nuevos el id coincide con el name
            ))

        return Job(
            ats="greenhouse",
            company=token,
            job_id=str(job_id),
            title=data.get("title", ""),
            description=desc,
            apply_url=data.get("absolute_url") or ctx.get("url", ""),
            questions=questions,
        )

    # ----------------------------------------------------------------- relleno
    @staticmethod
    def fill(page, job: Job, answers: dict, profile: dict):
        """answers: {key -> Answer}. Rellena y NO envía."""
        from filler import fill_text, fill_textarea, upload_file, choose_select, log

        page.goto(job.apply_url, wait_until="domcontentloaded")
        # el form está más abajo en la página; aseguramos que cargó
        page.wait_for_timeout(1500)

        for q in job.questions:
            ans = answers.get(q.key)
            if not ans or ans.skip or not ans.value:
                continue
            name = q.field_name
            sel = f'#{q.field_id}' if q.field_id else f'[name="{name}"]'
            try:
                if q.type == FILE:
                    upload_file(page, f'input[type="file"][name="{name}"]', ans.value)
                elif q.type == TEXTAREA:
                    fill_textarea(page, sel, ans.value, name)
                elif q.type in (SELECT, MULTISELECT):
                    choose_select(page, q, ans.value)
                else:  # TEXT
                    fill_text(page, sel, ans.value, name)
                log(f"  ✓ {q.label[:50]}")
            except Exception as e:  # tolerante: semi-auto, el humano revisa
                log(f"  ⚠ no pude rellenar «{q.label[:40]}»: {e}")


register(Greenhouse)
