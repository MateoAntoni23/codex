# Traspaso — conexiones importadas del Excel unidas al trazado

Encargo recibido el 2026-11-15. Rama `feat/conexiones-importadas` desde `main`, trabajada en un worktree
aparte (`../codex-conexiones`) porque el operador prueba `feat/parte-civil` en la carpeta del repo.
Cuatro etapas; al cerrar cada una: parar, reportar y esperar.

## Cómo se trabaja
- No cambiar de rama en la carpeta del repo: worktree aparte, rama nueva desde main.
- La memoria del equipo está compartida con SolidWorks. Durante el trabajo: typecheck, vitest y las E2E
  tocadas. El verify completo en 8 tandas NO se lanza solo: avisar que la etapa está lista y esperar a que
  el operador diga cuándo.
- Empujar después de cada commit de trabajo.
- feat/parte-civil ya subió el archivo de proyecto a la versión 4. Acá: campos nuevos opcionales, sin subir
  versión. Si una app anterior perdería datos en silencio sin subirla: parar y avisar antes de tocarla.

## Lo que ya existe (verificado en main por el operador)
- `src/import/types.ts`: `ConexionImportada` trae origenEquipoId, destinoEquipoId, los textos originales,
  servicio, circuitoTag, tensionV, refIngCorrienteDisenoA y refIngLongitudM. `TendidoImportado` trae
  conexionId, naturaleza, funcion, cantidadUnidades, conductoresPorUnidad, seccionMm2, seccionPeMm2,
  incluyePe, apantallado, diametroExteriorMm, designacion, marcaModelo, refIngIzA, refIngCaidaTensionPct y
  refIngMetrajeCompraM. `AtributoImportado` trae la ficha técnica como filas.
- El catálogo importado se guarda con el proyecto (`importedCatalog` en `src/project/projectSession.ts`),
  pero conexiones y tendidos sólo se cuentan en `src/import/parser.ts:181`. Nada los usa.
- Los circuitos guardados (`src/workspace/recorridos/circuitosGuardados.ts`) van de equipo a equipo, con UN
  cable elegido a mano y una función entre potencia, maniobra e instrumentación.
- Excel de ejemplo: `src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx`; reimportación en
  `src/import/reimport.ts`.

## Reglas que no se negocian
- El motor no se toca, y nada viaja a él fuera de su contrato.
- Lo importado es la fuente: no se corrige ni se completa en silencio. Lo que el operador declare en la app
  se guarda APARTE del dato importado, con su procedencia, y sobrevive a una reimportación.
- La app no hace cálculo eléctrico. Compara valores que ya vienen del Excel contra lo trazado, y avisa.
  Nunca impide.

## Etapa 0 — reconocimiento (reportar y seguir)
Sobre el Excel de ejemplo, tabla corta con:
- conexiones por servicio, y cuántas traen los dos equipoId;
- tendidos por naturaleza, cuántos traen sección, y cuántos se pueden casar con un cable del catálogo del
  motor (113 cables Prysmian) por naturaleza, conductores y sección;
- cuántas conexiones tienen más de un tendido;
- cuántas traen longitud de referencia y corriente de diseño.
Sin preguntas con esos números.

## Etapa 1 — las conexiones importadas como lista de trabajo
- En la etapa Conexiones, la lista principal pasan a ser las conexiones del Excel, agrupadas por servicio,
  con filtro y buscador.
- Cada una muestra su estado, con el motivo: equipos sin resolver / equipo sin ubicar en la escena / equipo
  sin enlace a bandeja / sin trazar / trazada / desactualizada.
- Los equipos se resuelven por origenEquipoId y destinoEquipoId. Si falta alguno, se muestra el texto
  original y el operador puede emparejarlo a mano; ese emparejado es dato declarado por el operador, no
  modifica lo importado.
- «Trazar» desde una conexión crea el circuito con origen y destino ya puestos y ligado a su conexionId.
  Usa el camino de circuitos que existe.
- Servicios: POTENCIA, CONTROL, INSTRUMENTACION y COMUNICACION se trazan. COMUNICACION es una función nueva;
  para la segregación va en el grupo que no es potencia. EQUIPOTENCIALIDAD, PUESTA_A_TIERRA y NEUMATICA se
  listan pero no se trazan en esta versión, y se dice por qué.
- Trazar un circuito que no está en el Excel sigue permitido; queda marcado «fuera del Excel» en la lista y
  en Resultados.
- Reimportar: si una conexión cambió o desapareció, su circuito queda marcado con el motivo. No se borra ni
  se recalcula solo.
- Control negativo: una conexión sin equipo resuelto no puede figurar como trazable, y un emparejado manual
  no puede aparecer como dato del Excel.

## Etapa 2 — los cables salen de los tendidos
- Un circuito ligado a una conexión lleva TODOS sus tendidos: una lista de cables sobre un mismo recorrido,
  no un cable solo. Extender el modelo del circuito sin romper los circuitos de un cable.
- Para cada tendido se muestra lo importado: naturaleza, función, cantidad, sección, PE, apantallado,
  designación.
- Casar el tendido con un cable del catálogo del motor: un único candidato por naturaleza, conductores y
  sección → se propone; varios → elige el operador; ninguno → el tendido queda sin cable de catálogo, se
  mide igual y no viaja al motor, con el motivo. La elección es dato declarado por el operador. Nunca un
  cable por defecto.
- Si el diámetro exterior del Excel difiere del del cable de catálogo elegido, se avisa con los dos números:
  la ocupación la calcula el motor con el suyo.
- Al motor viaja un circuito por cada tendido de potencia con cable casado, todos con el mismo recorrido. El
  PE del motor sigue saliendo de su propia sección, como hoy: revisar que un tendido PE importado no se
  cuente dos veces y explicar cómo se resolvió.
- Elegir el cable a mano queda para los circuitos fuera del Excel.

## Etapa 3 — contrastar lo trazado contra la ingeniería
Comparaciones entre números que ya existen; avisos con los dos valores y su origen a la vista:
- Longitud trazada contra refIngLongitudM. Si la trazada es mayor, el aviso dice que la caída de tensión del
  Excel se verificó con una longitud menor. Es el aviso más importante de la etapa.
- Corriente de diseño de la conexión contra la corriente admisible del tendido, las dos importadas.
- Metraje: longitud trazada por cantidad contra refIngMetrajeCompraM.
- La ficha técnica del equipo, de los atributos importados, visible en el inspector del equipo con su
  estado y origen. Sólo lectura.
- En Resultados, una pestaña «Contraste con ingeniería» y su tabla copiable. Si falta un dato para comparar,
  se dice cuál; no se supone.

## Etapa 4 — qué pasa por cada bandeja
- Al seleccionar una pieza de bandeja, el inspector lista los circuitos y tendidos que la atraviesan, con
  función, cable y cantidad, y la suma de diámetros por grupo.
- Desde esa lista se puede saltar al circuito; al seleccionar un circuito se resalta su recorrido en la
  escena, sin usar color de relleno.

## Cierre de cada etapa
Una E2E por punto, controles negativos corridos, rama y PR propios sin fusionar, y el reporte. El verify
completo, cuando el operador avise.

Sin preguntas de decisión salvo que algo sea imposible o se pierdan datos del operador. Ante dos caminos,
el más chico, y anotar el otro.

## Notas de implementación

### Etapa 0 — reconocimiento (Excel de ejemplo `ELS-IMP-EQCX_v1.0_Rev0.xlsx`, 2026-11-15)
272 conexiones, 279 tendidos, 276 equipos. Ningún tendido sin conexión; ningún equipoId que no exista.

| servicio | conexiones | con los dos equipoId | con más de un tendido | con longitud ref. | con corriente de diseño |
|---|---|---|---|---|---|
| POTENCIA | 104 | 103 | 5 | 104 | 104 |
| CONTROL | 67 | 67 | 0 | 67 | 35 |
| INSTRUMENTACION | 50 | 50 | 0 | 50 | 0 |
| COMUNICACION | 7 | 7 | 0 | 7 | 0 |
| EQUIPOTENCIALIDAD | 2 | 0 | 0 | 2 | 0 |
| NEUMATICA | 42 | 42 | 0 | 42 | 0 |
| PUESTA_A_TIERRA | 0 | — | — | — | — |

| naturaleza | tendidos | con sección | un candidato | varios | ninguno |
|---|---|---|---|---|---|
| CABLE_MULTIPOLAR | 215 | 215 | 63 | 27 | 125 |
| CONDUCTOR_UNIPOLAR | 15 | 15 | 0 | 15 | 0 |
| CABLE_DATOS | 7 | 0 | 0 | 0 | 7 |
| TUBO | 42 | 0 | 0 | 0 | 42 |

Regla de casado en `src/conexiones/casarCable.ts` (naturaleza, conductores, sección; el conductor reducido
«a/b» sólo casa con la sección de PE que declara el Excel). Lo que se ve:
- **Todos los «varios» son cobre contra aluminio** de la misma formación (y un 1×16 Sintenax contra
  Superastic). El Excel no trae material como campo. Camino no tomado: deducir cobre de la designación o la
  marca; sería completar en silencio.
- **«Ninguno» en multipolar:** 114 son de 1 mm² (2, 3 y 4 conductores: control e instrumentación; el
  catálogo empieza en 1,5 mm²), 8 de 5 conductores (3F+N+PE), 3 de 7 y 27 conductores.
- **Potencia:** 63 tendidos con un candidato, 40 con varios (Cu/Al), 8 sin ninguno (los 3F+N+PE).
- **Ningún tendido trae diámetro exterior:** el aviso de diámetro de la etapa 2 no va a aparecer con este
  Excel.
- 104 tendidos traen Iz de referencia y 237 metraje de compra.

### Etapa 1 — lista de trabajo (2026-11-15)
**Dónde se guarda lo del operador.** En `conexiones_ws`, clave workspace-only del trazado (`src/conexiones/declarado.ts`,
sumada a `WS_ONLY`: nunca viaja al motor). Emparejados por `conexionId` + extremo y vínculos circuito → conexión, con
`procedencia: 'operador'` y fecha. Sobrevive a reimportar porque está indexado por ids del Excel y vive fuera de
`importedCatalog`. Se descartaron dos lugares por pérdida en silencio en una app anterior:
- dentro del circuito: `recalcularCircuito` de main rearma el circuito y sólo conserva `cable`;
- un bloque nuevo del archivo de proyecto: main lo descarta al guardar (habría que subir la versión).
Una app anterior que abra un archivo con `conexiones_ws` lo conserva (sus ediciones copian `...entrada`), pero NO lo
saca de lo que manda al motor: calcular ahí falla con error del motor (ruidoso, sin pérdida). Una con circuitos de
función «comunicación» se niega a abrir el archivo (su validación de cable). Ninguno de los dos casos pierde datos en
silencio; no se subió la versión.

**Circuitos ligados:** id `CIR-<conexionId>`. Main numera `CIR-<n>`, así que nunca reusa el id de un ligado borrado
para otro circuito: un vínculo no puede quedar pegado al circuito equivocado. Borrar el circuito borra su vínculo.

**Estado** (`estadoConexion.ts`): no se traza → trazada/desactualizada (si tiene circuito) → equipos sin resolver →
sin ubicar → sin enlace → sin trazar. Desactualizada junta los motivos del recorrido (`estadoCircuito`), los campos de
la conexión que cambiaron en el Excel (contra la copia guardada al trazar) y un extremo que ahora es otro equipo.
«Retrazar» (y «Recalcular» en Resultados, para un ligado) toma los equipos y la conexión de ahora.

**Extremos:** el `equipoId` del Excel manda; el emparejado manual sólo cuenta si el Excel no lo trae, y se elige entre
los equipos ubicados en la escena. Camino no tomado: emparejar contra un equipo del catálogo importado (todavía sin
ubicar).

**Servicios:** COMUNICACION es una función nueva del circuito (`comunicacion`); en la segregación ya cae en el grupo
que no es potencia; no viaja al motor (D-11). EQUIPOTENCIALIDAD y PUESTA_A_TIERRA: el PE lo arma el motor desde su
propia sección (D-20). NEUMATICA: es un tubo, no un cable.

**E2E tocadas por el encargo:** `cablesCircuito` y `circuitosGuardados` esperaban la tabla copiable sin la columna
«Excel»; se les sumó (el encargo pide «fuera del Excel» en Resultados).

### Etapa 2 — los cables salen de los tendidos (2026-11-15)
**Modelo.** El circuito ligado no copia los tendidos: los lee del Excel actual por su vínculo. Lo único guardado es la
elección del operador por tendido (`conexiones_ws.cables[tendidoId]`: un `cable_id` o `null` = sin cable de catálogo,
con procedencia y fecha). Los circuitos de un cable (fuera del Excel) no cambian. Al trazar, el vínculo guarda también
los tendidos, para decir al reimportar cuál cambió, desapareció o se sumó (vínculos de la etapa 1, sin esa copia, no
lo dicen). `cablesDelCircuito` (`tendidos.ts`) es la única lectura de «qué cables lleva un circuito»: la usan el
motor, la segregación y Resultados (y la etapa 4).

**Procedencia del cable de cada tendido, siempre a la vista:**
- único candidato por naturaleza, conductores y sección → se propone y se usa;
- **regla del operador (2026-11-15)**: candidatos que sólo difieren en el material → se propone el de cobre (`REGLA_COBRE`
  con su texto). Se lee «propuesto por la regla del operador», nunca como dato del Excel ni como único candidato. El
  operador lo cambia a aluminio en ese tendido;
- elegido por el operador (incluido «sin cable de catálogo»);
- sin cable: varios candidatos que no son sólo el material (elige el operador) o ninguno, con el motivo.
Camino no tomado: exigir que el operador confirme cada propuesta antes de que viaje (sobre el Excel de ejemplo
serían 103 confirmaciones); hoy se puede volver a la propuesta o cambiarla tendido por tendido.

**Al motor:** un circuito `<circuito>-<tendido>` por cada tendido de una conexión POTENCIA con cable, `cantidad` =
`cantidadUnidades`, `separado` = false, el recorrido del circuito. No viaja nada de un circuito ligado desactualizado (por
recorrido o por Excel); CONTROL, INSTRUMENTACION y COMUNICACION no viajan (D-11).

**PE, cómo no se cuenta dos veces.** El PE del motor sigue saliendo de su propia sección (D-20/D-21, armado desde el
trazado), igual que antes. Del Excel:
- las conexiones EQUIPOTENCIALIDAD / PUESTA_A_TIERRA (el PE de las bandejas) no se trazan → no viajan;
- un PE dentro de un multipolar (3F+PE) va dentro de ese cable: viaja una vez, con el cable;
- un PE unipolar de una conexión de potencia (p. ej. CB-003, 1×95 V/A de CX-0001) es el conductor de protección de ESE
  circuito, otro conductor que el PE de la bandeja: viaja como un tendido más, porque ocupa la bandeja;
- un tendido cuyo cable sea el del PE del trazado (`PRY-SASTFLEX-CU-1x16`) no viaja, con el motivo: ése sí se
  contaría dos veces.

**Tendidos de potencia sin cable de catálogo:** en Resultados › Circuitos, «N tendido(s) de potencia sin cable de
catálogo: la ocupación de estas bandejas no los incluye», con tendido, conexión, motivo y bandejas. En el Excel de
ejemplo, de los 125 multipolares sin candidato, **8 son de potencia** (CB-010, 012, 014, 016, 197, 199, 206: 5×6;
CB-217: 5×10; todos 3F+N+PE: el catálogo no tiene cables de 5 conductores). Los otros 117 son de control e
instrumentación.

**Sobre el Excel de ejemplo:** 63 tendidos con único candidato, 40 resueltos por la regla del cobre, 176 sin cable
(174 sin candidato + 2 unipolares 1×16 de EQUIPOTENCIALIDAD con Sintenax y Superastic, que no se trazan).

**E2E** `tendidosImportados` (7, una por punto). Usa el Excel de ejemplo con dos cambios declarados en la prueba: Ø 20 mm
en CB-001 (el ejemplo no trae diámetros) y CB-012 pasado a unipolar 1×16 (un caso «varios» entre lo que se traza).
Calcula con el motor real: acepta los circuitos por tendido.
