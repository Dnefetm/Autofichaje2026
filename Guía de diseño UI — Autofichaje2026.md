# Guía de diseño UI — Autofichaje2026

Sistema de diseño para un gestor de inventario, costos y precios en Next.js + Tailwind + shadcn/ui.
Basado en tendencias 2026 de dashboards, teoría de visualización (Tufte, Gestalt, carga cognitiva) y patrones de tablas empresariales.

---

## 1. Diagnóstico: qué tipo de producto es el tuyo

Autofichaje2026 no es una landing ni un dashboard ejecutivo: es una **herramienta operativa de uso diario** (importaciones, matching de SKU, costos, precios vigentes, colas, publicación a MercadoLibre). Eso fija el estilo antes de elegir un solo color.

| Rasgo del producto | Consecuencia de diseño |
| --- | --- |
| Sesiones largas de trabajo | Dark-first, contraste alto, cero animación decorativa |
| Miles de filas (15,369 filas de importación, 10,256 costos) | Virtualización + paginación servidor, densidad compacta |
| Decisiones con dinero (costos/precios) | Integridad numérica: tabular-nums, unidades y moneda explícitas |
| Máquinas de estado (importación, colas, jobs) | El estado es color + etiqueta + icono, nunca solo color |
| Un solo operador experto (tú) | Teclado primero: command palette, atajos, edición inline |

La tendencia dominante en 2026 se llama **calm density** (densidad tranquila): mucha información, tratamiento visual silencioso; la jerarquía la cargan la tipografía y el espaciado, no la ilustración ni el color ([AYDesign](https://www.aydesign.ai/blog/saas-ui-design-trends-2026)). El giro concreto es alejarse de las UI blancas llenas de tarjetas redondeadas con iconos de colores hacia interfaces densas, con "chrome" mínimo y dark-first ([TheKitbase](https://thekitbase.app/blog/saas-dashboard-design-trends-2026), [AdminLTE](https://adminlte.io/blog/saas-dashboard-design-examples/)).

Referencias a imitar, en este orden: **Linear** (jerarquía y teclado), **Stripe** (tablas y números), **Supabase / Vercel** (dark-first y chrome mínimo), **Attio** (AI como superficie de primera clase, no como burbuja de chat) ([925 Studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)).

---

## 2. Las 7 tendencias que sí aplican a tu caso

1. **Dark-first, no dark mode opcional.** Fondo oscuro como experiencia primaria; mejora el contraste de las visualizaciones y reduce fatiga en sesiones largas. Requisito: implementación sin flash al cargar ([TheKitbase](https://thekitbase.app/blog/saas-dashboard-design-trends-2026)).
2. **Densidad como feature, no como default.** Ofrece tres densidades reales (compacta / cómoda / amplia): un analista y un usuario ocasional no quieren la misma altura de fila ([Setproduct](https://www.setproduct.com/blog/data-table-ui-design)).
3. **Chrome silencioso.** Bordes de 1px casi invisibles, sin sombras, sin gradientes, radios pequeños (6–8px). El dato manda; la decoración desaparece.
4. **Divulgación progresiva.** Mostrar menos al inicio y revelar bajo demanda es el patrón detrás de casi todos los dashboards buenos de 2026 ([925 Studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)). Aplicado a ti: fila → panel lateral de detalle → página completa.
5. **Dashboards operativos, no reportes.** Cada métrica lleva una acción adjunta. En vez de "hay 42,731 filas en webhook_buffer", muestra el número con el botón "Drenar cola" al lado ([SaaSFrame](https://www.saasframe.io/blog/the-anatomy-of-high-performance-saas-dashboard-design-2026-trends-patterns)).
6. **Color = estado, nunca decoración.** Rojo significa roto, no "mira aquí" ([925 Studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)).
7. **Vistas por rol.** Ya lo insinúa `/mapa` con sus vistas de supervisor/técnica: la arquitectura de información por rol supera al "dashboard para todos" ([Aufait UX](https://www.aufaitux.com/blog/dashboard-design-examples-inspiration-best-practices/), [The Skins Factory](https://www.theskinsfactory.com/uiux-design-blog/saas-ui-ux-design-best-practices-2026)).

---

## 3. Fundamento teórico (para justificar decisiones, no para decorar)

- **Razón dato-tinta (Tufte, 1983).** Maximiza la proporción de píxeles que representan datos; borra rejillas, fondos, bordes, efectos 3D y etiquetas redundantes — lo que Tufte llama *chartjunk*. No es minimalismo estético: los elementos extra compiten por atención limitada y elevan la carga cognitiva ([Textbook of Usability](https://www.textbookofusability.com/chapter/data-visualisation.html)).
- **Integridad gráfica / lie factor.** El tamaño del efecto en el gráfico debe ser proporcional al efecto en los datos. Eje Y desde cero en barras; nunca truncar para exagerar ([Georgia Tech](https://faculty.cc.gatech.edu/~stasko/7450/12/Notes/tufte.pdf), [Visualization Design Handbook](https://garygisclair.github.io/visualization-design-handbook/index.html)).
- **Small multiples.** En vez de una gráfica compleja con muchas series, repite gráficas pequeñas idénticas (por proveedor, por lista de precios). El sistema visual compara en paralelo mucho mejor ([Textbook of Usability](https://www.textbookofusability.com/chapter/data-visualisation.html)).
- **Procesamiento preatentivo (Ware).** Color, forma, posición y movimiento se perciben antes de leer. Usa un solo atributo preatentivo para lo urgente (ej. un punto de color en la fila con error) y no lo gastes en nada más ([Principles of Information Visualization](https://www.scribd.com/document/878542200/Principles-of-Information-Visualization)).
- **Gestalt: proximidad y similitud.** El agrupamiento se logra con espacio en blanco antes que con cajas y líneas. Si dos campos se relacionan, acércalos y quita el borde.
- **Carga cognitiva (Sweller).** Descarga trabajo del usuario: valores por defecto, cálculos ya hechos, estados con nombre, y no más de 3–9 KPIs (3–5 ejecutivo, 5–7 gerencial, 7–9 operativo) ([DataWireframe](https://www.datawirefra.me/blog/dashboard-design-best-practices)).
- **Patrón F/Z de lectura.** El cuadrante superior izquierdo es el más valioso: ahí va la métrica norte, no un mensaje de bienvenida ([Data Viz CoP](https://p-jacques.github.io/data-viz-community-of-practice/dashboard_design/principles/), [ArtOfStyleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/)).
- **Las 4 tareas de una tabla (NN/g).** Encontrar registros por criterio, comparar datos, ver/editar una fila, y actuar sobre registros. Cada tabla tuya debe declarar cuál de las cuatro optimiza ([Stephanie Walter](https://stephaniewalter.design/blog/essential-resources-design-complex-data-tables/)).

---

## 4. Tokens de diseño (copia esto tal cual)

Sin colores ni espaciados hardcodeados en componentes: todo referencia tokens ([token-driven design system](https://shadisbaih.medium.com/building-a-scalable-design-system-with-shadcn-ui-tailwind-css-and-design-tokens-031474b03690)).

### 4.1 Color — dark-first (contrastes verificados WCAG AA)

```css
/* app/globals.css */
@layer base {
  :root {                    /* DARK = tema base */
    --bg:            #0B0C0E; /* fondo app */
    --surface:       #121417; /* cards, panel, header de tabla */
    --surface-2:     #171A1E; /* hover de fila, inputs */
    --border:        #23272C; /* 1px, apenas visible */
    --border-strong: #313740; /* foco, separadores de sección */

    --text:          #E8EAED; /* 16.2:1 sobre bg */
    --text-muted:    #9BA1A9; /* 7.5:1  — labels, unidades */
    --text-faint:    #6B7178; /* solo iconos/bordes, NO texto pequeño */

    --accent:        #2DD4BF; /* 10.5:1 — links, foco, serie primaria */
    --accent-ink:    #0B0C0E; /* texto sobre accent sólido */

    --ok:            #34D399; /* vigente / publicado / completado */
    --warn:          #FBBF24; /* pendiente / en cola / sugerido */
    --err:           #F87171; /* error / timeout / sin match */
    --info:          #22D3EE; /* procesando / job corriendo */

    --radius: 8px; --radius-sm: 6px;
    --row-h-compact: 32px; --row-h-cozy: 40px; --row-h-roomy: 52px;
  }

  [data-theme="light"] {
    --bg: #FAFAF9; --surface: #FFFFFF; --surface-2: #F4F4F5;
    --border: #E4E4E7; --border-strong: #D4D4D8;
    --text: #18181B; --text-muted: #52525B; --text-faint: #71717A;
    --accent: #0F766E; --accent-ink: #FFFFFF;
    --ok: #15803D; --warn: #B45309; --err: #B91C1C; --info: #0E7490;
  }
}
```

Reglas de uso:
- **Un acento + neutros.** El teal es solo para foco, links y la serie primaria de datos. Si todo está coloreado, nada destaca.
- Los 4 semánticos son exclusivos de estado de negocio (importación, cola, precio, publicación). Prohibido usarlos como adorno.
- Rojo/verde nunca solos: ~8% de los hombres tiene deficiencia rojo-verde. Cada badge lleva **punto + texto**.

### 4.2 Tipografía

Dos familias, no más: una sans para UI y una monoespaciada para todo lo que sea código o número comparable.

```css
--font-ui:   "Switzer", ui-sans-serif, system-ui, sans-serif;   /* Fontshare */
--font-mono: "JetBrains Mono", ui-monospace, monospace;         /* SKU, GTIN, importes */
```

Evita Inter/Roboto/Poppins (sobreexpuestas). Nota práctica de tu proyecto: para el render de PDF de fichas ya te falló la descarga externa de Inter, así que **en PDF sigue con la fuente nativa** y usa Switzer/JetBrains Mono solo en la web.

Escala (px / line-height):

| Rol | Tamaño | Peso | Uso |
| --- | --- | --- | --- |
| Métrica hero | 32 / 1.1 | 600 | KPI principal, `tabular-nums` |
| Título de página | 24 / 1.2 | 600 | "Importación Urrea #ce71252c" |
| Sección | 18 / 1.3 | 600 | Encabezado de bloque |
| Cuerpo | 14 / 1.5 | 400 | Celdas, formularios (14 es el cuerpo correcto en apps densas) |
| Micro / label | 12 / 1.4 | 500 | Encabezados de columna, unidades, timestamps |

Piso absoluto: 12px. Máximo 3–4 estilos de texto por pantalla.

**Regla de oro numérica:** todo número en columna lleva `font-variant-numeric: tabular-nums lining-nums`, alineación derecha y decimales consistentes. La mayoría de los problemas de tablas son alineación y densidad, no estilo ([Shaheer Malik](https://www.shaheermalik.com/blog/data-table-design-best-practices)).

### 4.3 Espaciado y layout

Base 4px. Sidebar colapsable de 240–280px (vuelve a ser el estándar en herramientas con muchos submódulos), franja de KPIs de 4–6 tarjetas arriba, y grid flexible debajo con `auto-fill` ([ArtOfStyleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/), [SaaSFrame](https://www.saasframe.io/blog/the-anatomy-of-high-performance-saas-dashboard-design-2026-trends-patterns)).

```
┌──────────┬───────────────────────────────────────────────┐
│ Sidebar  │ Topbar 48px: breadcrumb · ⌘K · densidad · rol │
│ 256px    ├───────────────────────────────────────────────┤
│ colapsa  │ KPI strip (4–6 tarjetas, 200–280px c/u)       │
│ a 56px   ├───────────────────────────────────────────────┤
│          │ Zona de trabajo: tabla virtualizada           │
│          │ (filtros pegados arriba, header congelado)    │
└──────────┴───────────────────────────────────────────────┘
                      + Sheet lateral 480px para detalle de fila
```

```tsx
<main className="grid grid-cols-[auto_1fr] h-dvh bg-[var(--bg)] text-[var(--text)]">
  <aside className="w-64 border-r border-[var(--border)] data-[collapsed=true]:w-14 transition-[width] duration-150" />
  <div className="grid grid-rows-[48px_auto_1fr] min-h-0">
    <header className="border-b border-[var(--border)] px-4 flex items-center gap-3" />
    <section className="grid gap-3 p-4 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]" />
    <div className="min-h-0 overflow-hidden px-4 pb-4" /> {/* min-h-0 = clave para virtualizar */}
  </div>
</main>
```

---

## 5. Patrones de componente, con indicaciones exactas

### 5.1 Tarjeta KPI

Anatomía: **un número grande, una comparación, un visual — no los tres visuales** ([ArtOfStyleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/)). En un sistema operativo como el tuyo, añade una acción.

```tsx
<div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
  <div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
    Costos vigentes
  </div>
  <div className="mt-1 flex items-baseline gap-2">
    <span className="text-[32px] leading-none font-semibold tabular-nums">10,256</span>
    <span className="text-xs text-[var(--text-muted)]">/ 2,564 artículos</span>
  </div>
  <div className="mt-2 flex items-center justify-between">
    <span className="text-xs text-[var(--ok)]">▲ 1,204 vs semana previa</span>
    <button className="text-xs text-[var(--accent)] hover:underline">Ver matching →</button>
  </div>
</div>
```

Los 6 KPIs que yo pondría arriba (métrica norte en el extremo izquierdo): **Precios pendientes de aceptar** → Costos sin match → Cola de recálculo → `webhook_buffer` → Jobs zombis → Última importación OK.

### 5.2 Tabla de datos (el corazón de la app)

Checklist obligatorio, todo verificable en revisión ([Shaheer Malik](https://www.shaheermalik.com/blog/data-table-design-best-practices), [Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), [Medium — enterprise tables](https://medium.com/@calee607/data-table-design-guidelines-for-enterprise-applications-40f7ef0e0186)):

- Header congelado + primera columna (SKU) congelada al hacer scroll horizontal. Crítico arriba de 20–30 filas.
- Texto a la izquierda, números a la derecha, decimales consistentes, unidad/moneda en el encabezado (`Costo (MXN)`), no en cada celda.
- Encabezados de columna cortos, ordenables las clave.
- Checkbox de fila + barra de acciones masivas que aparece al seleccionar (tu flujo de confirmar matches GTIN por lotes).
- Acciones de fila siempre en la misma posición, visibles en hover, accesibles por teclado.
- Zebra NO; usa separadores de 1px muy sutiles y hover de fila. La zebra es tinta sin datos.
- Estados diseñados: vacío, cargando (skeleton con la forma real de la tabla), error, parcial, sin resultados de filtro.
- Filtros persistentes y sincronizados a la URL (compartir un diagnóstico = compartir un link).
- Arriba de ~1,000 filas el render en cliente empieza a trabarse: pasa a paginación en servidor o virtualización ([Setproduct](https://www.setproduct.com/blog/data-table-ui-design)).

Implementación recomendada: **TanStack Table + TanStack Virtual + React Query**. Solo se renderizan las filas visibles más un buffer de overscan, manteniendo el DOM en 40–120 filas aunque el dataset tenga 200,000 ([TanStack](https://tanstack.com/table/latest/docs/framework/react/examples/virtualized-rows), [Samioda](https://samioda.com/en/blog/react-table-virtualization-infinite-scroll-tanstack-table)).

```tsx
const rowVirtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_H[density],   // 32 | 40 | 52
  overscan: 12,
});
```

Celda numérica y de código:

```tsx
<td className="px-3 text-right tabular-nums text-[13px]">{fmtMXN(costo)}</td>
<td className="px-3 font-mono text-[12px] text-[var(--text-muted)]">{gtin}</td>
```

### 5.3 Badges de estado (máquina de estados visible)

Tu app tiene estados reales: `pendiente`, `procesando`, `completado`, `error`, `sugerido`, `publicado`. Un solo componente, mapeo único, color + punto + texto.

```tsx
const ESTADO = {
  completado: { c: "var(--ok)",   t: "Completado" },
  procesando: { c: "var(--info)", t: "Procesando" },
  pendiente:  { c: "var(--warn)", t: "Pendiente"  },
  error:      { c: "var(--err)",  t: "Error"      },
} as const;

<span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)]
                 bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium">
  <i className="size-1.5 rounded-full" style={{ background: ESTADO[e].c }} />
  {ESTADO[e].t}
</span>
```

Para etapas secuenciales (tu pipeline de 10 etapas de precios), usa un **stepper horizontal** con la etapa bloqueante marcada, no una lista de logs. El usuario debe ver en 1 segundo *dónde* se detuvo: Diff → Matching → Consolidación → Vigencia → Publicación.

### 5.4 Divulgación progresiva: fila → Sheet → página

- Clic en fila abre un **Sheet lateral de 480px** con el detalle (alias, costos históricos, decisiones de matching), sin perder la posición del scroll ni los filtros.
- El Sheet tiene un link "Abrir página completa" para el caso profundo.
- Nunca modal para leer datos; modal solo para confirmar acciones destructivas.

### 5.5 Edición inline + UI optimista

Para editar precios/alias sin salir de la tabla: doble clic o Enter entra a edición, Esc cancela, Enter guarda y baja una fila (patrón hoja de cálculo, que ya conoces de Sheets). Actualiza el cache primero y revierte si la mutación falla ([Samioda](https://samioda.com/en/blog/react-table-virtualization-infinite-scroll-tanstack-table)).

Importante para tu dominio: los **precios sugeridos** se muestran en `--warn` con etiqueta "Sugerido" y solo tu aceptación explícita los pasa a `--ok`/publicado. El diseño debe hacer imposible confundir sugerido con publicado.

### 5.6 Teclado primero (command palette)

Eres el operador único y experto: la velocidad manda.
- `⌘K` / `Ctrl+K`: paleta con acciones ("Ir a importación…", "Drenar costos pendientes", "Buscar GTIN…").
- `/` enfoca búsqueda, `j`/`k` navegan filas, `x` selecciona, `⌘Enter` confirma la acción masiva.
- Toda acción de la paleta debe existir también como botón visible; la paleta acelera, no esconde.

### 5.7 Gráficas

- ≤5 series por gráfica; más allá, small multiples.
- Línea para evolución de costos, barras horizontales para ranking de proveedores, histograma para dispersión de márgenes. Nunca pastel con 5+ rebanadas, nunca 3D, nunca doble eje.
- Etiquetado directo sobre la serie en lugar de leyenda cuando quepa.
- El título dice el hallazgo: "El costo Urrea subió 8% en julio", no "Gráfica de costos".
- Sin rejilla de fondo, sin borde de panel, sin ticks decorativos.
- Secuencial → una sola tonalidad del acento. Categórico → paleta curada, derivada del acento.

### 5.8 Movimiento

Solo dos duraciones: 120ms (hover, foco) y 200ms (Sheet, colapso de sidebar). Nada más de 300ms. Respeta `prefers-reduced-motion`. Cero animación de entrada en tablas.

---

## 6. Accesibilidad, no negociable

- Cuerpo 4.5:1, texto grande 3:1. Los tokens de arriba ya cumplen; si cambias un color, recalcula.
- Anillo de foco visible en todo elemento interactivo: `focus-visible:ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]`.
- Tabla semántica real (`<table>`, `<th scope="col">`, `aria-sort`), no divs. Una tabla de datos accesible también es una tabla exportable.
- Nunca comunicar información solo con color.

---

## 7. Plan de ejecución en 5 pasos

1. **Auditoría de tinta.** Recorre `/catalog`, `/fichas`, `/precios`, `/mapa` y marca cada elemento decorativo que no lleve información. Recorta al menos la mitad: sombras, iconos de colores, cajas anidadas, títulos redundantes.
2. **Tokens antes que componentes.** Mete el bloque CSS del §4 y prohíbe hex/px sueltos en componentes.
3. **Un componente de tabla.** Una sola `<DataTable>` con densidad, virtualización, selección, estados y filtros en URL. Migra las demás a ella.
4. **Estado unificado.** Un solo `<EstadoBadge>` y un `<Stepper>` para el pipeline; borra los mapeos duplicados de color por página.
5. **Capa de velocidad.** `⌘K`, atajos, edición inline optimista y Sheet de detalle.

---

## 8. Prompts listos para tu editor

Pégalos tal cual, en este orden. Uno por sesión, con revisión visual entre cada uno.

**Prompt 1 — Fundación de tokens**
```
Refactoriza el sistema de diseño del dashboard (Next.js + Tailwind + shadcn/ui) a
dark-first con tokens CSS. Crea en app/globals.css las variables :root (tema oscuro
base) y [data-theme="light"] exactamente con estos valores: [pegar bloque CSS del §4.1].
Registra los tokens en tailwind.config como colores semánticos (bg, surface, surface-2,
border, text, text-muted, accent, ok, warn, err, info) y radios. Implementa el toggle de
tema sin flash (script inline en <head> que lee localStorage y aplica data-theme antes
del primer paint). NO cambies lógica de negocio. Luego busca en todo el repo colores
hex, rgb() y clases de color de Tailwind hardcodeadas en componentes y reemplázalas por
los tokens; entrégame la lista de archivos modificados.
```

**Prompt 2 — Tipografía y números**
```
Configura next/font o @fontsource para "Switzer" (UI) y "JetBrains Mono" (numérico/código)
con fallback a system-ui y ui-monospace. Aplica esta escala como clases utilitarias
reutilizables: metric 32/1.1/600, title 24/1.2/600, section 18/1.3/600, body 14/1.5/400,
micro 12/1.4/500. Crea helpers <Num> y <Code>: <Num> renderiza con
font-variant-numeric: tabular-nums lining-nums, alineación derecha y formato es-MX con
decimales fijos configurables; <Code> usa la mono para SKU, GTIN y claves de proveedor.
Reemplaza en /precios y /catalog toda celda numérica y de código por estos componentes.
No toques el renderizador de PDF: ahí debe seguir la fuente nativa.
```

**Prompt 3 — DataTable única**
```
Crea components/data-table/DataTable.tsx como único componente de tabla del proyecto,
con TanStack Table v8 + TanStack Virtual + React Query. Requisitos:
- Virtualización de filas con overscan 12 y altura por densidad (compact 32 / cozy 40 /
  roomy 52), densidad persistida en localStorage y conmutador en la topbar.
- Header sticky y primera columna sticky en scroll horizontal.
- Ordenamiento y filtrado en servidor, estado sincronizado con searchParams de la URL.
- Selección de filas que sobrevive a refetch + barra de acciones masivas flotante.
- Alineación por tipo: texto izquierda, números derecha con tabular-nums.
- Estados: loading (skeleton con la forma real de la tabla), vacío, error con retry,
  sin resultados de filtro.
- Accesibilidad: <table> semántica, th scope=col, aria-sort, navegación por teclado
  (j/k mueve fila, x selecciona, / enfoca búsqueda), focus-visible con ring del accent.
- Sin zebra: separador de 1px con --border y hover con --surface-2.
Migra primero la tabla de /precios y muéstrame el diff.
```

**Prompt 4 — Estado y pipeline**
```
Crea components/EstadoBadge.tsx con un único mapa de estados del dominio
(pendiente, procesando, completado, error, sugerido, publicado) a token de color +
etiqueta + punto de 6px; nunca comuniques el estado solo con color. Crea
components/Stepper.tsx que represente el pipeline de precios en sus etapas
(Diff → Matching → Consolidación → Vigencia → Publicación), marcando visiblemente la
etapa bloqueante y mostrando el conteo real de cada etapa. Elimina todos los mapeos
duplicados de color de estado que existan por página y sustitúyelos por estos dos
componentes.
```

**Prompt 5 — Detalle progresivo y edición inline**
```
Sustituye los modales de lectura por un Sheet lateral de 480px que abre al hacer clic en
una fila, preservando scroll y filtros, con link a la página completa. Añade edición
inline en la DataTable: doble clic o Enter entra a edición, Esc cancela, Enter guarda y
avanza a la fila siguiente; mutación optimista con React Query y rollback + toast de
error si falla. Regla de negocio en la UI: los precios sugeridos se muestran con el token
warn y la etiqueta "Sugerido" y jamás pueden publicarse sin una confirmación explícita en
un diálogo que resuma SKU, costo, precio actual y precio sugerido.
```

**Prompt 6 — Command palette**
```
Implementa una command palette con el componente Command de shadcn/ui abierta con ⌘K /
Ctrl+K. Grupos: Navegar (catálogo, fichas, precios, importaciones, mapa), Buscar
(por SKU, GTIN, proveedor), Acciones (reprocesar importación, drenar costos pendientes,
recalcular precios) y Vista (densidad, tema). Toda acción de la paleta debe existir
también como botón visible en su pantalla. Registra los atajos en un único hook
useShortcuts para evitar colisiones.
```

**Prompt 7 — Auditoría final**
```
Audita el dashboard contra este checklist y entrégame una tabla con
archivo · problema · corrección propuesta, sin aplicar cambios todavía:
1) contraste WCAG AA (cuerpo 4.5:1, grande 3:1) en ambos temas;
2) elementos decorativos sin información (sombras, gradientes, iconos de color, cajas
   anidadas) susceptibles de borrarse;
3) números sin tabular-nums, sin alineación derecha o con decimales inconsistentes;
4) unidades o moneda ausentes en encabezados de columna;
5) estados faltantes (vacío, cargando, error, sin resultados);
6) información transmitida solo por color;
7) tablas sin header congelado, sin virtualización o con >1000 filas en cliente;
8) foco no visible en elementos interactivos;
9) animaciones >300ms o que ignoran prefers-reduced-motion.
```

---

## 9. Checklist de revisión visual (antes de dar por hecho cualquier pantalla)

- [ ] ¿Puedo borrar algo sin perder información? Bórralo.
- [ ] ¿La métrica más importante está arriba-izquierda?
- [ ] ¿Hay más de un acento de color en pantalla?
- [ ] ¿Los números están alineados a la derecha con los mismos decimales?
- [ ] ¿Cada columna dice su unidad?
- [ ] ¿El estado se entiende en blanco y negro?
- [ ] ¿La tabla sobrevive a 15,000 filas?
- [ ] ¿Puedo hacer todo el flujo sin mouse?
- [ ] ¿Existen los 5 estados (vacío, cargando, error, parcial, sin resultados)?
- [ ] ¿El foco de teclado es visible en todo?
