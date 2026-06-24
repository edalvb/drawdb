# PRD — Optimización de rendimiento del canvas (pan / zoom / arrastre)

- **Autor:** Edward
- **Fecha:** 2026-06-23
- **Estado:** Propuesta
- **Área:** Editor de diagramas (`src/components/EditorCanvas`, `src/context`)
- **Stack relevante:** React 18.2, Vite 6, SVG (`<foreignObject>`), Semi-UI

---

## 1. Resumen

Al mover el ratón sobre el lienzo, hacer pan, zoom o arrastrar elementos, el diagrama
se siente con *lag*. El análisis del código muestra que la causa no es el dibujado de
SVG en sí, sino una **cascada de re-render de React que repinta todo el diagrama en cada
evento de puntero** (~60–120 Hz), incluso cuando solo se mueve el cursor sin arrastrar nada.

Este documento define el problema, su causa raíz con referencias al código, los objetivos
medibles y un plan de implementación por fases, ordenado por relación impacto/esfuerzo.

---

## 2. Problema y contexto

Síntomas reportados:

- Mover el cursor por el lienzo (sin arrastrar) ya produce *jank*.
- El pan y el zoom van a tirones, especialmente con varias tablas/relaciones.
- Arrastrar una tabla mueve todo de forma entrecortada.

El editor mantiene **todo el estado del diagrama en React Context** y dibuja cada tabla,
relación, área y nota como componentes hijos de un único `Canvas`. Cualquier cosa que
cambie en un contexto consumido por `Canvas` vuelve a renderizar **todos** los elementos,
porque ninguno está memoizado.

---

## 3. Análisis de causa raíz

### 3.1 Las coordenadas del puntero viven en Context y se actualizan en cada `pointermove` — (CRÍTICO)

`CanvasContextProvider` guarda la posición del puntero en estado de React y la actualiza
en **cada** evento `pointermove` y `pointerdown`:

- `detectPointerMovement` llama a `setPointerScreenCoords(...)` en cada movimiento
  — `src/context/CanvasContext.jsx:124-139`.
- El `contextValue` se reconstruye como **objeto literal nuevo en cada render** (no está
  memoizado) — `src/context/CanvasContext.jsx:141-158`.

Como el value cambia de identidad en cada render, **todos** los consumidores de
`CanvasContext` se re-renderizan. El único consumidor directo es `Canvas`
(`src/components/EditorCanvas/Canvas.jsx:42`), pero `Canvas` dibuja todas las tablas,
relaciones, áreas y notas (`src/components/EditorCanvas/Canvas.jsx:776-828`). Dado que
`Table`, `Relationship`, `Area` y `Note` **no usan `React.memo`**, mover el cursor
repinta el diagrama completo a frecuencia de evento de puntero.

> **Impacto:** este es el cuello de botella dominante. Solo hover sobre el lienzo ya
> dispara renders completos del diagrama.

### 3.2 Pan/zoom mutan `transform` (Context) y arrastran 3 providers de datos — (CRÍTICO)

Durante el pan, `handlePointerMove` llama a `setTransform(...)` en cada movimiento
(`src/components/EditorCanvas/Canvas.jsx:318-331`); el zoom hace lo mismo en el handler
de `wheel` (`src/components/EditorCanvas/Canvas.jsx:688-716`).

`transform` vive en `TransformContext`. El problema es **quién se suscribe a él**:

- `DiagramContext` lo lee solo para `addTable` — `src/context/DiagramContext.jsx:16`.
- `AreasContext` y `NotesContext` lo leen solo para posicionar nuevos elementos.
- Ninguno de esos tres providers memoiza su `value` (`src/context/DiagramContext.jsx:318-336`).

Resultado: **cada movimiento de pan/zoom re-renderiza `DiagramContext`, `AreasContext` y
`NotesContext`**, y como sus values cambian de identidad, se re-renderizan **todos** sus
consumidores (todo el diagrama). El único cambio de DOM realmente necesario para un pan
es el atributo `viewBox` del `<svg>` (`src/components/EditorCanvas/Canvas.jsx:744`); en su
lugar React reconcilia el árbol completo.

### 3.3 Los elementos del canvas no están memoizados — (ALTO)

`Table`, `Relationship`, `Area` y `Note` son componentes de función sin `React.memo`. Cada
vez que `Canvas` se re-renderiza (que es muy a menudo, ver 3.1/3.2) los cuatro se vuelven a
renderizar aunque sus props no hayan cambiado. `Table` es especialmente caro: monta
`Popover`/`ButtonGroup` por fila, `foreignObject` con DOM completo, etc.

### 3.4 Trabajo costoso por render dentro de los elementos — (ALTO)

- **`Relationship.pathValues`** depende del array `tables` completo
  (`src/components/EditorCanvas/Relationship.jsx:23-65`). Al mover **una** tabla cambia la
  referencia de `tables`, así que **todas** las relaciones recalculan, y cada una hace dos
  `tables.find` → O(relaciones × tablas) por movimiento.
- **`calcPath` se ejecuta dos veces por relación y por render** (path invisible de hover +
  path visible), sin memoizar — `src/components/EditorCanvas/Relationship.jsx:176-207`.
- **Lecturas de geometría en pleno render**: `pathRef.current.getTotalLength()` y
  `getPointAtLength()` para colocar etiqueta/cardinalidad
  (`src/components/EditorCanvas/Relationship.jsx:130-145`). Fuerzan *layout/reflow* síncrono
  en cada render.
- **`Table.getFieldReference`** recorre `relationships` por cada campo en cada render
  (`src/components/EditorCanvas/Table.jsx:217-235`) → O(campos × relaciones) por tabla.

### 3.5 El arrastre reconstruye el array `tables` en cada `pointermove` — (MEDIO)

Al arrastrar, `handlePointerMove` llama a `updateTable` por cada elemento seleccionado, y
`updateTable` hace `setTables(prev => prev.map(...))` (`src/context/DiagramContext.jsx:147-159`),
generando un array nuevo en cada movimiento. Combinado con 3.3 y 3.4, arrastrar una tabla
recalcula todas las tablas y relaciones en cada frame.

### 3.6 Sin coalescencia a frames de animación — (MEDIO)

Pan, zoom, arrastre y hover hacen `setState` de forma síncrona por evento de puntero. Los
eventos de puntero llegan más rápido que los frames; sin agrupar por `requestAnimationFrame`
se hace trabajo de render que nunca se llega a pintar.

### 3.7 Sin *culling*/virtualización — (BAJO / escala)

Se renderizan todos los elementos aunque estén fuera de la `viewBox`. Para diagramas grandes
(cientos de tablas) esto multiplica el coste de cada uno de los puntos anteriores.

---

## 4. Objetivos

1. Mover el cursor sobre el lienzo **no debe** provocar render de los elementos del diagrama.
2. Pan y zoom deben actualizar solo la transformación del lienzo, sin re-renderizar tablas/relaciones.
3. Arrastrar elementos debe re-renderizar únicamente los elementos arrastrados y sus relaciones conectadas.
4. Mantener 60 fps en pan/zoom/arrastre con un diagrama de referencia de **50 tablas / 80 relaciones**.

### No objetivos

- Reescribir el render SVG a Canvas2D/WebGL.
- Cambiar el modelo de datos persistido o el formato de exportación.
- Rediseñar la UI o el comportamiento funcional (es puramente rendimiento; sin regresiones visibles).

---

## 5. Métricas de éxito

| Métrica | Línea base (estimada) | Objetivo |
|---|---|---|
| Renders de `Table`/`Relationship` al hacer *hover* sin arrastrar | 1 por evento de puntero | **0** |
| Componentes re-renderizados por frame de pan | Todo el diagrama | Solo el contenedor de transform |
| Componentes re-renderizados al arrastrar 1 tabla | Todas las tablas + todas las relaciones | Tabla(s) arrastrada(s) + relaciones conectadas |
| FPS en pan/zoom (50 tablas / 80 rel.) | < 30 (con jank) | ≥ 55 |
| Tiempo de *scripting* por frame en arrastre (Performance panel) | — | reducción ≥ 70 % |

Validación con el **React DevTools Profiler** ("Highlight updates" + grabación de
interacciones) y el **panel Performance** de Chrome.

---

## 6. Solución propuesta (por fases)

Orden por relación impacto/esfuerzo. Cada fase es independiente y entregable por separado.

### Fase 1 — Sacar el puntero del camino de render (resuelve 3.1) · impacto ALTÍSIMO / esfuerzo BAJO

**Qué:** dejar de propagar `pointerScreenCoords`/`pointerDiagramCoords` por Context en cada
movimiento.

Opciones (de menor a mayor cambio):

1. **Memoizar `contextValue`** en `CanvasContext` con `useMemo` y **separar el puntero** en su
   propia porción de contexto (o exponerlo vía `ref`), de modo que `Canvas` lea la posición
   del puntero sin que ese valor forme parte del value que consumen los hijos.
2. Mantener la posición del puntero en un `useRef` y exponer un *getter* (`pointer.get()`),
   actualizándola sin `setState`; solo se hace `setState` cuando algo que se dibuja realmente
   depende de ella (p. ej. la línea de *linking*).

**Por qué:** elimina el render del diagrama completo en cada `pointermove`. Es el mayor
retorno con el menor riesgo.

**Archivos:** `src/context/CanvasContext.jsx`, `src/components/EditorCanvas/Canvas.jsx`.

### Fase 2 — Pan/zoom vía transform de contenedor, no `viewBox` global (resuelve 3.2) · impacto ALTO / esfuerzo MEDIO

**Qué:** aplicar pan/zoom como `transform="translate(...) scale(...)"` sobre un único `<g>`
contenedor (o `style.transform` sobre un wrapper), en lugar de recalcular `viewBox` y
re-renderizar. Idealmente, durante el gesto la transformación se escribe **imperativamente**
en el nodo (sin pasar por estado de React) y solo se hace *commit* a estado al soltar.

Además: **desacoplar `DiagramContext`/`AreasContext`/`NotesContext` de `useTransform`**. Esos
providers solo necesitan `transform.pan` puntualmente al crear un elemento; léelo mediante un
`ref` (`transformRef.current.pan`) en vez de suscribirse al contexto, para que pan/zoom no los
re-renderice.

**Por qué:** convierte el pan/zoom en una mutación de un solo atributo/estilo, eliminando la
cascada de las secciones 3.2.

**Archivos:** `src/context/CanvasContext.jsx`, `src/context/TransformContext.jsx`,
`src/components/EditorCanvas/Canvas.jsx`, `src/context/DiagramContext.jsx`,
`src/context/AreasContext.jsx`, `src/context/NotesContext.jsx`.

### Fase 3 — Memoizar los elementos del canvas (resuelve 3.3) · impacto ALTO / esfuerzo BAJO

**Qué:** envolver `Table`, `Relationship`, `Area` y `Note` en `React.memo`. Para que la
memoización funcione, estabilizar las props:

- Callbacks (`setHoveredTable`, `handleGripField`, `setLinkingLine`, `onPointerDown`, etc.)
  con `useCallback` en `Canvas` (hoy `onPointerDown` se crea como flecha inline por elemento).
- Pasar identificadores en lugar de objetos recreados cuando sea posible.

**Por qué:** una vez que Context deja de re-renderizar `Canvas` por puntero/pan, `React.memo`
garantiza que un cambio en una tabla no repinte las demás.

**Archivos:** los cuatro componentes de `src/components/EditorCanvas/` y `Canvas.jsx`.

### Fase 4 — Índices/selectores en vez de búsquedas O(n) por render (resuelve 3.4) · impacto MEDIO-ALTO / esfuerzo MEDIO

**Qué:**

- Construir, en el provider o en `Canvas`, un `Map` `tableId → table` y un índice
  `tableId → relaciones conectadas`, memoizados sobre `tables`/`relationships`.
- En `Relationship`, derivar `pathValues` **solo de las dos tablas implicadas** (no del array
  completo), para que mover una tabla recalcule únicamente sus relaciones.
- Calcular `calcPath`/`calcCompositePath` **una sola vez** por render y reutilizar el resultado
  para el path visible y el invisible de hover.
- Mover las lecturas de geometría (`getTotalLength`/`getPointAtLength`) a `useLayoutEffect`/refs
  para no forzar reflow en cada render.
- En `Table`, precalcular las referencias de campo (FK) una vez por tabla desde el índice de
  relaciones, en lugar de O(campos × relaciones).

**Archivos:** `src/components/EditorCanvas/Relationship.jsx`,
`src/components/EditorCanvas/Table.jsx`, `src/utils/utils.js`, `src/context/DiagramContext.jsx`.

### Fase 5 — Coalescer interacciones a `requestAnimationFrame` (resuelve 3.5/3.6) · impacto MEDIO / esfuerzo BAJO

**Qué:** durante pan y arrastre, acumular el último evento y aplicar el `setState`/escritura
una vez por frame con `requestAnimationFrame`. Para el arrastre, considerar mantener las
coordenadas "en vuelo" fuera del estado del diagrama y hacer *commit* a `updateTable` solo al
soltar (el historial de undo ya se crea en `pointerup`).

**Archivos:** `src/components/EditorCanvas/Canvas.jsx`.

### Fase 6 (opcional, escala) — *Culling* por viewport (resuelve 3.7) · impacto ALTO en diagramas grandes / esfuerzo MEDIO-ALTO

**Qué:** no renderizar elementos cuyo *bounding box* quede fuera de la `viewBox` (con margen).
Recalcular el conjunto visible solo al terminar pan/zoom, no durante el gesto.

**Archivos:** `src/components/EditorCanvas/Canvas.jsx`.

---

## 7. Plan de implementación sugerido

1. **Fase 1 + Fase 3** juntas: máximo impacto inmediato (hover y repintado), bajo riesgo.
2. **Fase 2**: pan/zoom fluidos; requiere cuidado con la conversión de espacios de coordenadas
   (pantalla ↔ diagrama) que hoy dependen de `viewBox`.
3. **Fase 4 + Fase 5**: arrastre fluido y coste de relaciones acotado.
4. **Fase 6**: solo si se necesitan diagramas de gran escala.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cambiar de `viewBox` a `transform` rompe la conversión pantalla↔diagrama (selección por rectángulo, *linking*, snap a grid). | Centralizar la conversión en `CanvasContext.coords` y cubrir con casos de prueba manuales antes/después; cambiar la fórmula en un solo lugar. |
| `React.memo` mal aplicado (props inestables) no aporta o introduce *bugs* de estado obsoleto. | Verificar con el Profiler que los renders bajan; estabilizar callbacks con `useCallback`. |
| Escritura imperativa del transform durante el gesto se desincroniza del estado de React. | Hacer *commit* a estado en `pointerup`/fin de `wheel` y tratar el estado como fuente de verdad en reposo. |
| Leer `transform` por `ref` en los providers de datos devuelve valores obsoletos. | Mantener el `ref` sincronizado en cada `setTransform`; solo se usa en acciones puntuales (crear tabla/área/nota), no en render. |
| El *culling* hace "parpadear" elementos al entrar en viewport. | Añadir margen generoso a la viewBox y recalcular solo al finalizar el gesto. |

---

## 9. Validación

- **React DevTools Profiler**: grabar hover, pan, zoom y arrastre antes y después; confirmar
  los objetivos de la sección 5 ("Highlight updates" no debe iluminar tablas al hacer hover).
- **Chrome Performance**: medir *scripting time* por frame y FPS con el diagrama de referencia.
- **Pruebas manuales de no-regresión**: selección por rectángulo, creación de relaciones
  (*linking*), *snap to grid*, redimensionado de áreas/notas, undo/redo, modo colaboración
  (`emitAwareness`/`emitDelta`) y modo solo lectura.
- **Diagramas de prueba**: pequeño (5/5), referencia (50/80) y grande (200+/300+).

---

## 10. Apéndice — Mapa de referencias de código

- Puntero en estado + value sin memoizar: `src/context/CanvasContext.jsx:124-158`
- Render de todos los elementos en `Canvas`: `src/components/EditorCanvas/Canvas.jsx:776-828`
- `setTransform` en pan: `src/components/EditorCanvas/Canvas.jsx:318-331`
- `setTransform` en zoom (wheel): `src/components/EditorCanvas/Canvas.jsx:688-716`
- `viewBox` del `<svg>`: `src/components/EditorCanvas/Canvas.jsx:744`
- Providers de datos suscritos a transform: `src/context/DiagramContext.jsx:16`,
  `src/context/AreasContext.jsx`, `src/context/NotesContext.jsx`
- Value de `DiagramContext` sin memoizar: `src/context/DiagramContext.jsx:318-336`
- `updateTable` reconstruye `tables`: `src/context/DiagramContext.jsx:147-159`
- `pathValues` depende de `tables` completo: `src/components/EditorCanvas/Relationship.jsx:23-65`
- `calcPath` duplicado en render: `src/components/EditorCanvas/Relationship.jsx:176-207`
- Geometría en render: `src/components/EditorCanvas/Relationship.jsx:130-145`
- `getFieldReference` O(campos×relaciones): `src/components/EditorCanvas/Table.jsx:217-235`
