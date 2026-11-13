# Traspaso — corte limpio y etapa 1: los equipos como extremos del circuito (rama `feat/equipos-extremos-circuito`)

## 0. Corte limpio: sin migración de proyectos anteriores
- **Decisión del operador (2026-11-13):** no hay proyectos guardados. Se cancela la migración automática que
  estaba pendiente (CUS con bocas viejas) y se saca del traspaso de curvas eslabonadas.
- **Archivo de proyecto:** pasa a `fileVersion 3` (`workspace/workspaceFile.ts`, `FILE_VERSION`). Un archivo
  v1 o v2 **no se abre**: la app avisa «El archivo es de una versión anterior de la app (versión de archivo N)
  y no es compatible con esta (versión 3). No se intenta repararlo.» No se toca el proyecto abierto ni la
  biblioteca. Se quitó la lectura de v1 (`catalogConfig`) y de v2.
- **Autoguardado (IndexedDB):** el esquema del registro pasa a `codex:workspaceProject/2`. Un registro `/1`
  se **aparta** (no se borra ni se repara) y se abre un proyecto vacío con el aviso de que no es compatible.
- **Circuitos guardados de boca a boca:** un archivo v3 que los traiga se rechaza
  (`validarCircuitosDeArchivo`). No se migran.
- **Fixture del operador:** `e2e/fixtures/user-report-20261107.workspace.json` se convirtió **una vez, con la
  app real** (abrir el v1 → guardar copia; script temporal de Playwright, ya borrado). Quedan iguales equipos
  (9), evidencia, conexiones, circuitos del motor y soportes; la app agregó la colocación deducida (5
  resueltas, 2 sin resolver, como antes) y las definiciones. El original v1 sigue en
  `e2e/fixtures/reference/…ORIGINAL…`: lo usan las pruebas de funciones sobre datos viejos (`migrateTray`) y la
  E2E que comprueba que un v1 se rechaza.
- **Quedó sin tocar, a decidir:** la deducción de colocación al abrir (A-10, `placement/migration.ts`) y la
  acción «Guardar longitudes con las reglas vigentes» (`recorridos/longitudesAnteriores.ts`) siguen en la
  app. Con el corte limpio ya no les llegan archivos viejos; son candidatas a retirarse en otro encargo.

## 1. La bajada: el enlace equipo ↔ bandeja (`workspace/equipos/bajada.ts`)
- El operador elige un **equipo** y un **punto de salida** sobre un tramo recto: tramo, distancia desde una de
  sus bocas y lado. Es **la misma maquinaria que el enganche de la derivación**: se sacaron de
  `derivacion/enganche.ts` las piezas compartidas (`geometriaPuntoEnTramo`, `fotoTronco`, `motivosTronco`,
  `distanciaBocaAPunto`) y la derivación las usa igual que antes. En la interfaz, los campos son un componente
  compartido (`stages/PuntoEnTramoCampos.tsx`) que usan los dos formularios.
- **Declarado por el operador (2026-11-13), con esa procedencia en el dato:**
  - la bajada es un **tramo recto** desde el punto de salida de la bandeja hasta el punto de conexión del
    equipo. Es **cable al aire o por caño, no bandeja**: su longitud **cuenta** en la longitud del circuito y
    **no computa ninguna pieza de bandeja** (no agrega piezas ni conexiones al trazado y no viaja al motor);
  - **punto de conexión del equipo = el centro del equipo**, es decir su posición guardada (los equipos no
    tienen un punto de conexión propio; su caja o cilindro se dibuja centrado ahí). Si el equipo está dentro
    de otro, se compone con la posición y el giro de sus padres.
- **Punto de salida:** sobre el flanco del lado elegido, a la altura del eje (medio ancho del tramo hacia
  afuera), igual que la cara de apoyo de una derivación.
- **Persistencia:** clave workspace-only `bajadas_ws` del trazado. Cada bajada guarda el punto de salida, el
  punto del equipo, su largo, la foto del tramo y la procedencia. Un equipo tiene **una** bajada; para
  cambiarla se borra y se crea otra.
- **Desactualizada con su motivo** (`estadoBajada`) si el equipo se mueve, se borra o queda sin ubicar, o si el
  tramo del punto de salida se mueve, rota, cambia de largo o se borra. **Nada se recalcula solo.** Girar un
  equipo no mueve su centro: no la desactualiza.
- **Dibujo:** línea de trazos del punto de salida al centro del equipo (`equipos/BajadasEnEscena.tsx`), en
  color de aviso si está desactualizada.

## 2. Circuito de un equipo a otro (`workspace/recorridos/circuitosGuardados.ts`)
- **Origen y destino son equipos.** El recorrido lo resuelve el camino que ya existía (`caminoEntreBocas`): el
  tramo tiene una pseudo-boca `bajada:<id>` (como `enganche:<id>`), y el camino va de la del origen a la del
  destino. Sobre el tramo de salida cuenta la distancia guardada desde la boca por la que se entra; si los dos
  equipos salen del mismo tramo, el trecho entre los dos puntos.
- **Longitud:** total = bandeja + bajada de origen + bajada de destino, guardada **desglosada** (`bandejaMm`,
  `bajadasMm`, y el largo de cada bajada).
- **Sin camino:** se dice por qué, con el mismo criterio que antes (uniones que no cumplen, enganche
  desactualizado, piezas no unidas). Además: el equipo no tiene enlace, el enlace está desactualizado, origen
  y destino son el mismo equipo.
- **Desactualizado** (`estadoCircuito`, que ahora recibe los equipos) por todo lo de antes y además: equipo
  movido o borrado, enlace borrado o cambiado (firma), punto de salida desactualizado.
- **Interfaz (Conexiones):** «Equipos enlazados con la bandeja» (formulario y lista con estado) y «Circuito
  entre dos equipos» (desglose y guardar). La sección de dos bocas quedó como **«Medir entre dos bocas»**, sin
  guardar. **Resultados:** la tabla muestra los equipos y las columnas Longitud total, Bandeja y Bajadas; lo
  mismo en «Copiar tabla».

## Fuera de alcance (etapa 2)
- Asignar cable, cantidad y función; mandar el circuito al motor. El motor no se tocó.

## Pendientes y observaciones
- La pestaña «Conexiones» de la barra de etapas dice «N circuitos» contando los circuitos **del motor**
  (`entrada.circuitos`), no los guardados de equipo a equipo. Es de interfaz: queda para ese encargo.
- La ficha del equipo sólo permite editar la posición de un tablero con forma de caja, de un motor con forma de
  cilindro o de un sensor (`EquipmentEditorPanel.canEdit`, ya existía). Un equipo sin forma se mueve con el gizmo.

## Pruebas
- Unitarias:
  - `equipos/__tests__/bajada.test.ts`: punto de salida igual al del enganche; largo recto al centro; no agrega
    piezas; rechazos con motivo; equipo con padre; desactualizada por equipo y por tramo.
  - `recorridos/__tests__/circuitosGuardados.test.ts`: de equipo a equipo con el desglose; sin enlace, mismo
    equipo y sin camino; mover o borrar un equipo o un enlace; piezas movidas, rotadas o borradas; recalcular;
    dos equipos sobre el mismo tramo; rechazo de circuitos de boca a boca.
  - `workspaceFile.test.ts` y `projectSession.test.ts`: v1/v2 rechazados con el aviso; registro `/1` apartado.
- E2E:
  - `equiposCircuito` (nueva, con gestos reales): dos equipos con «Nuevo equipo», un trazado entre ellos y un
    enlace en cada punta. El circuito va de un equipo al otro, la longitud incluye las dos bajadas y se ve
    desglosada, y persiste al recargar. Al mover Bomba 3 con la ficha, el circuito y el enlace quedan
    desactualizados con «el equipo Bomba 3 se movió (500.0 mm)».
  - `circuitosGuardados` pasó a extremos de equipo.
  - `proyectoPersistente` A3b: el v1 del operador no se abre y no cambia nada.
- **Control negativo**, verificado: si el circuito no suma las bajadas, fallan 3 pruebas unitarias y la E2E.

## Verify completo: por tandas
Playwright se corre por tandas (`npm run test:e2e:tandas`), nunca en una sola corrida: ver
`docs/traspaso-curvas-eslabonadas.md`.
