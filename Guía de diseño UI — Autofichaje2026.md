# Guía de diseño UI — Autofichaje2026 (v2 · canónica)

> Esta guía reemplaza a la versión anterior. Describe el sistema de diseño **que ya está
> implementado** y que es la referencia correcta del proyecto: los **3 temas de apariencia**
> (`dim` / `solarized` / `sepia`), el vocabulario de tokens de `globals.css` y los patrones de
> componente usados en el **módulo de vidrieras** (`/catalog/external`) y en el **módulo de
> precios** (tarjeta de auditoría). Cualquier pantalla nueva debe seguir estas reglas, no las
> de la guía anterior.

---

## 1. Principio rector

El producto es una **herramienta operativa diaria** (catálogo, vidriera/MeLi, precios, fichas
técnicas). Por eso la UI debe ser **densa, dark-first y silenciosa**: el dato manda, la
decoración desaparece. Reglas derivadas:

- **Un acento + neutros.** El acento es solo para foco, links, acción primaria y serie de datos.
- **Color = estado de negocio, nunca adorno.** `ok`/`warn`/`err`/`info` solo representan el estado
  de una entidad (publicación, precio, ficha, importación), y siempre acompañados de icono + texto.
- **Sin colores hardcodeados.** Prohibido `bg-green-100`, `text-indigo-700`, `bg-purple-50/60`,
  `text-rose-900`, `bg-emerald-100`, etc. Todo color sale de los tokens.
- **Los números y códigos van en mono y alineados.** SKU, GTIN, importes: `font-mono` +
  `tabular-nums` y alineación derecha en columnas.

---

## 2. Temas de apariencia (los 3 que se mantienen)

Definidos en `apps/dashboard/src/app/globals.css` y conmutados por
`apps/dashboard/src/components/ui/ThemeSwitcher.tsx`. **No se añaden ni se quitan temas por ahora.**

| `data-theme` | Nombre | Carácter |
|---|---|---|
| `dim` (default) | Dim / Oscuro | Fondo Discord (`#313338`), acento blurple `#5865F2` |
| `solarized` | Solarized | Fondo `#002B36`, acento `#2AA198` |
| `sepia` | Sepia | Fondo `#3E2723`, acento `#FFB300` |

Reglas:
- El tema se guarda en `localStorage('theme')` y se aplica **antes del primer paint** (inline en
  `layout.tsx`), sin flash.
- Todo componente lee los tokens, jamás un hex de un tema concreto. Así los 3 temas funcionan sin
  tocar los componentes.

---

## 3. Vocabulario de tokens (copiar tal cual)

```css
:root, [data-theme="dim"] {
  --bg:            #313338;   /* fondo app */
  --surface:       #2B2D31;   /* cards, paneles, header de tabla */
  --surface-2:     #232428;   /* hover de fila, inputs, bandas de header */
  --border:        #43454B;   /* 1px, apenas visible */
  --border-strong: #4E5058;   /* foco, separadores fuertes */

  --text:          #F2F3F5;   /* texto principal */
  --text-muted:    #B5BAC1;   /* labels, secundarios */
  --text-faint:    #80848E;   /* iconos, códigos, timestamps */

  --accent:        #5865F2;   /* links, foco, acción primaria */
  --accent-ink:    #FFFFFF;   /* texto sobre accent sólido */

  --ok:            #23A559;   /* publicado / vigente / mapeado */
  --warn:          #FEE75C;   /* pendiente / borrador-cálculo / sugerido */
  --err:           #DA373C;   /* error / sin match / roto */
  --info:          #00A8FC;   /* procesando / job corriendo */

  --radius: 8px;   --radius-sm: 6px;
}
```

Patrón clave para **badges/estados sobre fondo oscuro** (translúcido, no pastel):

```
bg-[var(--ok)]/10    text-[var(--ok)]    border border-[var(--ok)]/30
bg-[var(--warn)]/10  text-[var(--warn)]  border border-[var(--warn)]/30
bg-[var(--err)]/10   text-[var(--err)]   border border-[var(--err)]/30
bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30
```

Para estado "neutral / sin dato": `bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]`.

---

## 4. Tipografía

- **Cuerpo:** `text-sm` (14px). **Piso absoluto para texto legible: 12px.**
- **Micro-labels:** `text-[10px]` **solo** para encabezados de columna (`uppercase tracking-widest`),
  badges, códigos mono y timestamps. Nada por debajo de 10px.
- **Código y números:** `font-mono` para SKU, GTIN, precios, IDs. Números en columna con
  `tabular-nums` y alineación derecha.
- **Jerarquía sin tamaño excesivo:** título de página `text-2xl font-bold`, sección `text-lg font-bold`,
  título de tarjeta `text-sm font-semibold`, precio hero `text-2xl font-bold font-mono`.

---

## 5. Patrones de componente

### 5.1 Tarjeta (Card)

Anatomía canónica (referencia: `pricing-audit-card.tsx`):

```
<div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden flex flex-col shadow-sm">
  {/* Header band */}
  <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-[var(--accent)]" />
      <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Título</h2>
    </div>
    {/* badge de estado a la derecha */}
  </div>
  {/* Body */}
  <div className="p-5 flex-1 space-y-4">…</div>
</div>
```

Reglas de tarjeta:
- `rounded-[var(--radius)]` (8px), no radios de 12–16px.
- Sombra como máximo `shadow-sm`; sin gradientes.
- La jerarquía la carga la tipografía y el espaciado, no cajas anidadas ni iconos de colores.

### 5.2 Badge de estado (icono + texto, nunca solo color)

```
<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30">
  <Icon className="w-3 h-3" /> Texto
</span>
```

- Un solo mapa de estado por dominio: `Record<string, { label: string; color: string }>`.
- El estado se entiende en blanco y negro: **punto/icono + etiqueta de texto**, no solo color.

### 5.3 Tabla de datos

Referencia: listado de vidrieras (`/catalog/external/page.tsx`) y listado de fichas
(`/fichas/page.tsx`).

```tsx
<table className="w-full text-sm">
  <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
    <tr>
      <th className="text-left px-5 py-3 text-[10px] font-bold text-[var(--text-faint)] uppercase tracking-widest">Columna</th>
    </tr>
  </thead>
  <tbody className="divide-y divide-[var(--border)]">
    <tr className="hover:bg-[var(--bg)] transition-colors">…</tr>
  </tbody>
</table>
```

- Tabla semántica (`<table>`, `<th scope="col">`), no divs.
- Sin zebra: separador `divide-[var(--border)]` + hover `bg-[var(--bg)]`.
- Texto a la izquierda, números a la derecha con `tabular-nums`.
- Acción de fila siempre en la misma posición (última columna), visible en hover.

### 5.4 Botones de acción

| Tipo | Clases |
|---|---|
| Primario | `bg-[var(--accent)] text-[var(--accent-ink)] rounded-[var(--radius-sm)] text-xs font-bold hover:brightness-110 disabled:opacity-50` |
| Secundario / outline accent | `bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-sm)]` |
| Ghost | `text-[var(--text-muted)] hover:text-[var(--text)]` |

- Todo botón lleva **icono + texto explícito**. Nada de iconos sueltos sin `title`/`aria-label`.
- **Un solo botón primario por superficie.** El resto son secundarios o ghost.

### 5.5 Panel de filtros (sidebar)

Referencia: `filters-sidebar.tsx`. Accordion con `border-b border-[var(--border)]`, título
`text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]`, items checkbox/radio de
`text-xs`, contador `text-[10px] bg-[var(--surface-2)] rounded`.

### 5.6 Barra de salud / progreso

Referencia: `HealthBar` en vidriera. Relleno con color de estado + valor numérico en
`text-[10px] tabular-nums`, nunca solo la barra de color.

---

## 6. Reglas de nomenclatura (importante)

- **"Artículo"** = el registro maestro del producto (tabla `articulos`). Su vista es la **ficha del
  artículo** (`/catalog/[id]`).
- **"Ficha técnica"** = el documento técnico asociado al artículo (tabla `fichas_tecnicas`).
  Siempre decir "ficha técnica", nunca "ficha" a secas para referirse al artículo.
- La palabra "ficha" sola está **prohibida** como etiqueta de botón; usar "Abrir artículo",
  "Ver ficha técnica", "Crear ficha técnica".
- "Vidriera" = el listado de publicaciones externas (MeLi) (`/catalog/external`).

---

## 7. Anti-patrones a eliminar (auditoría)

1. Hex hardcodeados (`bg-green-100`, `text-indigo-700`, `bg-purple-50/60`, `text-rose-900`,
   `text-slate-300`, `bg-emerald-100`, `bg-amber-100`, …) → tokens o chips translúcidos.
2. Estado comunicado solo con color → añadir icono + texto.
3. Texto por debajo de 10px, o cuerpo por debajo de 12px.
4. Números sin `tabular-nums` o sin alineación derecha en columnas.
5. Iconos de colores como decoración (KPI cards azul/verde/ámbar).
6. Radios grandes (12–16px) y sombras `shadow-md/xl` en tarjetas de datos → `rounded-[var(--radius)]`
   + `shadow-sm` o nada.
7. Cajas anidadas redundantes; preferir espaciado y separadores `border-[var(--border)]`.
8. Dos botones de igual peso con nombres ambiguos ("Ver ficha" vs "Crear ficha").

---

## 8. Checklist de revisión (antes de dar por buena una pantalla)

- [ ] ¿Usa solo tokens (`var(--…)`) y `data-theme`, sin hex de un tema concreto?
- [ ] ¿Los 3 temas (dim/solarized/sepia) se ven correctos sin tocar el componente?
- [ ] ¿Cada estado lleva icono + texto (no solo color)?
- [ ] ¿Los números/códigos están en mono, alineados a la derecha y con `tabular-nums`?
- [ ] ¿No hay texto por debajo de 10px, ni cuerpo por debajo de 12px?
- [ ] ¿Hay un único botón primario por superficie?
- [ ] ¿Los botones usan "artículo" y "ficha técnica" sin ambigüedad?
- [ ] ¿La tabla es `<table>` semántica, sin zebra, con hover sutil?
