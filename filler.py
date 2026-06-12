"""Driver de navegador (Playwright headed) compartido por todos los adapters.

Flujo "rellenar y revisar":
  1. abre un navegador VISIBLE (contexto persistente -> mantiene tus logins)
  2. el adapter rellena los campos que sabe
  3. PARA y te deja revisar y pulsar tú mismo el botón de Enviar
  4. cierra cuando pulsas ENTER en la terminal
"""
from __future__ import annotations
import os
import json
import datetime
from pathlib import Path
from i18n import t

PROFILE_DIR = Path(os.path.expanduser("~/.config/job-autofill/browser"))

# Estado del registro de la ejecución en curso. run_fill() abre run.log y recoge
# los eventos ✓/⚠ que emiten los adapters vía log(), para volcar status.json.
_LOG = {"file": None, "events": []}


def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def log(msg: str):
    print(msg, flush=True)
    f = _LOG["file"]
    if f:
        try:
            f.write(f"{_now()} {msg}\n")
            f.flush()
        except Exception:
            pass
    # clasifica para status.json a partir del prefijo que ya usan los adapters
    s = msg.strip()
    if s.startswith("✓"):
        _LOG["events"].append({"level": "ok", "text": s.lstrip("✓ ").strip()})
    elif s.startswith("⚠"):
        _LOG["events"].append({"level": "warn", "text": s.lstrip("⚠ ").strip()})


# --------------------------------------------------------------- helpers fill
def _locate(page, sel: str, name: str | None):
    """Localiza por selector preferido; si falla, por atributo name."""
    loc = page.locator(sel)
    if loc.count():
        return loc.first
    if name:
        loc = page.locator(f'[name="{name}"]')
        if loc.count():
            return loc.first
    return page.locator(sel).first  # deja que lance si no existe


def fill_text(page, sel: str, value: str, name: str | None = None):
    el = _locate(page, sel, name)
    el.scroll_into_view_if_needed()
    el.fill(value)


def fill_textarea(page, sel: str, value: str, name: str | None = None):
    el = _locate(page, sel, name)
    el.scroll_into_view_if_needed()
    el.fill(value)


def upload_file(page, sel: str, path: str):
    p = Path(os.path.expanduser(path)).resolve()
    if not p.exists():
        raise FileNotFoundError(t("cv_not_found", path=p))
    page.set_input_files(sel, str(p))


def choose_select(page, q, label: str):
    """Elige una opción por su texto visible. Soporta <select> nativo y react-select."""
    name = q.field_name
    native = page.locator(f'select[name="{name}"]')
    if native.count():
        native.first.select_option(label=label)
        return
    # react-select (boards nuevos de Greenhouse / Ashby): abrir combobox y clicar opción
    opened = False
    for opener in (lambda: page.get_by_label(q.label, exact=False).first.click(timeout=2500),
                   lambda: page.locator(f'#{q.field_id}').first.click(timeout=2500)):
        try:
            opener()
            opened = True
            break
        except Exception:
            continue
    if not opened:
        raise RuntimeError(t("dropdown_open_failed"))
    page.get_by_role("option", name=label, exact=False).first.click(timeout=3000)


# ----------------------------------------------------------------- driver
def run_fill(adapter, job, answers: dict, profile: dict, headed: bool = True, run_path=None):
    from playwright.sync_api import sync_playwright

    started = _now()
    error = None
    if run_path:
        run_path = Path(run_path)
        _LOG["file"] = open(run_path / "run.log", "a", encoding="utf-8")
        _LOG["events"] = []
        log(t("fill_header", title=job.title, company=job.company, time=started))

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=not headed,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        log(t("opening", title=job.title, company=job.company))
        try:
            adapter.fill(page, job, answers, profile)
        except Exception as e:
            error = str(e)
            log(t("fill_error", error=e))

        log("\n" + "=" * 64)
        log(t("review_banner_1"))
        log(t("review_banner_2"))
        log("=" * 64)
        try:
            input(t("press_enter"))
        except (EOFError, KeyboardInterrupt):
            pass
        ctx.close()

    if run_path:
        ok = sum(1 for e in _LOG["events"] if e["level"] == "ok")
        fail = sum(1 for e in _LOG["events"] if e["level"] == "warn")
        status = {
            "state": "error" if error else "done",
            "started_at": started,
            "finished_at": _now(),
            "ok": ok,
            "fail": fail,
            "error": error,
            "events": _LOG["events"],
        }
        (run_path / "status.json").write_text(
            json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
        log(t("log_saved", log=run_path / 'run.log', status=run_path / 'status.json'))
        try:
            _LOG["file"].close()
        except Exception:
            pass
        _LOG["file"] = None
