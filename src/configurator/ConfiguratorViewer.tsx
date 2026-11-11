/**
 * ConfiguratorViewer — visor 3D del producto seleccionado, con overrides
 * aplicados (modelFrame + portGeometry). Muestra en vivo el efecto de la
 * configuración editada en el inspector.
 *
 * Diseño:
 *  - Reutiliza `buildLocalMesh` + la matriz del Configurador (MM→viewer)
 *    del workspace, de modo que lo que se ve aquí es LA MISMA geometría que
 *    luego se usa en preview/confirmado (la resolución común de
 *    `resolvedPortGeometry`).
 *  - Se muestra el mesh en marco canónico (sin colocar en un `startPos`),
 *    de modo que la rotación/traslación del modelo queda visible directamente.
 *  - Para cada puerto, se dibuja un marcador (esfera) con un segmento que
 *    indica la normal. Esto permite ver el efecto de `centerMm`, `normal`
 *    e `installRotationDeg`.
 *  - Al montarse, el store de overrides se suscribe para re-renderizar
 *    cuando el usuario aplica cambios desde la pestaña Orientación.
 *
 * El visor NO depende de `placeRecipe` para no tener que elegir un puerto
 * de entrada ni una dirección. El objetivo es mostrar EL MODELO, no una
 * instancia colocada.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Product } from '../tray/model';
import { definicionEfectiva, modeloDeProducto } from '../workspace/placement/definitions';
import { buildDefinitionRawGeometry, definitionPreTransform } from '../workspace/placement/placementCore';
import { useCatalogConfigStore } from './catalogConfigStore';

const MM_TO_VIEWER = new THREE.Matrix4().set(
  1 / 1000,       0,         0, 0,
         0,       0,  1 / 1000, 0,
         0, -1 / 1000,        0, 0,
         0,       0,         0, 1,
);

type V3 = [number, number, number];

function toViewer(mm: V3): V3 {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}

function PortFrame({
  centerMm,
  normalMm,
  color,
  label,
}: {
  centerMm: V3;
  normalMm: V3;
  color: string;
  label: string;
}) {
  const centerView = toViewer(centerMm);
  const tipMm: V3 = [
    centerMm[0] + normalMm[0] * 80,
    centerMm[1] + normalMm[1] * 80,
    centerMm[2] + normalMm[2] * 80,
  ];
  const tipView = toViewer(tipMm);
  const diagRef = useRef<THREE.Mesh | null>(null);
  // Keep userData in sync even when position/normal change for the same port name.
  useLayoutEffect(() => {
    const m = diagRef.current;
    if (!m) return;
    m.userData.codex = { port: label, centerMm, normalMm };
  }, [label, centerMm, normalMm]);
  return (
    <group>
      <mesh position={centerView}>
        <sphereGeometry args={[0.012, 10, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Line points={[centerView, tipView]} color={color} lineWidth={2} />
      <mesh position={tipView}>
        <sphereGeometry args={[0.006, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={diagRef} position={centerView} visible={false} />
    </group>
  );
}

function ProductMesh({ product }: { product: Product }) {
  // Se suscribe a overrides para recomputar la escena al aplicar cambios
  // (modelFrame/portGeometry). Cambiar el producto también recomputa.
  const overrides = useCatalogConfigStore((s) => s.overrides);

  const scene = useMemo(() => {
    // B-2: la misma definición efectiva que el espacio de trabajo.
    const d = definicionEfectiva(product);
    if (!d.ok) return null;
    const geom = buildDefinitionRawGeometry(d.def);
    // Transformación local-raw → viewer: MM_TO_VIEWER * calibración del modelo.
    const mTransform = new THREE.Matrix4().multiplyMatrices(MM_TO_VIEWER, definitionPreTransform(d.def));
    return {
      geom,
      matrix: mTransform,
      ports: d.def.ports.map((p) => ({ name: p.name, center: p.center, normal: p.normal })),
      isIdentity: !d.calibrada,
    };
  }, [product, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  // Why: `onUpdate` de R3F sólo se dispara de forma fiable al adjuntar hijos;
  // asignar `geometry`/`matrix` desde allí deja la malla congelada cuando el
  // memo recomputa (ej.: cambiar modelFrame o seleccionar otro producto en la
  // lista). useLayoutEffect sí refresca la malla en cada cambio de `scene` y
  // además dispone la geometría previa para no filtrar buffers.
  const meshRef = useRef<THREE.Mesh | null>(null);
  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m || !scene) return;
    if (m.geometry && m.geometry !== scene.geom) {
      m.geometry.dispose();
    }
    m.geometry = scene.geom;
    m.matrixAutoUpdate = false;
    m.matrix.copy(scene.matrix);
    m.matrixWorldNeedsUpdate = true;
    m.userData.codex = {
      productoId: product.producto_id,
      isIdentity: scene.isIdentity,
      matrixElements: Array.from(scene.matrix.elements),
    };
  }, [scene, product.producto_id]);

  useEffect(() => {
    return () => {
      const m = meshRef.current;
      if (m?.geometry) m.geometry.dispose();
    };
  }, []);

  if (!scene) return null;

  return (
    <group>
      <mesh ref={meshRef} matrixAutoUpdate={false}>
        <meshStandardMaterial
          color={scene.isIdentity ? '#50b8de' : '#ffcf33'}
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
        />
      </mesh>
      {scene.ports.map((p) => (
        <PortFrame
          key={p.name}
          centerMm={[p.center[0], p.center[1], p.center[2]]}
          normalMm={[p.normal[0], p.normal[1], p.normal[2]]}
          color="#ff6666"
          label={p.name}
        />
      ))}
    </group>
  );
}

/**
 * Bridge dev: expone el estado real de la escena del Configurador para que
 * los e2e verifiquen `matrixWorld` y la bbox de la malla renderizada, no
 * sólo bytes de screenshot. Devuelve `null` si no hay pieza paramétrica.
 */
function ConfiguratorSceneBridge() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const w = window as typeof window & { __codex?: Record<string, unknown> };
    if (!w.__codex) w.__codex = {};
    w.__codex.configuratorMesh = () => {
      let hit: Record<string, unknown> | null = null;
      scene.traverse((obj) => {
        const cd = (obj as THREE.Object3D).userData?.codex as
          | { productoId?: string; isIdentity?: boolean; matrixElements?: number[] }
          | undefined;
        if (!cd || typeof cd.productoId !== 'string') return;
        const mesh = obj as THREE.Mesh;
        mesh.updateWorldMatrix(true, false);
        if (mesh.geometry) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          hit = {
            productoId: cd.productoId,
            isIdentity: cd.isIdentity,
            matrixElements: cd.matrixElements ?? null,
            matrixWorld: mesh.matrixWorld.toArray(),
            bboxMin: bb ? [bb.min.x, bb.min.y, bb.min.z] : null,
            bboxMax: bb ? [bb.max.x, bb.max.y, bb.max.z] : null,
            geometryUuid: mesh.geometry.uuid,
          };
        }
      });
      return hit;
    };
    w.__codex.configuratorPorts = () => {
      const out: Array<Record<string, unknown>> = [];
      scene.traverse((obj) => {
        const cd = (obj as THREE.Object3D).userData?.codex as
          | { port?: string; centerMm?: V3; normalMm?: V3 }
          | undefined;
        if (!cd || typeof cd.port !== 'string') return;
        out.push({ port: cd.port, centerMm: cd.centerMm, normalMm: cd.normalMm });
      });
      return out;
    };
    return () => {
      if (w.__codex) {
        delete w.__codex.configuratorMesh;
        delete w.__codex.configuratorPorts;
      }
    };
  }, [scene]);
  return null;
}

function AxisHelpers() {
  // Ejes: X rojo, Y verde (local = ala), Z azul (world up via transform).
  return (
    <group>
      <Line points={[[0, 0, 0], [0.5, 0, 0]]} color="#ff4444" lineWidth={1} />
      <Line points={[[0, 0, 0], [0, 0.5, 0]]} color="#44ff44" lineWidth={1} />
      <Line points={[[0, 0, 0], [0, 0, 0.5]]} color="#4488ff" lineWidth={1} />
      <gridHelper args={[4, 20, '#444466', '#2a2a44']} />
    </group>
  );
}

export function ConfiguratorViewer({ product }: { product: Product | null }) {
  const hasRecipe = !!product && !!modeloDeProducto(product);
  return (
    <section className="cfg-viewer" data-testid="cfg-viewer">
      {product ? (
        <div className="cfg-viewer-head">
          <h2>{product.sku}</h2>
          <div className="cfg-viewer-sub">
            {product.producto_id} · {product.tipo_pieza} ·
            {' '}ancho: {product.ancho_nominal_mm ?? 'n/d'} mm
          </div>
        </div>
      ) : (
        <div className="cfg-viewer-head"><h2>Seleccioná un producto</h2></div>
      )}
      <div className="cfg-viewer-stage">
        {hasRecipe ? (
          <Canvas
            camera={{ position: [1.5, 1.2, 1.5], fov: 45 }}
            style={{ width: '100%', height: '100%', background: '#0a0a14' }}
            data-testid="cfg-viewer-canvas"
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[2, 3, 2]} intensity={1.0} />
            <Suspense fallback={null}>
              {product && <ProductMesh product={product} />}
            </Suspense>
            <AxisHelpers />
            <ConfiguratorSceneBridge />
            <OrbitControls makeDefault />
          </Canvas>
        ) : (
          <div className="cfg-viewer-stage-hint">
            {product
              ? 'Este producto no tiene receta paramétrica aún (ver pestaña Modelo / Parámetros).'
              : 'Seleccioná un producto a la izquierda para ver su geometría resuelta.'}
          </div>
        )}
      </div>
    </section>
  );
}
