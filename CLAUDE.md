# CLAUDE.md — job-autofill

Semi-automatiza candidaturas de empleo: lee la oferta y sus preguntas, prepara las respuestas
(datos del perfil + IA para las abiertas), abre el formulario en un navegador, lo rellena y
**para antes de enviar**. Python + extensión de navegador.

## La regla que define el producto

**Nunca envía.** Rellena y se detiene; la persona revisa y pulsa Enviar. No añadir un modo
"enviar automáticamente" ni saltarse la revisión: es el límite deliberado del proyecto.

## Instalación

```bash
./setup.sh          # crea perfil.yaml desde perfil.example.yaml
```

`perfil.yaml` **no se versiona** (datos personales); en git solo vive la plantilla. Tampoco
`cv.txt` ni el contenido de `runs/`.

## ATS soportados — dos niveles de fiabilidad

| ATS | Vía | Fiabilidad |
|---|---|---|
| Greenhouse, Lever | API pública | robusto |
| Ashby, Teamtailor | DOM | best-effort, requiere revisión |

Al añadir un ATS nuevo, preferir siempre la API si existe. Los de DOM se rompen cuando el
proveedor cambia el maquetado: es esperado, no un bug de fondo.

## Estructura

`aplicar.py` (entrada), `generate.py` (respuestas), `filler.py` (relleno), `providers.py`,
`i18n.py`, `ats/` (un módulo por ATS), `extension/` (extensión de navegador), `tests/`.

```bash
npm test     # node --test tests/*.test.js
```

## Convenciones

- **Bilingüe**: toda la interfaz (CLI y extensión) está en español e inglés vía `i18n.py`.
  Un texto nuevo necesita sus dos versiones; `README.md` y `README.en.md` van en paralelo.
- Nunca loguear ni commitear datos del perfil.
