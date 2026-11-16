# Traspaso — biblioteca de conductores

Rama `feat/biblioteca-conductores` (PR #13). Nació sobre `feat/conexiones-importadas`; el PR #12 y el #14
(curvas confirmadas) ya están en `main`, y `main` está fusionado en la rama (2026-11-16).
Worktree `../codex-biblioteca`. E2E con puertos propios (`CI=1 CODEX_WEB_PORT=5273 CODEX_MOTOR_PORT=8865
CODEX_NOMOTOR_WEB_PORT=5283`).

## Encargo (operador, 2026-11-15)

Dos partes. Al cerrar la A, parar y esperar.

**Por qué.** El catálogo de cables del motor (113 cables, dos líneas Prysmian) no cubre lo que usa el
operador: llega hasta 4 conductores y arranca en 1,5 mm² en multipolar y 4 mm² en unipolar. En el Excel de
ejemplo quedan afuera 8 tendidos de potencia 3F+N+PE (5×6 y 5×10) y 117 de 1 mm² (114 de 2 a 4 conductores:
64 de control y 50 de instrumentación; 3 de 7×1 y 27×1). En una bandeja segregada el grupo de mando no tiene
ocupación calculable. Diámetros a cargar: 5×6, 5×10, 2×1, 3×1, 4×1, 7×1 y 27×1.

### Parte A — ver y cargar
- A1. Pestaña de configuración «Biblioteca de conductores», junto a la de modelos: todos los cables, filtro
  por línea, tipo y sección, y buscador.
- A2. De cada cable: designación, línea, tipo, conductores, sección, diámetro exterior, masa por km y su
  ORIGEN: «catálogo del motor» (los 113, solo lectura, dato vendorizado) o «declarado por el operador» (se
  editan y se borran).
- A3. Cargar un cable declarado: designación, tipo, conductores, sección, diámetro exterior y masa por km.
  Diámetro y masa pueden quedar vacíos y la ficha dice qué no se puede calcular (sin diámetro no hay
  ocupación; sin masa no hay carga por pieza ni vanos). No inventar ni estimar desde la sección.
- A4. Duplicar un cable del catálogo como punto de partida: nace declarado por el operador, con esa
  procedencia escrita y de cuál salió.
- A5. La biblioteca es del operador (autoridad localStorage, como la de modelos), pero el proyecto guarda
  los declarados que usa, para que una copia abierta en otra máquina no pierda la ocupación. Resolverlo como
  la biblioteca de modelos y contar cómo quedó.
- A6. Cuántos tendidos del Excel casan con cada cable, y atajo a los tendidos sin cable agrupados por
  naturaleza, conductores y sección, con cuántos de cada combinación: exactamente las siete de arriba y
  cuántos destraba cada una.
- Pruebas: unitarias; E2E que cargue un declarado, recargue y lo encuentre; que uno del catálogo no se pueda
  editar; que uno sin diámetro muestre qué no se puede calcular.

### Parte B — usarlos en el cálculo (después de la aprobación de la A)
- B1. Un tendido casa con un declarado con las mismas reglas que con el catálogo, y se ve que es declarado.
- B2. Al motor no viaja ningún declarado. Las bandejas que lleven alguno: ocupación calculada por la APP
  (mismo mecanismo que la banda divisoria), marcada y distinguible de la del motor.
- B3. Bandeja mixta (catálogo + declarados): manda el cálculo de la app, y se dice por qué, nombrando los
  declarados.
- B4. Declarado sin diámetro: la bandeja sigue sin ocupación calculable y se dice cuál falta completar.
- B5. «N tendidos de potencia sin cable de catálogo» pasa a contar solo los que tampoco tienen declarado.
- Controles negativos: si un declarado viaja al motor, falla; si la ocupación de una bandeja con declarado
  aparece como del motor, falla.

Reglas de trabajo: typecheck + vitest + E2E tocadas; verify completo cuando el operador avise; empujar tras
cada commit; rama y PR propios, sin fusionar; campos nuevos opcionales sin subir la versión del archivo.

## Parte A — cerrada (2026-11-15)

### Dónde está
- `src/conductores/biblioteca.ts`: tipos, ficha y validación (`validarBorrador`), `noCalculable`,
  `duplicarDeCatalogo`, vista unificada (`entradasBiblioteca`) con el ORIGEN de cada cable.
- `src/conductores/store.ts`: autoridad local (`codex:conductoresDeclarados:v1`), respaldo antes de adoptar.
- `src/conductores/guia.ts`: `tendidosPorCable`, `tendidosSinCable`, `declaradosUsados`.
- `src/conductores/bloqueArchivo.ts`: bloque del archivo, diferencia con la local.
- `src/conductores/BibliotecaConductores.tsx`: la pestaña. `ConfiguratorLayout` tiene ahora dos pestañas
  («Biblioteca de modelos» / «Biblioteca de conductores», `?configurator=v1&seccion=conductores`) y la barra
  del proyecto un enlace a cada una.
- `casarTendido` pasó a ser genérico (acepta cualquier cable con id, conductores y formación); la regla no
  cambió.

### Decisiones
- **Ficha declarada de conductores iguales**: designación, tipo (unipolar / multipolar), material,
  conductores, sección de cada conductor, diámetro y masa (estos dos pueden quedar vacíos; vacío = `null`,
  nunca una estimación). El MATERIAL va en la ficha aunque el encargo no lo nombraba: en el catálogo el
  «tipo» incluye el material, y la regla del cobre de la etapa 2 lo necesita para la parte B.
- Un cable del catálogo con conductor reducido («25/16») no se duplica: la ficha no tiene conductor
  reducido. Se rechaza con el motivo.
- Ids `OP-…`: nunca coinciden con los del motor (`PRY-…`).
- Línea de un declarado: «Declarado por el operador» (para el filtro). Un duplicado dice en su procedencia
  de qué cable y línea salió.

### A5 — cómo quedó
Igual que la biblioteca de modelos:
- **Autoridad**: localStorage de cada máquina. El autoguardado (IndexedDB) no la lleva.
- **Copia del proyecto**: bloque opcional `conductoresDeclarados` (`codex:conductores/1`) con los
  declarados que el proyecto USA. En la parte A, «usa» = casa con al menos un tendido del Excel del proyecto
  (`declaradosUsados`); en la B se acota a los elegidos o propuestos. Sin declarados usados, el bloque no va.
  La versión del archivo no cambia (sigue en 3 en esta rama).
- **Abrir en otra máquina**: si el archivo trae cables que esta máquina no tiene, o con otros datos, se
  pregunta como con la de modelos (seguir con la local / adoptar los del archivo / cancelar). Diferencias
  con la de modelos: **adoptar AGREGA** los que faltan y reemplaza los de igual id, pero **nunca borra** un
  cable local, porque el archivo trae solo los usados y no la biblioteca entera. Antes de escribir se guarda
  una copia de la local (`codex:conductoresDeclarados:v1:backup:<ISO>`).
- Las dos preguntas (modelos y conductores) se hacen antes de aplicar nada: cancelar cualquiera de las dos
  no deja cambios. La escritura de conductores va después de la de modelos; si fallara, el mensaje dice si
  la de modelos ya se adoptó y dónde quedó su copia.
- **App anterior**: ignora el bloque (no lo conoce) y no calcula nada con declarados, así que no cambia
  ningún resultado. Pero si vuelve a guardar una copia, el bloque no viaja. Los cables siguen en la
  biblioteca local de la máquina que los declaró. No se subió la versión del archivo.

### A6 — guía con el Excel de ejemplo
- Exactamente las siete combinaciones, todas multipolares: 2×1 (87), 3×1 (23), 5×6 (7), 4×1 (4),
  27×1 (2), 5×10 (1), 7×1 (1) = 125. Aparte, con el motivo: 7 cables de datos y 42 tubos.
- Cada combinación tiene «Cargar uno», que abre la ficha con conductores y sección. La columna «Declarados
  que ya casan» dice qué declarado la cubre y cuántos tendidos.
- La pestaña lee los tendidos del proyecto abierto desde el autoguardado, sin tocarlo. Sin Excel, lo dice y
  el atajo queda deshabilitado.

### Pruebas
- Unitarias `src/conductores/__tests__/biblioteca.test.ts` (20): ficha (vacíos → qué no se calcula; sin
  estimación), orígenes, duplicado y su procedencia, persistencia (recargar; fallo de escritura no cambia el
  estado; biblioteca ilegible no se pisa), fusión que no borra, las siete combinaciones con el Excel real,
  5×6 que cubre 7 y ninguno de 5×10 (control negativo), bloque del archivo (solo usados; abrir en otra
  máquina → pregunta, adoptar agrega con respaldo, local no cambia, cancelar no abre), bloque mal formado.
- E2E `bibliotecaConductores` (4): pestaña junto a la de modelos; uno del catálogo sin editar ni borrar ni
  campos; declarado sin diámetro → qué no se calcula, recargar y encontrarlo, editarlo; duplicado; guía con
  el Excel importado: las siete combinaciones y sus cantidades, y la combinación cubierta.
- Typecheck y vitest completo: 126 archivos, 1937 pruebas. E2E también: `interfazAlcance` (barra en una
  fila con el enlace nuevo), `proyectoPersistente`, `configuratorMaestroTab`.
- Verify completo: pendiente del aviso del operador.

## Parte B — cerrada (2026-11-16)

### Dónde está
- `src/conexiones/tendidos.ts`: `cableDeTendido(t, cables, declarado, declarados)` casa contra el catálogo y
  los declarados JUNTOS, con la misma regla (`casarTendido`). Devuelve `cable` (catálogo) o `cableDeclarado`,
  nunca los dos. `cablesDelCircuito` y `faltaConExcel` llevan el declarado (`CableEnCircuito.declarado`).
- `src/workspace/motor/paraMotor.ts`: un tendido con declarado va a `noEnviados` con
  `MOTIVO_DECLARADO_NO_VIAJA` y `declarado` (no `potenciaSinCable`). `asegurarSinDeclarados` corta en voz alta si
  un `OP-…` llega a lo que se envía; lo llaman `circuitosParaMotor` y `toMotorEntrada` (también sobre los
  circuitos crudos del trazado).
- `src/workspace/segregacion/bandaDivisoria.ts`: la lectura de lo que cruza una pieza pasó a `crucesDePieza`
  (con los declarados y su diámetro declarado) y el cálculo de un grupo a `evaluarGrupo`; `ocupacionSegregada`
  usa las dos. Sin cambio de resultado para lo que ya existía (las pruebas de la banda pasan igual).
- `src/conductores/ocupacionApp.ts`: `ocupacionConDeclarados` (bandeja sin banda con declarados) y
  `ocupacionDeLaApp` (segregada o con declarados; null = manda el motor).
- Pantalla: `useOcupacionDeLaApp`, `OcupacionDeLaAppView` y `BandejasConDeclaradosSection` en
  `stages/BandaDivisoria.tsx`; los usan Cálculo del motor, el inspector de la pieza y la respuesta cruda.
- `src/conductores/store.ts`: `declaradosHidratados()` (el cálculo nunca parte de la biblioteca sin leer) y
  `useDeclarados()`. Si otra pestaña cambia la biblioteca local, se vuelve a leer (evento `storage`).

### Decisiones (sin preguntar; el camino más chico, el otro anotado)
- **B1, competencia catálogo/declarado.** Misma regla: si un tendido casa con un cable del catálogo Y con un
  declarado (p. ej. un duplicado de un Sintenax), son varios candidatos y elige el operador; la regla del cobre
  sigue siendo sólo entre cables del catálogo. Consecuencia a la vista: duplicar un cable del catálogo deja
  sin propuesta los tendidos que antes tenían un único candidato («N candidatos (… del catálogo y …
  declarado(s) por el operador): elegí uno»). Camino no tomado: que el catálogo gane sobre el declarado
  (sería otra regla).
- **B2, qué cuenta la app en una bandeja SIN banda.** Lo mismo que cuenta el motor —potencia y el PE que
  recorre la pieza; mando, señal y comunicación no (D-11)— más los declarados de potencia, con su diámetro.
  Una capa en contacto (W = Σ n·D, D-02), reserva D-05 sobre el ancho de referencia (útil si el catálogo lo
  publica, si no nominal, como la banda), altura contra el ala (D-08). El PE entra como en el motor
  (`ocupacion_seccion`: w = w_pot + n_PE·D_PE). Los de mando (de catálogo o declarados) se listan como «no
  contados (D-11)». Basta que pase UN declarado (de cualquier función) para que la bandeja la calcule la app.
  Camino no tomado: sumar también mando y señal en una bandeja sin banda (cambiaría la regla D-11 sólo en las
  bandejas con declarados).
- **B2, bandeja segregada.** Ya la calculaba la app: los declarados entran en su grupo (potencia o mando) con
  su diámetro declarado, y se nombran.
- **B3.** El texto dice «Bandeja mixta (catálogo del motor + declarados): manda el cálculo de la app porque…»
  y nombra cada declarado con designación e id. Sin cables del catálogo: «Manda el cálculo de la app porque…».
  La ocupación del motor de esa pieza no se muestra (Cálculo del motor, inspector, respuesta cruda: se filtra
  como la de las segregadas).
- **B4.** Un declarado sin diámetro que entraría en la suma deja la bandeja sin ocupación («sin ocupación
  calculable: el cable declarado X (OP-…) no tiene diámetro exterior; completalo en la biblioteca de
  conductores»). En una bandeja sin banda, uno de MANDO sin diámetro no bloquea (por D-11 no entra) y se dice.
  En una segregada, cualquiera bloquea. El circuito lo lista además como lo que le falta.
- **B5.** «N tendido(s) de potencia sin cable de catálogo ni declarado» cuenta sólo esos; los que llevan
  declarado se listan aparte («… con cable declarado por el operador: no viajan al motor; la ocupación de sus
  bandejas la calcula la app»), avisando si al declarado le falta el diámetro.
- **Masa y vanos.** No se tocan: siguen siendo los del motor, que NO incluyen los declarados. Se dice al lado
  de la masa de cada pieza con declarados («sin los cables declarados») y en el criterio de la app. Camino no
  tomado: que la app sume la masa declarada a la carga por pieza (el encargo pide ocupación).
- **A5 acotado.** `declaradosUsados` = los declarados que LLEVA algún tendido (elegidos, o propuestos por ser
  único candidato). Un declarado que sólo es uno de varios candidatos sin elegir no viaja en la copia. Sin
  motor (sin catálogo de cables) la cuenta puede incluir de más (un declarado que compite con el catálogo
  parece único); incluir de más no pierde nada.
- **Elegido y después borrado o editado.** Un tendido con un declarado elegido que ya no está en la
  biblioteca de este equipo queda sin cable, con el motivo; uno que ya no casa (se editó la sección) avisa.

### Pendiente anotado, NO hecho
- **Peso de los declarados en los soportes (operador, 2026-11-16).** La masa por pieza y los vanos de soporte
  salen del motor, que no conoce los cables declarados: el peso de esos cables NO entra en el cálculo de
  soportes. Se cierra igual que la ocupación: si el operador carga la masa por km del declarado, la app suma
  su carga a la de la pieza (masa × cantidad, marcada como cálculo de la app) y verifica los vanos con esa
  carga, sin que el motor se entere; un declarado sin masa deja esa pieza sin carga calculable y se dice cuál
  falta (la ficha ya lo anuncia: «sin masa por km no hay carga por pieza ni vanos»). Con cables de control es
  despreciable; con los 5×6 y 5×10 de potencia, no.
- Un resultado del motor calculado ANTES de agregar un declarado que compite con un cable del catálogo sigue
  marcado vigente, aunque ese tendido ya no viajaría. La ocupación de la app se recalcula sola; el resultado
  del motor no. Salida chica si el operador la pide: marcar el resultado como no vigente cuando cambia la
  biblioteca de conductores.
- La vista heredada `?ws=bandejas-legacy` (`tray/TrayWorkspace.tsx`) muestra la ocupación del motor tal cual,
  sin filtrar segregadas ni declaradas (con la banda ya era así).

### Pruebas
- Unitarias `src/conductores/__tests__/parteB.test.ts` (19), sobre un tramo real con bajadas y circuitos
  ligados: B1 (único candidato, misma regla, competencia con el catálogo, elegido que ya no está); B2 y
  controles negativos (nada `OP-` en lo que sale hacia el motor; `asegurarSinDeclarados` y `toMotorEntrada`
  fallan con un `OP-` colado; un circuito a mano con id declarado no viaja); B2/B3 (mixta: Σ = catálogo +
  declarado + PE, nombra los declarados, mando fuera por D-11; sin declarados → null, manda el motor); B4
  (sin ocupación, nombrando el que falta; mando sin diámetro no bloquea en bandeja sin banda; falta del
  circuito); segregada con declarados (en su grupo; sin diámetro bloquea); B5; «por esta bandeja»; A5 acotado.
- E2E `conductoresCalculo` (3), con puertos propios: B1 en Conexiones; B4/B5 en Resultados; B2/B3 con el
  diámetro completado en la biblioteca, en otra pestaña: la bandeja mixta calculada por la app, y cálculo con
  el motor real: `res.entrada` sin ningún `OP-`, CB-010 fuera, y la pieza con declarado sin `motor-ocupacion`.
- Typecheck y vitest completo: 127 archivos, 1959 pruebas. E2E tocadas, todas pasan: `tendidosImportados`
  (7, texto del aviso B5), `porBandeja` (3), `calculoMotor` (4) y `bibliotecaConductores` (4).
- Verify completo: pendiente del aviso del operador.
