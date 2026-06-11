# job-autofill

Semi-automatiza candidaturas de empleo. Lee la oferta y sus preguntas, prepara
las respuestas (datos de tu perfil + IA para las abiertas), abre el formulario
en un navegador, lo rellena y **para antes de enviar**: tú revisas y pulsas el
botón de Enviar.

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

## Uso

```bash
source .venv/bin/activate

# 1) Prepara la candidatura (detecta ATS, lee preguntas, prepara answers.json)
python aplicar.py 'https://job-boards.greenhouse.io/pandadoc/jobs/7930491'
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

## Límites

- **No resuelve CAPTCHAs** ni hace login por ti (por eso el navegador es visible
  y persistente).
- **Nunca envía**: el último clic siempre es tuyo, por diseño.
- Ashby/Teamtailor: el mapeo de campos es por etiqueta y puede fallar en
  preguntas custom; revísalas en el navegador.
