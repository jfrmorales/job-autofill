"""Adapter Lever (jobs.lever.co/<company>/<post_id>).

Lectura: API pública de postings (título + descripción).
Relleno: el form de Lever tiene nombres de campo estables (name, email, phone,
         org, urls[LinkedIn], resume). Las preguntas custom se rellenan a mano
         en la revisión.
"""
from __future__ import annotations
import re, json, html, urllib.request
from urllib.parse import urlparse
from .base import register, Job, Question, TEXT, FILE

APPLY = "https://jobs.lever.co/{company}/{post_id}/apply"
API = "https://api.lever.co/v0/postings/{company}/{post_id}?mode=json"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 job-autofill"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


# campos estándar del form de Lever -> (key, label, type, selector)
_STD = [
    ("name", "Full name", TEXT, 'input[name="name"]'),
    ("email", "Email", TEXT, 'input[name="email"]'),
    ("phone", "Phone", TEXT, 'input[name="phone"]'),
    ("org", "Current company", TEXT, 'input[name="org"]'),
    ("linkedin", "LinkedIn", TEXT, 'input[name="urls[LinkedIn]"]'),
    ("github", "GitHub", TEXT, 'input[name="urls[GitHub]"]'),
    ("resume", "Resume/CV", FILE, 'input[name="resume"]'),
]


class Lever:
    name = "lever"

    @staticmethod
    def matches(url):
        host = urlparse(url).netloc.lower()
        if "lever.co" not in host:
            return None
        m = re.search(r"/([^/]+)/([0-9a-f-]{8,})", urlparse(url).path)
        if not m:
            return None
        return {"company": m.group(1), "post_id": m.group(2)}

    @staticmethod
    def fetch(ctx):
        company, post_id = ctx["company"], ctx["post_id"]
        title, desc = "", ""
        try:
            d = json.loads(_get(API.format(company=company, post_id=post_id)))
            title = d.get("text", "")
            desc = re.sub(r"<[^>]+>", " ", html.unescape(d.get("description", "")))
            desc = re.sub(r"\s+", " ", desc).strip()
        except Exception:
            pass
        questions = [Question(k, lbl, t, field_name=None, field_id=sel)
                     for (k, lbl, t, sel) in _STD]
        return Job("lever", company, post_id, title, desc,
                   APPLY.format(company=company, post_id=post_id), questions)

    @staticmethod
    def fill(page, job, answers, profile):
        from filler import upload_file, fill_text, log
        page.goto(job.apply_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        sel_by_key = {k: sel for (k, _l, _t, sel) in _STD}
        for q in job.questions:
            ans = answers.get(q.key)
            if not ans or ans.skip or not ans.value:
                continue
            sel = sel_by_key.get(q.key, q.field_id)
            try:
                if q.type == FILE:
                    upload_file(page, sel, ans.value)
                else:
                    fill_text(page, sel, ans.value)
                log(f"  ✓ {q.label}")
            except Exception as e:
                log(f"  ⚠ {q.label}: {e}")


register(Lever)
