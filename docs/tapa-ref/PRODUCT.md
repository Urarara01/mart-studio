# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Una sola persona: quien arma las piezas gráficas de Academia Vexler (academia preuniversitaria peruana). Escribe prompts con soltura, conoce los límites de la API de xKiro y usa la app como herramienta de producción diaria. Trabaja sobre todo en escritorio; a veces desde el celular (Tailscale/LAN) para revisar resultados, descargar o lanzar una edición rápida.

## Product Purpose

Producir assets para tapas, flyers, banners y redes de Academia Vexler: fondos, ítems flotantes, tapas completas, ediciones por referencia, recortes, fondos transparentes, OCR y texto a PNG. Éxito = pasar de idea a PNG listo para montar en Affinity con la menor fricción posible.

## Positioning

Una mesa de producción privada y local que encadena generación (GPT Image 2.5 / SenseNova vía xKiro), edición multi-referencia (hasta 16 imágenes, la primera es la base) y procesado local con Pillow, con una biblioteca que guarda prompt, modelo, refs y medidas de cada pieza.

## Operating Context

- Flujo real: cadena completa. Crear → Editar con referencias → Herramientas → Descargar → montaje final en Affinity.
- La biblioteca tiene ~150 piezas (mayoría ediciones y referencias subidas); crece todos los días.
- Cada generación tarda 45–110 s; se lanzan 1, 2 o 4 variantes en paralelo (cada una se cobra aparte).
- Servidor Python stdlib local (`studio.py`) que compila `ui.html` + `app.js` en `tapa-studio.html`. Login por cookie cuando se expone a la red.

## Capabilities and Constraints

- API: solo `n=1` por job; variantes = N jobs. Máx. 16 referencias por edición (17 → 400). 7 tamaños nativos; el server recorta/encaja al lienzo exacto (cover/contain/estirar).
- Formatos: A4 horizontal/vertical 150 y 300 dpi, feed 4:5, story 9:16, banner 16:9, cuadrado.
- Herramientas locales: ajustar a formato, quitar fondo (auto/blanco/color, tolerancia, suavizado), recortar márgenes, OCR (modelos de visión gratis), texto a PNG (Oswald/Montserrat/Bebas/Anton), paleta, escalar. Separar en capas PSD (`xkiro/psd-layers`) se cobra contra la wallet, no el plan.
- Endpoints existentes (`/api/config`, `/api/library`, `/api/generate`, `/api/job/:id`, `/api/jobs`, `/api/tools`, `/api/layers`, `/api/upload`, `/api/prompt`, `/api/delete`, `/api/reveal`, `/api/usage`) son el contrato; el rediseño es solo frontend.
- Sin dependencias nuevas ni build step: GSAP y three.js ya están vendorizados en `assets/vendor/`; fuentes self-hosted en `assets/fonts/`. Todo debe funcionar offline salvo las llamadas a la API.
- Dolores confirmados de la UI anterior: demasiados controles a la vista, la espera de 45–110 s sin información útil, mover piezas entre modos cuesta clics y pierde contexto, encontrar piezas/prompts viejos es lento.

## Brand Commitments

- Nombre: Tapa Studio · Academia Vexler.
- Paleta de marca de Vexler usada en los prompts (no necesariamente en la UI): turquesa #00B8B0, teal profundo #06363C, menta #9BEDE4, amarillo señal #FDDB00, blanco, azul noche #0A1126.
- Voz: español latinoamericano con tú (Perú), directo, de taller. La UI v3 usaba voseo; la v4 lo unifica a tú.

## Evidence on Hand

- Biblioteca real en `data/store.json` + `data/out/`, `data/thumbs/`, `data/uploads/`.
- Presets de fábrica en `presets.json`.
- UI anteriores en `legacy/` (rollback).

## Product Principles

1. La pieza manda: la imagen en curso ocupa el centro; los controles aparecen cuando hacen falta.
2. Una cadena, no cuatro islas: cualquier pieza pasa a editar, a herramientas o a descargar sin perder el hilo.
3. La espera informa: cada variante en vuelo es visible, con tiempo, estado y lo que viene después.
4. Nada se pierde: prompts, refs y resultados se pueden reencontrar rápido.

## Accessibility & Inclusion

Teclado completo (atajos 1–4, ⌘/Ctrl+Enter, U, /, D, ?, Esc), `prefers-reduced-motion` apaga las animaciones, objetivos táctiles cómodos en móvil.
