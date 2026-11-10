# Estado del proyecto — hito 2, fase A ("la colocación es un dato")

Rama `feat/m2-colocacion-persistida` (base `b5c444a`). Una página: qué funciona, qué no, qué sigue.

## Funciona

- **Colocación persistida (hito 2 A)**: cada pieza nueva guarda su definición (patrón, revisión, huella,
  parámetros; contenido completo en `definiciones_ws` del trazado), su mano y su pose (posición +
  cuaternión). Un solo cálculo (`computeRoutingPlacement`) dibuja el preview y se guarda al confirmar;
  el render dibuja desde lo guardado (sin `verifyGeometricFit`). Una sola ruta de colocación con marco
  completo. La mano es la definición espejada; la pose es siempre una rotación. Selector de lado para
  toda pieza asimétrica.
- **Uniones verificadas (A-7)**: hueco ≤ 1 mm, ángulo ≤ 1°, giro ≤ 1° (D-14, sin módulo 180°). Cada unión
  guarda si es documentada o excepción con motivo; unir a mano informa hueco/ángulo/giro y no mueve piezas.
  Mover/rotar transforman la pose; las uniones que dejan de cumplir se informan (aviso de conexiones rotas).
- **Biblioteca vs piezas (A-6)**: cambiar la calibración no cambia piezas colocadas; se avisa y se ofrece
  "Actualizar N piezas" (deshacible).
- **Migración (A-10)**: al abrir un proyecto anterior se deduce la pose una vez; las que no encajan quedan
  "sin resolver" con marcador y conservan sus bocas.

- **Proyecto persistente (hito 1)**: `/` abre el último proyecto o uno vacío; autoguardado en
  IndexedDB propia con indicador; Nuevo / Abrir / Guardar copia; archivo `fileVersion 2` con la
  biblioteca completa; biblioteca local protegida; catálogo sin motor.
- **Cinco etapas** (Equipos · Planta · Bandejas · Conexiones · Resultados) con la escena 3D común.
  Cada etapa muestra sólo su lista, sus herramientas y su inspector; sin selección, el inspector da
  el resumen de la etapa y el siguiente paso (reemplaza la guía y la leyenda fijas).
- **Barra de proyecto** en una fila: nombre, estado de guardado, Nuevo, Abrir, Guardar copia,
  Deshacer/Rehacer (los dos historiales actuales: bandejas y equipos), tema, Biblioteca de modelos.
- **Selección escena ↔ lista**: clic en la escena abre el grupo plegado, desplaza la lista y marca
  la fila (equipos y piezas); clic en la lista marca en la escena. Un equipo del Excel ya ubicado se
  marca en la escena desde su fila.
- **Selección de otra etapa**: cambia de etapa automáticamente (una pieza en Resultados se queda).
- **Tema oscuro/claro** guardado por navegador, fuera del archivo; contraste AA medido en E2E.
- **Nombres visibles**: SKU con número de orden en lugar de `instancia_id`; `physicalLabel` del
  maestro para las bocas; "Sin dato" para datos ausentes; conflictos del Excel abiertos y visibles.
- **Resultados**: "PE sin definir" en tono neutro cuando el motor informa `SIN_PE_DEFINIDO`.
- **Acciones de prueba** sólo con `/?dev=1` (menú Desarrollo).
- **Bocas de accesorios (m1c)**: la traducción boca de receta → puerto del catálogo se deriva del
  patrón (maestro) y alcanza a todas sus variantes; no hay identidad silenciosa. Una boca sin
  correspondencia, o que traduce a un puerto que el catálogo no publica, se informa como
  "sin calibración de bocas — modelo no resuelto" y no se calcula. Prueba de auditoría sobre todo el
  catálogo con maestro (`portMappingAudit.test.ts`).

## No funciona / limitaciones conocidas

- **Calibración `modelFrame` rígida (hito 2 A)**: con marco completo, rotar malla y bocas juntas no cambia
  la pieza colocada. Las calibraciones que cambian una boca respecto del cuerpo (centro, normal,
  orientación, giro de instalación) sí. Revisar en la fase B (calibración por patrón, PB3).
- **Piezas sin modelo paramétrico** (p. ej. FAMIQ, reducciones) siguen sin pose: se colocan con la geometría
  anterior.

- **Bocas sin calibrar (m1c)**: de 428 productos con maestro, 7 no resuelven (DCPS-050…600): el
  patrón declara P1/P2/P3 y el catálogo publica sólo P1 ("boca derivación"). Además, 34 productos de
  más de dos bocas no tienen maestro (27 FAMIQ, 7 EMPS). Encadenar accesorio ↔ accesorio sigue sin
  documentar en el catálogo y pasa por excepción con motivo.
- **Planta**: el editor existente no edita dimensiones ni posición de infraestructura y no hay
  visibilidad por elemento (sólo la capa); hace falta un editor nuevo. No hay carga de planos.
- **Calcular un proyecto nuevo** exige cargar la reserva solicitada (%) en Resultados.
- **Tema y colores**: dentro de los paneles el texto y los fondos se normalizan al tema para cumplir
  AA; las señales de estado usan los tokens peligro / correcto / advertencia. Deuda anotada: la
  normalización `.ws-panel *` de `stages.css` apaga en silencio el color de componentes nuevos que no
  usen `tone-*`; conviene invertirla (que los componentes declaren su tono) al volver a tocar la hoja.
- **Conflictos en la ficha editable de equipos propios** (`EquipmentEditorPanel`): muestra el valor en
  conflicto y "Sin dato" si falta, pero no las alternativas (el modelo sólo guarda un valor por dato).
- **Cable PE** elegido desde la lista sin sección requerida: el motor lo rechaza (comportamiento previo).
- Selección 3D de puertos sigue sin probarse con clics en el canvas; continuar se prueba desde la lista
  de extremos libres.
- Pruebas HTTP del motor intermitentes en Windows (WinError 10053): repetir la corrida.

## Sigue (hitos posteriores)

Colocación persistida por pieza · resolvedor único de modelos · historial de deshacer unificado ·
asignación de conexiones a recorridos · longitudes y listas de materiales · carga de planos y edición
de infraestructura · edición del bloque PE desde la interfaz.
