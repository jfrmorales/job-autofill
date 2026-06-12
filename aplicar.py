#!/usr/bin/env python3
"""job-autofill — semi-automatiza candidaturas (Greenhouse / Lever / Ashby / Teamtailor).

Uso / Usage:
  python aplicar.py <url-oferta>            # lee la oferta, prepara respuestas, abre el navegador
  python aplicar.py <url-oferta> --fetch    # solo prepara runs/<...>/answers.json (sin navegador)
  python aplicar.py <url-oferta> --fill     # abre el navegador con answers.json (ya editado)
  python aplicar.py ... --lang en           # idioma de la interfaz (es / en); autodetecta por defecto

Siempre PARA antes de enviar: revisas y pulsas tú el botón.
It always STOPS before submitting: you review and press the button yourself.
"""
from __future__ import annotations
import sys, os, json, argparse, urllib.request
from pathlib import Path
import yaml

# importar adapters -> se autoregistran
import ats.greenhouse, ats.lever, ats.ashby, ats.teamtailor  # noqa: F401
from ats.base import detect, all_adapters, Answer
import generate
import filler
import i18n
from i18n import t

ROOT = Path(__file__).resolve().parent
RUNS = ROOT / "runs"


def load_profile():
    with open(ROOT / "perfil.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _get_html(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 job-autofill"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def resolve(url):
    """URL -> (adapter, ctx). Primero por host; si no, descargando la página (sniff)."""
    ad, ctx = detect(url)
    if ad:
        ctx = dict(ctx or {}); ctx.setdefault("url", url)
        return ad, ctx
    try:
        page_html = _get_html(url)
    except Exception as e:
        print(t("download_failed", error=e))
        return None, None
    for a in all_adapters():
        sn = getattr(a, "sniff", None)
        if not sn:
            continue
        ctx = sn(url, page_html)
        if ctx:
            ctx.setdefault("url", url)
            return a, ctx
    return None, None


def run_dir(job):
    d = RUNS / f"{job.ats}_{job.company}_{job.job_id}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_answers(d: Path, answers: dict):
    out = {k: {"label": a.label, "type": a.type, "value": a.value, "skip": a.skip}
           for k, a in answers.items()}
    (d / "answers.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


def load_answers(d: Path) -> dict:
    data = json.loads((d / "answers.json").read_text(encoding="utf-8"))
    return {k: Answer(k, v["label"], v["type"], v.get("value", ""), v.get("skip", False))
            for k, v in data.items()}


def do_fetch(url, profile):
    ad, ctx = resolve(url)
    if not ad:
        print(t("ats_unrecognized"))
        return None
    print(t("ats_detected", name=ad.name))
    job = ad.fetch(ctx)
    answers, open_qs = generate.build_answers(job, profile)

    cv_text = generate.extract_cv_text(profile.get("cv_path", ""))
    ia = generate.ia_generate(job, profile, open_qs, cv_text)
    for k, v in ia.items():
        if k in answers:
            answers[k].value = str(v)

    d = run_dir(job)
    (d / "job.json").write_text(json.dumps(job.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    save_answers(d, answers)

    print()
    print(t("offer_line", title=job.title, company=job.company))
    print(t("run_dir_line", path=d))
    pend = [q for q in open_qs if not answers[q.key].value]
    if pend:
        print(t("open_questions_header"))
        for q in pend:
            print(t("open_question_item", key=q.key, label=q.label))
        print(t("edit_then_fill", path=d / 'answers.json', url=url))
    return ad, job, d, bool(pend)


def do_fill(url, profile):
    ad, ctx = resolve(url)
    if not ad:
        print(t("ats_unrecognized_short")); return
    job = ad.fetch(ctx)
    d = run_dir(job)
    if not (d / "answers.json").exists():
        print(t("no_answers_file")); return
    answers = load_answers(d)
    filler.run_fill(ad, job, answers, profile, headed=True, run_path=d)


def list_status():
    """Lista todas las candidaturas en runs/ y en qué estado quedó cada una."""
    if not RUNS.exists() or not any(RUNS.iterdir()):
        print(t("no_runs")); return
    for d in sorted(RUNS.iterdir()):
        if not d.is_dir():
            continue
        st = d / "status.json"
        if st.exists():
            s = json.loads(st.read_text(encoding="utf-8"))
            err = t("status_error_suffix", error=s["error"]) if s.get("error") else ""
            print(t("status_line", state=s.get("state", "?"), name=d.name,
                    ok=s.get("ok", 0), fail=s.get("fail", 0),
                    finished=s.get("finished_at", ""), error=err))
        elif (d / "answers.json").exists():
            print(t("status_prepared", name=d.name))
        else:
            print(t("status_empty", name=d.name))


def main():
    # Idioma temprano (para --help y mensajes previos al perfil): cli > env > sistema.
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--lang")
    cli_lang = pre.parse_known_args()[0].lang
    i18n.set_lang(i18n.detect_lang(cli=cli_lang))

    p = argparse.ArgumentParser(description=t("cli_description"))
    p.add_argument("url", nargs="?", help=t("help_url"))
    p.add_argument("--fetch", action="store_true", help=t("help_fetch"))
    p.add_argument("--fill", action="store_true", help=t("help_fill"))
    p.add_argument("--status", action="store_true", help=t("help_status"))
    p.add_argument("--lang", choices=i18n.LANGS, help=t("help_lang"))
    args = p.parse_args()

    if args.status:
        list_status()
        return
    if not args.url:
        p.error(t("err_need_url"))

    profile = load_profile()
    # Reafina con la clave `lang:` del perfil (cli/env siguen teniendo prioridad).
    i18n.set_lang(i18n.detect_lang(cli=args.lang, profile=profile))

    if args.fill:
        do_fill(args.url, profile)
        return

    res = do_fetch(args.url, profile)
    if not res or args.fetch:
        return
    ad, job, d, pend = res
    if pend and not os.environ.get("ANTHROPIC_API_KEY"):
        print(t("pending_no_browser"))
        return
    answers = load_answers(d)
    filler.run_fill(ad, job, answers, profile, headed=True, run_path=d)


if __name__ == "__main__":
    main()
