# Estado del proyecto — fin del hito 1 ("el proyecto no se pierde")

Rama `feat/m1-proyecto-persistente` (base `c8b3105`). Una página: qué funciona, qué no, qué sigue.

## Funciona

- **La ruta `/` abre el espacio de trabajo** con el último proyecto o uno **vacío** (sin equipos
  de demostración ni piezas de ejemplo). El editor inicial vive en `/?legacy=v1`.
- **Autoguardado local** en IndexedDB (`codex-workspace-v1`, base propia; no toca la del editor
  inicial) con restauración al abrir e indicador *Guardando / Guardado / Error* (+ *Reintentar*).
  Se guardan equipos, evidencia, trazado (piezas, uniones, circuitos, soportes), catálogo
  importado, nombre de archivo y selección. Un registro dañado se aparta (`corrupt:<fecha>`),
  nunca se pisa.
- **Acciones de proyecto** (un solo componente, `src/project/ProjectControls.tsx`): *Nuevo*
  (confirma si hay contenido), *Abrir archivo*, *Guardar copia* — esta última sin motor y con el
  proyecto vacío.
- **Archivo `fileVersion 2`** con la biblioteca completa (overrides + approvals + aporteOverrides);
  lee `fileVersion 1`. La biblioteca se omite del archivo si está vacía.
- **Biblioteca protegida**: abrir/importar no modifica `codex:catalogConfig:v1`. Si el archivo trae
  una biblioteca distinta: seguir con la local (por defecto) / adoptar la del archivo / cancelar.
  Adoptar respalda antes la anterior en `codex:catalogConfig:v1:backup:<fecha>`; si el respaldo falla,
  no adopta. Un archivo sin bloque no cambia nada.
- **Catálogo sin motor**: productos, puertos, compatibilidades, uniones, familias y los 113 ids de
  cable salen de `vendor/motor_bandejas/datos` (chunk diferido, no bloquea la carga inicial).
  Índice de productos y resolvedor de maestros se siembran al iniciar, también en el configurador.
- **Motor opcional**: estado visible (*conectado / apagado / incompatible*). Sólo se necesita para
  calcular; si su catálogo (huella + SHA-256 de `decisiones_producto.json`) no coincide con el
  empaquetado, avisa y **no calcula**.
- **Verificación**: `npm run verify` (tipos + Vitest + pruebas del motor + Playwright con sus propios
  servidores, incluida una instancia **sin motor**).

## No funciona / limitaciones conocidas

- **Calcular un proyecto nuevo sin definir el PE**: el trazado vacío lleva un `pe` neutro
  (sección 0, sin cable) que `toMotorEntrada` omite al enviar al motor. No se verificó el cálculo
  completo de un trazado armado desde cero contra el motor (sólo el ejemplo del motor calcula en E2E).
- **Un solo proyecto local**: el autoguardado mantiene el último estado, sin lista de proyectos ni
  historial de versiones. El historial de deshacer **no** se persiste.
- **Varias pestañas**: abrir dos pestañas del mismo origen hace que la última en guardar gane; no hay
  bloqueo ni aviso.
- **Selección 3D** (puertos/piezas) sigue sin poder probarse con clicks sobre el canvas en E2E; las
  pruebas eligen el puerto de partida vía `window.__codex`.
- Cuatro pruebas del motor fallaban en Windows por CRLF (`core.autocrlf=true`); se corrige con
  `.gitattributes`. Sin ese archivo en el árbol de trabajo, vuelven a fallar.
- Las E2E corren en serie: con 2 workers, 11 pruebas existentes fallaban por concurrencia (línea base).

## Sigue (hitos posteriores, fuera de este alcance)

Colocación persistida por pieza · resolvedor único de modelos · historial de deshacer unificado ·
asignación de conexiones a recorridos · longitudes y listas de materiales · rediseño de la interfaz
(reubicará los controles de proyecto) · edición del bloque PE desde la interfaz.
