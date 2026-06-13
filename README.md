# job-autofill

**Español** · [English](README.en.md)

Semi-automatiza candidaturas de empleo. Lee la oferta y sus preguntas, prepara
las respuestas (datos de tu perfil + IA para las abiertas), abre el formulario
en un navegador, lo rellena y **para antes de enviar**: tú revisas y pulsas el
botón de Enviar.

La interfaz (CLI y extensión) está disponible en **español e inglés**, y puedes
elegir el idioma (ver [Idioma](#idioma)).

Soporta **Greenhouse, Lever, Ashby y Teamtailor** (los 4 cubren la mayoría de
ofertas tech). Greenhouse y Lever van por API pública (robusto); Ashby y
Teamtailor por DOM (best-effort, tú revisas).

## Instalación

```bash
cd ~/repositories/job-autofill
./setup.sh
```

`setup.sh` crea tu `perfil.yaml` desde `perfil.example.yaml` (o hazlo a mano:
`cp perfil.example.yaml perfil.yaml`). Edítalo con tus datos (nombre, email,
teléfono, LinkedIn, salario, pitch). `perfil.yaml` **no se versiona** (lleva tus
datos personales); en git solo vive la plantilla.

## Idioma

Toda la interfaz (CLI y extensión) está en **español e inglés**.

- **CLI**: el idioma se resuelve por este orden: `--lang es|en` → variable
  `JOB_LANG` → clave `lang:` de `perfil.yaml` → locale del sistema (`LANG`) →
  inglés. Ejemplo: `python aplicar.py '<url>' --lang en`.
- **Extensión**: selector **«Idioma de la interfaz»** en *Ajustes* (se guarda en
  el navegador). Si no eliges, se autodetecta de `navigator.language`.

## Uso

```bash
source .venv/bin/activate

# 1) Prepara la candidatura (detecta ATS, lee preguntas, prepara answers.json)
python aplicar.py 'https://job-boards.greenhouse.io/pandadoc/jobs/7930491'

# Fuerza el idioma de la interfaz (es / en); por defecto se autodetecta
python aplicar.py '<url>' --lang en
```

- Los datos directos (nombre, email, CV, LinkedIn, salario, work-authorization)
  se rellenan solos desde `perfil.yaml`.
- Las preguntas abiertas (cover letter, "why this company"):
  - **con `ANTHROPIC_API_KEY`** → las redacta la IA y abre el navegador directo.
  - **sin API key** → quedan en blanco en `runs/<oferta>/answers.json`. Edítalas
    a mano (o pídeselas a Claude Code) y luego:

```bash
python aplicar.py '<misma-url>' --fill   # abre el navegador con tus respuestas
```

El navegador es **persistente** (`~/.config/job-autofill/browser`): mantiene tus
logins (LinkedIn, Google) entre ofertas.

### Configurar la IA

Por defecto usa **Anthropic (Claude)**, pero soporta **Google (Gemini/Gemma),
OpenAI y cualquier API compatible con OpenAI** (OpenRouter, Groq, Ollama local…).
Se configura por variables de entorno (`JOB_AI_PROVIDER`, `JOB_AI_MODEL`,
`JOB_AI_BASE_URL`, la API key del proveedor) o en la sección `ai:` de `perfil.yaml`
(ver `perfil.example.yaml`). Las llamadas se hacen en **streaming** y el timeout es
de **inactividad** entre tokens (`JOB_AI_TIMEOUT` o `ai.timeout`, por defecto 180 s),
no un tope total: súbelo para modelos lentos (p.ej. Gemma) y no se cortarán mientras
sigan generando.

### Saber en qué estado quedó cada candidatura

```bash
python aplicar.py --status      # lista todos los runs y su estado
```

Cada relleno deja un rastro en su carpeta `runs/<oferta>/`:

- `run.log` — cada paso con timestamp y cada campo (`✓`/`⚠ motivo`).
- `status.json` — estado final (`done`/`error`), nº de campos ok/fallidos y el
  error si lo hubo.

## Extensión de navegador

La extensión (`extension/`) hace lo mismo en la página actual con un modelo de
Google. En *Ajustes*, al adjuntar tu **CV en PDF** se extrae el texto
automáticamente (con pdf.js, en `extension/vendor/`) y rellena «CV (texto
plano)»; ese texto es el que usa la IA. Todo el proceso (escanear → generar →
rellenar) deja **registro
persistente**: abre el popup y verás el resultado de la última ejecución (estado,
y cada campo en verde/rojo con el motivo del fallo), aunque hayas cerrado el
popup. Botón **«Ver registro»** para el log completo y **«Copiar registro»** para
pegármelo si algo falla.

## Generar respuestas IA sin API key (vía Claude Code)

```bash
python aplicar.py '<url>' --fetch        # crea runs/<oferta>/{job.json,answers.json}
# luego, en Claude Code:  "rellena las preguntas abiertas de runs/<oferta>/answers.json"
python aplicar.py '<url>' --fill
```

## Estructura

| Fichero | Qué hace |
|---------|----------|
| `aplicar.py` | CLI: detecta ATS, orquesta fetch → generate → fill |
| `ats/*.py` | un adapter por plataforma (detección + lectura + relleno) |
| `generate.py` | respuestas deterministas + IA |
| `filler.py` | driver Playwright headed; rellena y para antes de enviar |
| `perfil.yaml` | tus datos |
| `runs/` | una carpeta por oferta con `job.json` + `answers.json` |

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -p "test_*.py"   # CLI (providers)
node --test tests/*.test.js                                     # extensión
```

Cubren la lógica delicada: parseo del streaming SSE de cada proveedor, resolución
de config (incl. timeout de inactividad), extracción de JSON, failover por
timeout, dedup de react-select y normalización de números.

## Límites

- **No resuelve CAPTCHAs** ni hace login por ti (por eso el navegador es visible
  y persistente).
- **Nunca envía**: el último clic siempre es tuyo, por diseño.
- Ashby/Teamtailor: el mapeo de campos es por etiqueta y puede fallar en
  preguntas custom; revísalas en el navegador.
