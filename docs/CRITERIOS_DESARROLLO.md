# Criterios Universales de Desarrollo

> Documento CURADO (manual). Fuente de verdad para evaluar TODO cambio de código,
> infraestructura o arquitectura del gestor. Aplican a cualquier servicio, proveedor
> o plataforma (MeLi, Amazon, Sheets, Supabase, Vercel, un VPS, un servicio nuevo),
> no a uno en particular.

---

## 1. Reglas transversales (no negociables)

1. **Agnóstico de servicio.** Ninguna regla, abstracción ni decisión debe estar atada
   a un proveedor específico. "Conectar MeLi" se escribe como "conectar un marketplace";
   "Vercel" como "la plataforma de cómputo". Un cambio debe sobrevivir a reemplazar el
   servicio subyacente sin reescribir la lógica de negocio.
2. **Validar todo con evidencia dura.** Ningún claim se acepta sin verificación contra
   código real, datos vivos y/o prueba ejecutable. Prohibido afirmar "funciona" sin
   demostrarlo.
3. **No adular, despedazar.** En revisión, se buscan fallos activamente. Una validación
   que no encontró nada es sospechosa, no virtuosa.
4. **Actuar solo con autorización explícita.** Cambios de riesgo (DDL, migraciones,
   tocar producción, datos reales) requieren OK previo. Nada de "lo hice porque era obvio".
5. **No romper lo que ya funciona.** Este es el criterio supremo (ver sección 4).

---

## 2. Triple horizonte (mínimo)

Todo lo que se construye debe servir en **tres** horizontes simultáneos, no solo dos:

| Horizonte | Pregunta que debe responder SÍ |
|---|---|
| **H1 — Ahora** | ¿Funciona hoy con la infraestructura y fuentes actuales (sync activo, doble escritura)? |
| **H2 — Después** | ¿Funciona mañana tras la migración/corte (standalone, sin la fuente legada)? |
| **H3 — Otras funciones/servicios** | ¿La abstracción sirve para un segundo servicio, proveedor o flujo distinto sin reescribir? |

Regla práctica: si una decisión solo sirve para "MeLi", "Vercel" o "este flujo puntual",
está mal encapsulada. Debe expresarse como contrato genérico con adaptadores detrás.

---

## 3. Optimización de recursos (no "todo gratis", sí "usar lo mínimo necesario")

1. **El costo es una palanca, no una religión.** No se prohíbe pagar; se prohíbe
   desperdiciar. Si subir un tier resuelve un cuello de botella real, se evalúa y se
   propone con números. Si se puede resolver con lo que ya hay, no se gasta.
2. **Mismo o menos recursos, más velocidad.** Toda optimización busca acelerar el
   gestor **sin aumentar** consumo (CPU, memoria, llamadas externas, filas, conexiones).
   Si algo es más rápido pero quema el doble de cuota, no es una optimización.
3. **No despertar al sistema sin necesidad.** Evitar polling, escaneos completos y
   llamadas redundantes. Preferir eventos (webhooks, triggers) sobre sondeos; y si hay
   sondeo, que sea cadenciado, con corte temprano y con condición de parada.
4. **Cargar solo el área de interés.** No traer 1,000 filas para usar 20; no pedir
   atributos que no se usan; no recalcular lo cacheable. Batch y paginación por defecto.
5. **Toda pieza de trabajo debe poder detenerse.** Jobs, carruseles, sincronizadores y
   barridos exigen condición de parada explícita y demostrable (se reduce a 0 y se
   detiene, o se corta por tiempo). Prohibido cualquier "bucle que se auto-perpetúa".

---

## 4. No regresión (criterio supremo)

Ningún cambio se acepta si rompe **técnica** o **funcionalmente** cualquier
funcionalidad actual. Esto se garantiza con:

1. **Compilación limpia.** TypeScript estricto (`tsc --noEmit`) y build del artefacto
   en un entorno con dependencias sanas. Un "exit code 1" por entorno roto NO cuenta
   como fallo del cambio; hay que verificar en entorno limpio.
2. **No tocar lo que no se debe.** El alcance de cada cambio se declara y se respeta.
   Si toca código compartido, se revisa cada consumidor antes de editar.
3. **Verificación funcional en vivo.** Para cambios que afectan datos o integraciones,
   una prueba real contra producción (o contra un caso representativo) antes de dar
   por cerrado. Un build verde no descarta un crash de cliente ni un dato mal escrito.
4. **Manejo de casos límite.** Lo que falla no debe bloquear el resto (poison pill,
   head-of-line blocking): sellar, aislar y avanzar, dejando trazabilidad.
5. **Rollback conocido.** Toda acción de riesgo declara cómo se deshace (migración
   reversible, revert de commit, flag de apagado).

---

## 5. Reutilizar sobre reescribir

1. Antes de crear, buscar lo existente: función, tabla, endpoint, patrón, columna.
   Reutilizar es la opción por defecto.
2. Un solo motor para una responsabilidad. Nunca dos implementaciones del mismo
   comportamiento; la variación se expresa como configuración, no como código duplicado.
3. Lo que ya existe y funciona se **adapta**, no se reemplaza, salvo que haya evidencia
   de que es insostenible.

---

## 6. Ágil y simple

1. **Cambios quirúrgicos.** El menor diff que resuelva el problema. Prohibido refactor
   incidental mientras se arregla un bug.
2. **Simple sobre elegante.** La solución que otro humano entiende en una lectura gana
   sobre la ingeniosa. Complejidad solo se acepta con justificación medible.
3. **Escalable por configuración.** Añadir una fuente, proveedor o servicio nuevo debe
   ser "insertar una fila / un adaptador", no "programar un módulo".
4. **Feedback inmediato.** Toda operación asíncrona comunica estado (cargando, éxito,
   error legible) sin bloquear al usuario.

---

## 7. Gobernanza de código (mínimo exigible)

1. **Encapsular el servicio tras una interfaz.** La lógica de negocio no conoce el
   proveedor; conoce un contrato. Los detalles viven en un adaptador.
2. **Acceso a datos defensivo.** Todo payload externo se normaliza al borde (`?.`, `??`,
   saneo centralizado) antes de renderizar o procesar.
3. **Errores legibles.** Prohibido exponer errores crudos (SQL, stack) al usuario;
   traducir a mensajes humanos.
4. **UTF-8 puro.** Sin caracteres de dibujo, sin encodings locales.
5. **Type-safe.** Tipos estrictos; indexación dinámica tratada como posible `undefined`.

---

## 8. Checklist de aceptación (aplicar a TODO cambio)

Antes de dar un cambio por terminado, responder afirmativamente:

- [ ] ¿Compila limpio en entorno sano (typecheck + build)?
- [ ] ¿No rompe H1 (funciona ahora), H2 (funciona tras el corte) ni H3 (sirve a otro servicio)?
- [ ] ¿Usa los mismos o menos recursos que antes (o justifica el incremento con números)?
- [ ] ¿Reutiliza lo existente en vez de duplicar?
- [ ] ¿Tiene condición de parada y maneja el caso límite sin bloquear el resto?
- [ ] ¿Está encapsulado tras una interfaz agnóstica de servicio?
- [ ] ¿Se validó funcionalmente (prueba real) y no solo con build?
- [ ] ¿Hay rollback definido para la acción de riesgo?
- [ ] ¿Se actuó con autorización explícita?

---

## Historial de consolidación

- 2026-10-24 — Creación. Consolida los criterios verbales del usuario + las políticas
  documentadas en `POLITICAS_FRONTEND.md`, `MIGRACION_APPSSHEET_TAREAS.md` y
  `PROPUESTA_PUBLICADOR_MULTIPROVEEDOR_v1.md`, elevadas a reglas universales
  agnósticas de servicio.
