# Mart Studio

Laboratorio multimodal sobre **MartLLM**: imagen, edición, video, música/SFX, voz,
transcripción y chat contra ~830 modelos, con biblioteca local y control de gasto.
Hermano de Tapa Studio: mismo diseño (cartel chicha, una tinta por modo), mismo motor
(Python stdlib + Pillow portables), sin build step.

## Abrir

Doble clic en **`ABRIR-MART-STUDIO.cmd`** → `http://127.0.0.1:8775`
(si está ocupado prueba 8776, 8777…). Cerrar: cerrar la ventana negra.

- Credenciales: lee `martllm-key`, `martllm-base-url`, `user` y `pass` de
  `%USERPROFILE%\Desktop\.env`. Un `.env` junto a `studio.py` gana sobre ese.
- Con `user`/`pass` escucha en `0.0.0.0` (LAN/Tailscale) detrás de login. Sin ellos, solo local.
- `MART_HOST=127.0.0.1` lo deja local; `MART_AUTH=off` quita el login; `MART_PORT` cambia el puerto.
- ffmpeg (opcional, ya está en el PATH): miniaturas de video y ondas de audio.

## Modos (teclas 1–7)

| Modo | Qué hace | Endpoint |
|---|---|---|
| Imagen · Crear / Editar | texto a imagen; imagen + referencias a imagen | `/images/generations`, `/images/edits` |
| Video | texto a video, primer/último cuadro, referencias | `/video/generations` (job async) |
| Audio · Música/SFX, Voz, Transcribir | música y efectos; TTS; audio/video a texto | `/music/generations`, `/audio/speech`, `/audio/transcriptions` |
| Texto | chat con cualquier LLM, adjunta imágenes si el modelo tiene visión | `/chat/completions` |
| Biblioteca | todo lo generado o subido, con prompt, modelo, ajustes y costo | — |
| Modelos | catálogo completo con precios, filtros y ficha por modelo | `/models`, `/models/{id}` |
| Gasto | saldo, gasto por día/tipo/modelo, recargas, tope por trabajo, CSV | `/balance` + registro local |

El formulario de parámetros se arma solo desde el esquema que MartLLM publica para cada
modelo (resolución, duración, voz, proporción…), así que cualquier modelo nuevo funciona.

## Precios y gasto

- **Antes de cobrar** cada trabajo se cotiza con `validate: true` (gratis). El botón muestra
  el precio exacto con esos ajustes y cuánto retiene MartLLM mientras corre.
- **Tope por trabajo** (`max_cost`, por defecto $1, se cambia en Gasto): si un trabajo cuesta más,
  la app pide confirmar con un segundo clic.
- **Registro**: MartLLM no expone historial por API, así que cada llamada que pasa por la app se
  anota en `data/ledger.json` con el costo real (`X-UberLLM-Cost-USD` / `usage.cost_usd`). Video y
  música se asientan unos segundos después de terminar.
- **Saldo**: `data/balance.json` guarda una foto cada vez que cambia. Subidas = recargas; bajadas que
  no explica el registro = gasto hecho desde otro lado (Hermes, scripts…).
- El catálogo con precios se cachea 6 h en `data/catalog.json`; "Modelos" lo muestra completo.

## Archivos

- `studio.py` — servidor + cliente de MartLLM. `ui.html` + `app.js` → se compilan en `mart-studio.html`.
- `data/out/` salidas · `data/uploads/` subidas · `data/thumbs/` miniaturas · `data/store.json` biblioteca.
- `python/` runtime portable (copiado de Tapa Studio). `assets/` fuentes y GSAP.
- `docs/tapa-ref/` la UI y el brief de Tapa Studio usados como referencia de diseño.

## Notas de la API (verificadas el 2026-11-25)

- Los archivos de resultado (`/media/artifacts/...`) piden la misma API key y caducan: imágenes ~15 min,
  video/música ~3 h. La app los descarga apenas terminan.
- Algunos modelos aparecen en el catálogo pero no tienen proveedor en el momento
  (p. ej. `x-ai/grok-stt`, `meta-llama/muse-video`): la cotización o el trabajo lo dicen y no cobran.
- Algunos TTS (p. ej. `venice/kokoro-tts`) a veces mandan WAV con cabecera `audio/mpeg`: la app detecta el formato por los bytes.
