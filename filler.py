"""Driver de navegador (Playwright headed) compartido por todos los adapters.

Flujo "rellenar y revisar":
  1. abre un navegador VISIBLE (contexto persistente -> mantiene tus logins)
  2. el adapter rellena los campos que sabe
  3. PARA y te deja revisar y pulsar tú mismo el botón de Enviar
  4. cierra cuando pulsas ENTER en la terminal
"""
from __future__ import annotations
import os
from pathlib import Path

PROFILE_DIR = Path(os.path.expanduser("~/.config/job-autofill/browser"))


def log(msg: str):
    print(msg, flush=True)


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
        raise FileNotFoundError(f"CV no encontrado: {p}")
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
        raise RuntimeError("no pude abrir el desplegable")
    page.get_by_role("option", name=label, exact=False).first.click(timeout=3000)


# ----------------------------------------------------------------- driver
def run_fill(adapter, job, answers: dict, profile: dict, headed: bool = True):
    from playwright.sync_api import sync_playwright

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=not headed,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        log(f"\n→ Abriendo: {job.title} @ {job.company}")
        try:
            adapter.fill(page, job, answers, profile)
        except Exception as e:
            log(f"⚠ error rellenando: {e}")

        log("\n" + "=" * 64)
        log("  REVISA el navegador, corrige lo que quieras y pulsa TÚ el botón")
        log("  de Enviar/Submit. NO he enviado nada.")
        log("=" * 64)
        try:
            input("\nPulsa ENTER aquí cuando termines para cerrar el navegador... ")
        except (EOFError, KeyboardInterrupt):
            pass
        ctx.close()
