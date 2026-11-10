# Diseñador de Bandejas Portacables 3D

Aplicación web para diseñar instalaciones industriales: equipos, bandejas
portacables y sus conexiones, en un visor 3D. Un motor de cálculo en Python
(`vendor/motor_bandejas`, servido por `server/tray_service.py`) calcula ocupación
y cómputo.

**La aplicación productiva es el espacio de trabajo unificado** y se abre en
`http://localhost:5173/`. El editor inicial (escena de ejemplo con tablero y
motor) ya no es el producto: sigue disponible en `/?legacy=v1`, con su código y
sus datos intactos.

> Estado actual, qué funciona y qué sigue: ver [`docs/STATUS.md`](docs/STATUS.md).

## Rama

Trabajo del hito 1 ("el proyecto no se pierde"): `feat/m1-proyecto-persistente`
(base: `feat/pattern-models-reconciliation` @ `c8b3105`).

## Requisitos

- [Node.js 24 LTS](https://nodejs.org/) (incluye npm)
- [Python 3.12+](https://www.python.org/) (sólo para el motor de cálculo y sus pruebas;
  el diseño y el guardado funcionan sin él)
- [Git](https://git-scm.com/)

## Instalación

```bat
git clone https://github.com/MateoAntoni23/codex.git codex
cd codex
git checkout feat/m1-proyecto-persistente
npm ci
npx playwright install chromium
```

> `npm ci` usa `package-lock.json` para una instalación exacta y reproducible.
> `.gitattributes` fuerza LF en `vendor/motor_bandejas`: el motor compara huellas
> SHA-256 de sus datos y con CRLF (Windows + `core.autocrlf=true`) fallaban 4 pruebas.

## Ejecutar

```bat
npm run dev:trays     # Vite en :5173 + motor Python en :8765 (cálculo habilitado)
npm run dev           # sólo Vite: se puede diseñar y guardar; el motor queda "apagado"
```

Abrí **http://localhost:5173/**. Al abrir encontrás tu último proyecto (se
restaura de IndexedDB) o uno vacío.

### Proyecto

- **Autoguardado local**: cada cambio se guarda en IndexedDB (base
  `codex-workspace-v1`, separada de la del editor inicial). El indicador de la
  barra superior muestra *Guardando… / Guardado en este equipo / Error al guardar*
  (con botón *Reintentar*). Un fallo de escritura nunca modifica lo que ves.
- **Nuevo** (pide confirmación si hay contenido), **Abrir archivo**, **Guardar copia**
  (archivo `fileVersion 2`; lee también `fileVersion 1`). Guardar copia funciona sin
  motor y con el proyecto vacío.
- **Biblioteca de calibración protegida**: la de este equipo
  (`localStorage` `codex:catalogConfig:v1`) es la autoridad. Abrir un archivo no la
  modifica; si la copia del archivo difiere se pregunta: seguir con la local
  (por defecto), adoptar la del archivo o cancelar. Adoptar guarda antes una copia de
  la anterior en `codex:catalogConfig:v1:backup:<fecha>`.
- **Catálogo sin motor**: productos, puertos, compatibilidades, familias y cables salen
  de `vendor/motor_bandejas/datos` (chunk diferido en el build). El motor sólo hace
  falta para calcular; si su catálogo no coincide con el empaquetado se avisa y no se
  calcula.
- Ejemplos y escenarios son acciones explícitas de la barra: *Cargar ejemplo del
  motor*, *Cargar equipos de demostración*, *Cargar escenario de prueba*.

## Verificar

```bat
npm run verify        # typecheck + vitest + pruebas del motor + Playwright
```

o por partes:

```bat
npm run typecheck
npm test              # Vitest
npm run test:motor    # unittest del motor Python
npm run test:e2e      # Playwright (levanta sus propios servidores)
```

Playwright levanta (`webServer` en `playwright.config.ts`): el motor Python, Vite contra
ese motor y una segunda instancia de Vite **sin motor** (su proxy apunta a un puerto
sin servicio) para las pruebas `*.sinmotor.spec.ts`. Fuera de CI reutiliza servidores
ya abiertos; con `CI=1` levanta siempre los propios. Puertos configurables:
`CODEX_WEB_PORT` (5173), `CODEX_MOTOR_PORT` (8765), `CODEX_NOMOTOR_WEB_PORT` (5183).
Las pruebas E2E corren en serie (`workers: 1`).

## Compilar para producción

```bat
npm run build
```

Los archivos quedan en `dist/`.

## Convención de coordenadas

| Concepto | Valor |
|---|---|
| Unidad del dominio | milímetros (mm) |
| Eje vertical | Z (arriba) |
| `position` | centro del objeto |
| Unidad en Three.js | 1 unidad = 1 metro = 1 000 mm |
| Conversión posición | `[x/1000, z/1000, −y/1000]` |
| Negativo en Y | preserva la orientación (sistema dextrógiro) |

Para apoyar un objeto en el piso (`z_dominio = 0`), fijar `position.z = height / 2`.
La conversión centralizada está en `src/scene/coords.ts`.

## Proyecto vacío y bloque `pe`

Un proyecto nuevo no trae equipos ni piezas. El trazado vacío lleva un `pe` neutro
(`seccion_requerida_mm2: 0`, `cable_id: ''`, `conductores: []`) que significa "PE sin
definir", no un requisito. Al calcular, `toMotorEntrada` omite el `pe` neutro (en
`trazado/1` el motor lo trata como opcional); en cuanto se fija un cable PE viaja completo.
Detalle en `src/project/emptyProject.ts`.

## Editor inicial (heredado, `/?legacy=v1`)

Las secciones siguientes describen el editor inicial. Se abre en `/?legacy=v1`.
Usa su propia base IndexedDB (`codex-cable-tray-v1`), que el espacio de trabajo
nunca lee ni escribe.

## Qué probar visualmente

1. **Carga de la escena**: debés ver el piso gris con grilla, el contorno
   de la nave industrial, el tablero eléctrico azul y el motor verde,
   todos apoyados sobre el piso.

2. **Cámara**: arrastrá para orbitar, rueda del mouse para zoom,
   clic-derecho + arrastrar para desplazar.

3. **Selección desde el visor**: hacé clic sobre el tablero o el motor.
   El objeto se ilumina y el panel derecho muestra sus propiedades con
   campos de edición para X, Y y Z (en mm).

4. **Árbol por categorías**: el panel izquierdo muestra 8 categorías
   contraíbles (Tableros, Motores, Bombas, Válvulas, Sensores, Iluminación,
   Botoneras, Infraestructura) con el contador de elementos de cada una.
   Las categorías con objetos están abiertas por defecto; las vacías,
   cerradas. Hacé clic en la cabecera de una categoría (o usá Enter/Space
   con el teclado) para expandirla o contraerla. Contraer una categoría
   no deselecciona el objeto activo.
   Hacé clic en "Tablero Eléctrico" o "Motor Eléctrico" para seleccionarlos.
   El objeto en el visor se resalta.

5. **Editar posición**:
   - Seleccioná el tablero. En el inspector aparecen campos editables
     para X, Y y Z (Z indica que es el centro del objeto).
   - Cambiá X a `0` y hacé clic en **Aplicar**. El tablero se mueve al
     centro en X dentro del visor inmediatamente.
   - Cambiá X a un valor no numérico (p. ej. `abc`). Aparece el mensaje
     de error. El objeto no se modifica.
   - Dejá un campo vacío y hacé clic en **Aplicar**. Aparece el error
     de campo vacío.

6. **Cancelar**: modificá un campo sin aplicar y hacé clic en **Cancelar**.
   Los campos vuelven a la posición guardada; el objeto no cambia.

7. **Apoyar en piso**: con el tablero o el motor seleccionado, hacé clic
   en el botón **Apoyar en piso**. El campo Z se actualiza a `alto / 2`
   (p. ej. 1000 para el tablero de 2000 mm de alto). Luego hacé clic en
   **Aplicar** para confirmar el cambio.

8. **Inspector de piso/nave** (solo lectura): seleccioná el piso o la nave
   en el árbol. El inspector muestra las posiciones sin campos editables.

9. **Deselección**: hacé clic en el fondo del visor o en el mismo
   elemento del árbol para deseleccionar.

10. **Origen del proyecto** (panel izquierdo, sección inferior):
    - Por defecto el origen está en `{0, 0, 0}`. Las coordenadas del
      inspector coinciden con las globales.
    - Cambiá el campo X del origen a `2000` y hacé clic en **Aplicar**.
      El marcador de ejes 3D se desplaza al nuevo origen. El inspector
      ahora muestra las coordenadas relativas a ese punto; p. ej. el
      motor (global X=4000) pasa a mostrar X=2000.
    - **Cancelar** en el panel de origen descarta los cambios en los
      inputs sin modificar el store.
    - **Restablecer** vuelve el origen a `{0, 0, 0}`.
    - Seleccioná el motor y hacé clic en **Usar centro del objeto
      seleccionado**: el origen se traslada al centro geométrico del
      motor; todos los demás objetos muestran sus posiciones relativas
      a ese punto.
    - Verificá que la distancia relativa entre dos objetos (calculada a
      mano desde los valores del inspector) no cambia al mover el origen.
    - **Apoyar en piso con origen Z ≠ 0**: con origen Z=500, seleccioná
      el tablero y pulsá **Apoyar en piso**. El campo Z del inspector
      debe mostrar `500` (= 1000 − 500). Al aplicar, el tablero queda
      con su base en Z global = 0.

11. **Guardado y recuperación automática** (barra inferior):
    - Al abrir la app, el indicador muestra "Cargando..." mientras se
      lee IndexedDB y luego "Guardado localmente" si había un proyecto.
    - Mové el tablero (inspector → Aplicar) y observá "Guardando..." → 
      "Guardado localmente" al cabo de ~1 s.
    - **Prueba de recarga**: con el tablero en una posición personalizada
      y el origen modificado, recargá la página (F5 o Ctrl+R). El
      inspector y el marcador 3D deben mostrar los valores que tenían
      antes de recargar, no los de la escena de ejemplo.
    - **Exportar**: hacé clic en **Exportar**. El navegador descarga
      `proyecto-bandejas-YYYY-MM-DD.json`. Abrí el archivo con un editor
      de texto y verificá que contiene `schemaVersion`, `objects` y
      `projectOrigin` (en mm respecto del sistema global).
    - **Importar**: modificá el JSON descargado (p. ej. cambiá X del
      tablero a `0`), guardá y hacé clic en **Importar**. Confirmá el
      diálogo. El tablero debe desplazarse a la nueva posición.
    - **Importar archivo inválido**: intentá importar un `.json` que no
      sea un proyecto (p. ej. `{"foo":"bar"}`). Aparece el mensaje de
      error en la barra inferior y el proyecto permanece inalterado.
    - **Restablecer ejemplo**: hacé clic en **Restablecer ejemplo** y
      confirmá. La escena vuelve a los objetos de ejemplo; el origen
      regresa a `{0, 0, 0}`.
    - **El guardado local pertenece a este navegador**: si abrís la app
      en otro navegador o perfil, comenzará con la escena de ejemplo.
      Usá **Exportar** para mover el proyecto entre navegadores.

## Estructura del proyecto

```
src/
  types/domain.ts           Modelo de datos (mm, Z-up, IDs estables)
  store/
    sceneStore.ts           Estado global (Zustand): objetos + selección + origen + estado de guardado
    initialObjects.ts       Objetos de ejemplo de la escena
  persistence/
    schema.ts               Versión de esquema y tipo ProjectData
    validate.ts             Validación en tiempo de ejecución del JSON importado
    db.ts                   Wrapper de IndexedDB (sin dependencias externas)
    projectManager.ts       initProject, exportProject, importProject, resetProject
    __tests__/
      validate.test.ts      Pruebas unitarias del validador
      db.test.ts            Pruebas de IndexedDB (fake-indexeddb)
      projectManager.test.ts Pruebas de guardar/cargar/importar/exportar (mocked DB)
  scene/
    coords.ts               Conversión dominio → Three.js (centralizada)
    Floor.tsx               Piso y grilla
    Building.tsx            Nave industrial (wireframe)
    ElectricalPanel.tsx     Tablero eléctrico
    Motor.tsx               Motor eléctrico
    OriginMarker.tsx        Marcador 3D de los ejes del origen
    SceneObjects.tsx        Renderiza todos los objetos del store
    __tests__/
      coords.test.ts        Pruebas de conversión, distancias y apoyo en piso
  ui/
    Layout.tsx              Distribución de los 4 paneles
    SceneTree.tsx           Panel izquierdo: árbol por categorías contraíbles
    Inspector.tsx           Panel derecho: propiedades + editor de posición
    OriginPanel.tsx         Sección inferior izquierda: origen del proyecto
    ProjectActions.tsx      Barra inferior: estado, Exportar, Importar, Restablecer
    ConductorBar.tsx        Panel inferior: acciones del proyecto + placeholder de conductores
    positionEditor.ts       Funciones puras: validación y snap-to-floor
    __tests__/
      positionEditor.test.ts              Pruebas unitarias de positionEditor
      Inspector.interaction.test.tsx      Pruebas de interacción del inspector (jsdom)
      OriginPanel.interaction.test.tsx    Pruebas de interacción del panel de origen (jsdom)
      ProjectActions.interaction.test.tsx Pruebas de interacción de acciones del proyecto (jsdom)
      SceneTree.interaction.test.tsx      Pruebas de interacción del árbol (jsdom)
  App.tsx                   Punto de entrada: monta el Layout y llama a initProject
  styles/global.css         Estilos oscuros
```

## Funciones no implementadas aún

- Bandejas portacables
- Lista de conductores
- Importación/exportación DXF
- Backend, cuentas de usuario y sincronización en la nube

## Motor de bandejas experimental

Con Python >=3.10 instalado: `npm run dev:trays`.
Abrir `http://localhost:5173/?workspace=bandejas`.
Incluye ejemplo sintético, cálculo Python, visor esquemático y edición con
invalidación/recalculo. No modifica proyectos guardados.
Guía completa: [integración del motor](docs/motor-bandejas-integration.md).
