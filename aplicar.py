#!/usr/bin/env python3
"""job-autofill — semi-automatiza candidaturas (Greenhouse / Lever / Ashby / Teamtailor).

Uso:
  python aplicar.py <url-oferta>            # lee la oferta, prepara respuestas, abre el navegador
  python aplicar.py <url-oferta> --fetch    # solo prepara runs/<...>/answers.json (sin navegador)
  python aplicar.py <url-oferta> --fill     # abre el navegador con answers.json (ya editado)

Siempre PARA antes de enviar: revisas y pulsas tú el botón.
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
        print(f"No pude descargar la página: {e}")
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
        print("✗ No reconozco el ATS de esa URL (Greenhouse/Lever/Ashby/Teamtailor).")
        return None
    print(f"✓ ATS detectado: {ad.name}")
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

    print(f"\n  Oferta : {job.title} @ {job.company}")
    print(f"  Run dir: {d}")
    pend = [q for q in open_qs if not answers[q.key].value]
    if pend:
        print("\n  ✎ Preguntas abiertas SIN respuesta (rellénalas o pídeselas a Claude):")
        for q in pend:
            print(f"     - [{q.key}] {q.label}")
        print(f"\n  Edita {d/'answers.json'} y luego:  python aplicar.py '{url}' --fill")
    return ad, job, d, bool(pend)


def do_fill(url, profile):
    ad, ctx = resolve(url)
    if not ad:
        print("✗ ATS no reconocido."); return
    job = ad.fetch(ctx)
    d = run_dir(job)
    if not (d / "answers.json").exists():
        print("✗ No hay answers.json; ejecuta primero sin --fill."); return
    answers = load_answers(d)
    filler.run_fill(ad, job, answers, profile, headed=True, run_path=d)


def list_status():
    """Lista todas las candidaturas en runs/ y en qué estado quedó cada una."""
    if not RUNS.exists() or not any(RUNS.iterdir()):
        print("No hay runs todavía."); return
    for d in sorted(RUNS.iterdir()):
        if not d.is_dir():
            continue
        st = d / "status.json"
        if st.exists():
            s = json.loads(st.read_text(encoding="utf-8"))
            estado = s.get("state", "?")
            print(f"  [{estado:5}] {d.name}: {s.get('ok', 0)} ok / {s.get('fail', 0)} fallos"
                  f" · {s.get('finished_at', '')}"
                  + (f" · ERROR: {s['error']}" if s.get("error") else ""))
        elif (d / "answers.json").exists():
            print(f"  [prep ] {d.name}: respuestas preparadas, sin rellenar aún")
        else:
            print(f"  [vacío] {d.name}: sin answers.json")


def main():
    p = argparse.ArgumentParser(description="Semi-automatiza candidaturas de empleo.")
    p.add_argument("url", nargs="?", help="URL de la oferta")
    p.add_argument("--fetch", action="store_true", help="solo preparar answers.json")
    p.add_argument("--fill", action="store_true", help="abrir navegador con answers.json")
    p.add_argument("--status", action="store_true", help="listar runs y su estado, y salir")
    args = p.parse_args()

    if args.status:
        list_status()
        return
    if not args.url:
        p.error("falta la URL de la oferta (o usa --status para ver el estado de los runs)")

    profile = load_profile()

    if args.fill:
        do_fill(args.url, profile)
        return

    res = do_fetch(args.url, profile)
    if not res or args.fetch:
        return
    ad, job, d, pend = res
    if pend and not os.environ.get("ANTHROPIC_API_KEY"):
        print("\n→ Hay respuestas pendientes; no abro el navegador todavía.")
        return
    answers = load_answers(d)
    filler.run_fill(ad, job, answers, profile, headed=True, run_path=d)


if __name__ == "__main__":
    main()
