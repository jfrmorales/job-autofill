#!/usr/bin/env bash
# Crea el venv del proyecto. Reutiliza los navegadores Playwright ya instalados.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q playwright pyyaml pypdf anthropic

# Crea tu perfil.yaml (datos personales, no versionado) desde la plantilla.
if [ ! -f perfil.yaml ]; then
  cp perfil.example.yaml perfil.yaml
  echo "✓ Creado perfil.yaml desde la plantilla — edítalo con tus datos."
fi

# Si no hubiera navegador instalado, descomenta:
# ./.venv/bin/python -m playwright install chromium

echo "✓ Listo. Activa con:  source .venv/bin/activate"
echo "  Luego:  python aplicar.py '<url-de-la-oferta>'"
