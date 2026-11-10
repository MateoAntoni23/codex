# Estado del proyecto — fin del hito 1b ("interfaz por etapas de trabajo")

Rama `feat/m1b-interfaz-por-etapas` (base `231c27e`, hito 1). Una página: qué funciona, qué no, qué sigue.

## Funciona

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

## No funciona / limitaciones conocidas

- **Planta**: el editor existente no edita dimensiones ni posición de infraestructura y no hay
  visibilidad por elemento (sólo la capa); hace falta un editor nuevo. No hay carga de planos.
- **Calcular un proyecto nuevo** exige cargar la reserva solicitada (%) en Resultados.
- **Tema claro y colores**: los componentes heredados con colores en línea se normalizan a los
  colores del tema para cumplir AA; pierden sus acentos (botones rojos/verdes, insignias de color).
  Los estados nuevos usan tonos con significado (ok / aviso / neutro).
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
