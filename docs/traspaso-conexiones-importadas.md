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
(se completan por etapa)
