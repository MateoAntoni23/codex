# Diseñador de Bandejas Portacables 3D

Prototipo de aplicación web para diseñar instalaciones industriales con
bandejas portacables en un visor 3D interactivo.

## Requisitos

- [Node.js 24 LTS](https://nodejs.org/) (incluye npm) — versión recomendada y comprobada
- [Git](https://git-scm.com/)

## Instalación (Windows)

Abrí una terminal (CMD o PowerShell) y ejecutá:

```bat
git clone https://github.com/MateoAntoni23/codex.git codex
cd codex
git checkout feat/initial-3d-editor
npm ci
```

> `npm ci` usa el `package-lock.json` para una instalación exacta y reproducible.
> Usá `npm install` solo si querés actualizar el lockfile.

## Iniciar en modo desarrollo

```bat
npm run dev
```

Abrí el navegador en **http://localhost:5173**

## Compilar para producción

```bat
npm run build
```

Los archivos quedan en la carpeta `dist/`.

## Verificar tipos TypeScript

```bat
npm run typecheck
```

## Ejecutar pruebas

```bat
npm test
```

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

## Qué probar visualmente

1. **Carga de la escena**: debés ver el piso gris con grilla, el contorno
   de la nave industrial, el tablero eléctrico azul y el motor verde,
   todos apoyados sobre el piso.

2. **Cámara**: arrastrá para orbitar, rueda del mouse para zoom,
   clic-derecho + arrastrar para desplazar.

3. **Selección desde el visor**: hacé clic sobre el tablero o el motor.
   El objeto se ilumina y el panel derecho muestra sus propiedades con
   campos de edición para X, Y y Z (en mm).

4. **Selección desde el panel izquierdo**: hacé clic en "Tablero Eléctrico"
   o "Motor Eléctrico" en la lista. El objeto en el visor se resalta.

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

## Estructura del proyecto

```
src/
  types/domain.ts           Modelo de datos (mm, Z-up, IDs estables)
  store/
    sceneStore.ts           Estado global (Zustand): objetos + selección + origen
    initialObjects.ts       Objetos de ejemplo de la escena
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
    SceneTree.tsx           Panel izquierdo: lista de objetos
    Inspector.tsx           Panel derecho: propiedades + editor de posición
    OriginPanel.tsx         Sección inferior izquierda: origen del proyecto
    ConductorBar.tsx        Panel inferior (reservado para conductores)
    positionEditor.ts       Funciones puras: validación y snap-to-floor
    __tests__/
      positionEditor.test.ts           Pruebas unitarias de positionEditor
      Inspector.interaction.test.tsx   Pruebas de interacción del inspector (jsdom)
      OriginPanel.interaction.test.tsx Pruebas de interacción del panel de origen (jsdom)
  styles/global.css         Estilos oscuros
```

## Funciones no implementadas aún

- Bandejas portacables
- Lista de conductores
- Importación/exportación DXF
- Edición de propiedades desde el inspector
- Backend y autenticación
