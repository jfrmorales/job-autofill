"""Adapter Teamtailor (company.teamtailor.com o dominio propio, p.ej. careers.odilo.us).

No hay API pública de applicant -> leemos la oferta del JSON-LD de la página y
rellenamos el form por etiqueta. Best-effort: tú revisas y envías.
"""
from __future__ import annotations
import re, json, html, urllib.request
from urllib.parse import urlparse
from .base import register, Job, Question, TEXT, FILE


def _get_html(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 job-autofill"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


_STD = [
    ("first_name", "First name", TEXT),
    ("last_name", "Last name", TEXT),
    ("email", "Email", TEXT),
    ("phone", "Phone", TEXT),
    ("resume", "Resume", FILE),
]


def _parse_jsonld(page_html):
    title, desc = "", ""
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                         page_html, re.S):
        try:
            d = json.loads(m.group(1).strip())
        except Exception:
            continue
        items = d if isinstance(d, list) else [d]
        for it in items:
            if it.get("@type") == "JobPosting":
                title = it.get("title", "")
                desc = re.sub(r"<[^>]+>", " ", html.unescape(it.get("description", "")))
                desc = re.sub(r"\s+", " ", desc).strip()
                return title, desc
    return title, desc


class Teamtailor:
    name = "teamtailor"

    @staticmethod
    def matches(url):
        host = urlparse(url).netloc.lower()
        if "teamtailor.com" in host:
            return {"url": url}
        return None  # dominios propios -> sniff()

    @staticmethod
    def sniff(url, page_html):
        if "teamtailor" in page_html.lower():
            return {"url": url}
        return None

    @staticmethod
    def fetch(ctx):
        url = ctx["url"]
        page_html = _get_html(url)
        title, desc = _parse_jsonld(page_html)
        m = re.search(r"/jobs/(\d+)", urlparse(url).path)
        job_id = m.group(1) if m else url.rstrip("/").split("/")[-1]
        parts = urlparse(url).netloc.split(".")
        # company.teamtailor.com -> company ; careers.odilo.us -> odilo
        company = parts[1] if parts[0] in ("careers", "jobs", "www", "apply", "join", "empleo") and len(parts) > 2 else parts[0]
        questions = [Question(k, lbl, t) for (k, lbl, t) in _STD]
        return Job("teamtailor", company, job_id, title, desc, url, questions)

    @staticmethod
    def fill(page, job, answers, profile):
        from filler import log
        page.goto(job.apply_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        for txt in ("Apply for this job", "Apply", "Solicitar", "Inscribirme", "Aplicar"):
            try:
                page.get_by_role("link", name=txt, exact=False).first.click(timeout=1500)
                page.wait_for_timeout(1000)
                break
            except Exception:
                try:
                    page.get_by_role("button", name=txt, exact=False).first.click(timeout=1500)
                    page.wait_for_timeout(1000)
                    break
                except Exception:
                    continue
        for q in job.questions:
            ans = answers.get(q.key)
            if not ans or ans.skip or not ans.value:
                continue
            try:
                if q.type == FILE:
                    page.set_input_files('input[type="file"]', ans.value)
                else:
                    page.get_by_label(q.label, exact=False).first.fill(ans.value)
                log(f"  ✓ {q.label}")
            except Exception as e:
                log(f"  ⚠ {q.label}: {e}")


register(Teamtailor)
