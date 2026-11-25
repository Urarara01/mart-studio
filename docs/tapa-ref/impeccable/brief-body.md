# Surface brief · Tapa Studio (app completa)

Scope: toda la UI de `ui.html` + `app.js` (Crear, Editar, Herramientas, Biblioteca, overlays, login en `studio.py`). Mode: Operate.

Audiencia y tarea: una persona produce assets de Academia Vexler en cadena (Crear → Editar → Herramientas → Descargar → Affinity). Dolores: demasiados controles, la espera de 45–110 s, mover piezas entre modos, encontrar cosas. A veces desde el celular.

Decisiones de superficie:
- Una sola pieza activa en la mesa, compartida por los cuatro modos: cambiar de modo no pierde la pieza.
- Las tandas en vuelo viven en un dock inferior (no bloquean el lienzo); se puede seguir componiendo.
- Biblioteca agrupada por día, con búsqueda en nombre y prompt y «Usar prompt».

## Direction contract

THESIS: La mesa de producción con la energía del cartel chicha limeño: bloques flúor planos anuncian a la distancia el modo y el estado de cada pieza. Rechaza la galería oscura con acento violeta de los generadores y el negro editorial de hairlines de la versión anterior.

OWN-WORLD: Negro de imprenta (#0B0B0C) como suelo; cuatro tintas flúor planas, una por modo: rosa #FF2E88 Crear, amarillo #FFE600 Editar, verde #22E07A Herramientas, naranja #FF7A00 Biblioteca. Letra condensada de cartel (Anton) solo en marca, títulos de modo, numerales grandes y vacíos; la interfaz en sans del sistema; mono solo para medidas. Bloques de color plano, sin degradados en texto, sin vidrio.

STORY: Quien entra ve la pieza en el centro y sabe en qué modo está por el color. Escribe, lanza, y mientras espera ve cada variante como un bloque flúor que se llena con su reloj; al terminar la imagen barre el bloque. Con un clic la pieza pasa a editar, a herramientas o se descarga.

FIRST VIEWPORT: Riel izquierdo negro de 88 px con cuatro modos; el activo es un bloque lleno de su tinta con texto negro. Barra superior: marca TAPA STUDIO en Anton, cola en vuelo, consumo, estado. Centro: la pieza activa sobre negro con bandas chicha en WebGL detrás cuando no hay pieza o hay espera; acciones de la pieza al pie. Derecha 380 px: compositor del modo con el prompt arriba y el botón de ejecutar lleno de la tinta del modo abajo, con costo. Abajo del centro: dock con la tanda y recientes.

FORM: Cartel chicha — Impeccable's pick (posición 1 de mi lista ordenada), elegido por el usuario. Seed key f6707221. Movimiento firma: la «banda» de espera, bloques flúor numerados que se llenan con el tiempo estimado y se abren a la imagen; bandas chicha en three.js que aceleran mientras hay trabajos en vuelo.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
