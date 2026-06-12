# job-autofill · browser extension

[Español](README.md) · **English**

Fills job applications **on any ATS** with AI, right on the page where you're
already logged in. It scans the form, generates the answers and fills them in.
**It never submits**: you review, attach the CV and press Submit.

The interface is in **Spanish and English**: choose the language in the
**«Interface language»** selector in *Settings* (otherwise it's auto-detected
from the browser).

Works with **several AI providers** (pick one in *Settings*):
- **Google** — Gemini / Gemma (Google AI Studio).
- **OpenAI** — GPT-4o / GPT-4.1…
- **Anthropic** — Claude (Haiku / Sonnet / Opus).
- **OpenAI-compatible (custom)** — paste a *Base URL* and it covers OpenRouter,
  Groq, Together, Mistral, DeepSeek, xAI, and **local** models like Ollama or
  LM Studio (`http://localhost:11434/v1`, no API key).

Each provider stores its own API key, so you can switch without rewriting them.

## Install (developer mode)

**Chrome / Chromium / Edge / Brave**
1. `chrome://extensions` → enable *Developer mode*.
2. *Load unpacked* → select the `extension/` folder.

**Firefox**
1. `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*.
2. Select `extension/manifest.json`. (Temporary: removed when you close Firefox.)

## Configure (once)
Right-click the icon → *Options* (or the **Settings** button in the popup):
- **Interface language** — Spanish or English (stored in the browser).
- **AI provider** — Google / OpenAI / Anthropic / compatible (custom).
- **API key** — paste a **new** key from the chosen provider (empty for local
  servers like Ollama). For «custom», also provide the **Base URL**.
- **Model** — pick one of the suggested ones or type your own id. OpenAI
  reasoning models (`o4-mini`, `o3`…) are detected and called with the correct
  parameters automatically.
- **Test connection** — makes a minimal request and tells you whether the key,
  model and endpoint work (no need to save or launch an application).
- **Fallback (429)** — if enabled and the provider runs out of quota, it
  automatically tries the other providers that have an API key configured.
- **Advanced options** — temperature, max tokens and JSON mode (turn it off if a
  compatible server returns a 400 error with `response_format`).
- **Profile (JSON)** — comes pre-filled with your data; complete salary and phone.
- **CV (text)** — paste the text of your CV (the AI drafts cover letters from here).

When you save a **custom** provider, the browser will ask for network permission
for that domain (the extension only ships fixed permission for Google, OpenAI and
Anthropic).

## Use
1. Open the posting and go to its form (press *Apply* if needed).
2. Click the icon → **⚡ Fill with AI**.
3. Filled fields are marked in **green**; the ones that failed, in **red**.
4. **Attach your CV** (the browser doesn't allow it by script), review and **submit yourself**.

### Embedded forms (Comeet, Greenhouse iframe…)
Many ATSs load the form inside an **iframe** (e.g. Coralogix uses Comeet →
`app.comeet.co`) and sometimes only after pressing *Apply*. The extension:
- Runs in **all frames** and scans the form iframe automatically.
- If it sees no fields, it tries to open the form (in-page *Apply* click) and **retries** once.
- If it still shows «0 fields»: press **Apply** yourself, wait for the form to load and try again.

> After updating `manifest.json`, **reload the extension** in `chrome://extensions`
> (the ↻ button). Chrome will ask you to accept the new *webNavigation* permission.

## What it fills
- ✅ Text, email, phone, URLs, textarea (incl. generated cover letters).
- ✅ Native `<select>`, radios, checkboxes.
- ✅ **Text «Resume»** fields (e.g. the Greenhouse textarea): filled with the
  text of your CV, without spending AI.
- ⚠️ react-select comboboxes (Greenhouse/Ashby): *best-effort*, review them.
- ❌ Uploading the CV **file**: **manual** (browser restriction) — but see below.

## CV always at hand
Even though the browser won't let you attach the file by script, the popup keeps it one click away:
- **⬇ CV to Downloads** — downloads the saved PDF to your Downloads folder, ready
  to select in the upload field (which is highlighted in **orange** when filling).
- **📋 Copy CV** — copies the CV text to the clipboard (for forms that ask you to
  paste the résumé).
- Load your PDF and paste the text once in *Settings*; they're stored permanently.

## Privacy / security
- The keys (one per provider) and the profile are stored only in
  `chrome.storage.local` of **your** browser.
- The key is **not in the code** (it doesn't end up in git). The provider call
  leaves from the *service worker*, not the page, so the website never sees it.
- The content script is **passive**: it only reads the page when you press the button.
- Only Google, OpenAI and Anthropic domains are allowed by default; any custom
  *Base URL* requires you to grant the network permission on save.

## vs. the Python version (`../`)
- **Extension**: any ATS, uses your logins, doesn't upload the CV. Better for day-to-day.
- **Python/Playwright**: it does upload the CV and reads the posting via API, but it's more cumbersome.
They're complementary.
