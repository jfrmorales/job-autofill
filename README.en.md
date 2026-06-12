# job-autofill

[Español](README.md) · **English**

Semi-automates job applications. It reads the posting and its questions, prepares
the answers (data from your profile + AI for the open ones), opens the form in a
browser, fills it in and **stops before submitting**: you review and press the
Submit button yourself.

The interface (CLI and extension) is available in **Spanish and English**, and
you can choose the language (see [Language](#language)).

Supports **Greenhouse, Lever, Ashby and Teamtailor** (these 4 cover most tech
postings). Greenhouse and Lever go through a public API (robust); Ashby and
Teamtailor through the DOM (best-effort, you review).

## Installation

```bash
cd ~/repositories/job-autofill
./setup.sh
```

`setup.sh` creates your `perfil.yaml` from `perfil.example.yaml` (or do it by
hand: `cp perfil.example.yaml perfil.yaml`). Edit it with your data (name, email,
phone, LinkedIn, salary, pitch). `perfil.yaml` is **not versioned** (it holds
your personal data); only the template lives in git.

## Language

The whole interface (CLI and extension) is in **Spanish and English**.

- **CLI**: the language is resolved in this order: `--lang es|en` → `JOB_LANG`
  environment variable → `lang:` key in `perfil.yaml` → system locale (`LANG`) →
  English. Example: `python aplicar.py '<url>' --lang en`.
- **Extension**: an **«Interface language»** selector in *Settings* (stored in
  the browser). If you don't choose, it's auto-detected from `navigator.language`.

## Usage

```bash
source .venv/bin/activate

# 1) Prepare the application (detect ATS, read questions, prepare answers.json)
python aplicar.py 'https://job-boards.greenhouse.io/pandadoc/jobs/7930491'

# Force the interface language (es / en); auto-detected by default
python aplicar.py '<url>' --lang en
```

- Direct data (name, email, CV, LinkedIn, salary, work authorization) is filled
  automatically from `perfil.yaml`.
- Open questions (cover letter, "why this company"):
  - **with `ANTHROPIC_API_KEY`** → the AI drafts them and the browser opens directly.
  - **without an API key** → they stay blank in `runs/<posting>/answers.json`.
    Edit them by hand (or ask Claude Code) and then:

```bash
python aplicar.py '<same-url>' --fill   # opens the browser with your answers
```

The browser is **persistent** (`~/.config/job-autofill/browser`): it keeps your
logins (LinkedIn, Google) across postings.

### Check the state of each application

```bash
python aplicar.py --status      # lists all runs and their state
```

Each fill leaves a trail in its `runs/<posting>/` folder:

- `run.log` — each step with a timestamp and each field (`✓`/`⚠ reason`).
- `status.json` — final state (`done`/`error`), number of ok/failed fields and
  the error if there was one.

## Browser extension

The extension (`extension/`) does the same on the current page. In *Settings*,
attaching your **CV in PDF** extracts the text automatically (with pdf.js, in
`extension/vendor/`) and fills «CV (plain text)»; that text is what the AI uses.
The whole process (scan → generate → fill) leaves a **persistent log**: open the
popup and you'll see the result of the last run (state, and each field in
green/red with the failure reason), even if you closed the popup. The **«View
log»** button shows the full log and **«Copy log»** copies it so you can paste it
if something fails.

## Generate AI answers without an API key (via Claude Code)

```bash
python aplicar.py '<url>' --fetch        # creates runs/<posting>/{job.json,answers.json}
# then, in Claude Code:  "fill the open questions in runs/<posting>/answers.json"
python aplicar.py '<url>' --fill
```

## Structure

| File | What it does |
|------|--------------|
| `aplicar.py` | CLI: detects the ATS, orchestrates fetch → generate → fill |
| `ats/*.py` | one adapter per platform (detection + reading + filling) |
| `generate.py` | deterministic answers + AI |
| `filler.py` | headed Playwright driver; fills and stops before submitting |
| `perfil.yaml` | your data |
| `runs/` | one folder per posting with `job.json` + `answers.json` |

## Limits

- **It doesn't solve CAPTCHAs** nor log in for you (that's why the browser is
  visible and persistent).
- **It never submits**: the last click is always yours, by design.
- Ashby/Teamtailor: field mapping is by label and may fail on custom questions;
  review them in the browser.
