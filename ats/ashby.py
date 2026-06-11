"""Adapter Ashby (jobs.ashbyhq.com/<company>/<job_id>).

Lectura: API GraphQL pública del job board (título + descripción).
Relleno: form React con campos dinámicos -> relleno por etiqueta (get_by_label).
"""
from __future__ import annotations
import re, json, html, urllib.request
from urllib.parse import urlparse
from .base import register, Job, Question, TEXT, FILE

GQL = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting"


def _post(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(GQL, data=data,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "Mozilla/5.0 job-autofill"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


_STD = [
    ("name", "Name", TEXT),
    ("email", "Email", TEXT),
    ("phone", "Phone", TEXT),
    ("linkedin", "LinkedIn", TEXT),
    ("resume", "Resume", FILE),
]


class Ashby:
    name = "ashby"

    @staticmethod
    def matches(url):
        host = urlparse(url).netloc.lower()
        if "ashbyhq.com" not in host:
            return None
        m = re.search(r"/([^/]+)/([0-9a-f-]{8,})", urlparse(url).path)
        if not m:
            return None
        return {"company": m.group(1), "job_id": m.group(2), "url": url}

    @staticmethod
    def fetch(ctx):
        company, job_id = ctx["company"], ctx["job_id"]
        title, desc = "", ""
        try:
            res = _post({
                "operationName": "ApiJobPosting",
                "variables": {"organizationHostedJobsPageName": company,
                              "jobPostingId": job_id},
                "query": "query ApiJobPosting($organizationHostedJobsPageName:String!,$jobPostingId:String!){jobPosting(organizationHostedJobsPageName:$organizationHostedJobsPageName,jobPostingId:$jobPostingId){title descriptionPlain}}",
            })
            jp = (res.get("data") or {}).get("jobPosting") or {}
            title = jp.get("title", "")
            desc = jp.get("descriptionPlain", "")
        except Exception:
            pass
        questions = [Question(k, lbl, t) for (k, lbl, t) in _STD]
        return Job("ashby", company, job_id, title, desc, ctx["url"], questions)

    @staticmethod
    def fill(page, job, answers, profile):
        from filler import log
        page.goto(job.apply_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        # Ashby suele requerir pulsar "Apply" para abrir el form
        for txt in ("Apply", "Apply for this job", "Aplicar"):
            try:
                page.get_by_role("button", name=txt, exact=False).first.click(timeout=1500)
                page.wait_for_timeout(800)
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


register(Ashby)
