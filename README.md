# Diseñador de Bandejas Portacables 3D

Prototipo de aplicación web para diseñar instalaciones industriales con
bandejas portacables en un visor 3D interactivo.

## Requisitos

- [Node.js 18 o superior](https://nodejs.org/) (incluye npm) — probado con Node 24
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
   de la nave industrial, el tablero eléctrico azul y el motor verde.

2. **Cámara**: arrastrá para orbitar, rueda del mouse para zoom,
   clic-derecho + arrastrar para desplazar.

3. **Selección desde el visor**: hacé clic sobre el tablero o el motor.
   El objeto se ilumina y el panel derecho muestra sus propiedades.

4. **Selección desde el panel izquierdo**: hacé clic en "Tablero Eléctrico"
   o "Motor Eléctrico" en la lista. El objeto en el visor se resalta.

5. **Inspector**: verificá que muestra nombre, tipo y posición en mm
   (por ejemplo, el tablero está en X: −7000 mm).

6. **Deselección**: hacé clic en el fondo del visor o en el mismo
   elemento del árbol para deseleccionar.

## Estructura del proyecto

```
src/
  types/domain.ts           Modelo de datos (mm, Z-up, IDs estables)
  store/sceneStore.ts       Estado global (Zustand): objetos + selección
  scene/
    coords.ts               Conversión dominio → Three.js (centralizada)
    Floor.tsx               Piso y grilla
    Building.tsx            Nave industrial (wireframe)
    ElectricalPanel.tsx     Tablero eléctrico
    Motor.tsx               Motor eléctrico
    SceneObjects.tsx        Renderiza todos los objetos del store
    __tests__/
      coords.test.ts        Pruebas de conversión, distancias y apoyo en piso
  ui/
    Layout.tsx              Distribución de los 4 paneles
    SceneTree.tsx           Panel izquierdo: lista de objetos
    Inspector.tsx           Panel derecho: propiedades del objeto seleccionado
    ConductorBar.tsx        Panel inferior (reservado para conductores)
  styles/global.css         Estilos oscuros
```

## Funciones no implementadas aún

- Bandejas portacables
- Lista de conductores
- Importación/exportación DXF
- Edición de propiedades desde el inspector
- Backend y autenticación
