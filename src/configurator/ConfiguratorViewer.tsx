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
import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Product } from '../tray/model';
import { resolveParametricEntry, buildRecipeFromProduct, buildLocalMesh } from '../workspace/parametricBridge';
import { resolveRecipeForProduct } from '../workspace/resolvedPortGeometry';
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
      <mesh
        position={centerView}
        onUpdate={(m) => {
          m.userData.codex = { port: label, centerMm, normalMm };
        }}
      />
    </group>
  );
}

function ProductMesh({ product }: { product: Product }) {
  // Se suscribe a overrides para re-render al aplicar cambios.
  const overrides = useCatalogConfigStore((s) => s.overrides);

  const scene = useMemo(() => {
    const entry = resolveParametricEntry(product);
    if (!entry) return null;
    try {
      const raw = buildRecipeFromProduct(product, entry);
      const resolved = resolveRecipeForProduct(raw, product.producto_id);
      const geom = buildLocalMesh(raw);
      // Transformación local-raw → viewer: MM_TO_VIEWER * preTransform.
      const mTransform = new THREE.Matrix4().multiplyMatrices(
        MM_TO_VIEWER,
        resolved.preTransform,
      );
      return {
        geom,
        matrix: mTransform,
        ports: resolved.recipe.ports.map((p) => ({
          name: p.name,
          center: p.center,
          normal: p.normal,
        })),
        isIdentity: resolved.isIdentity,
      };
    } catch {
      return null;
    }
  }, [product, overrides]);

  if (!scene) return null;

  return (
    <group>
      <mesh
        onUpdate={(m) => {
          m.geometry = scene.geom;
          m.matrix.copy(scene.matrix);
          m.matrixAutoUpdate = false;
          m.matrixWorldNeedsUpdate = true;
          m.userData.codex = {
            productoId: product.producto_id,
            isIdentity: scene.isIdentity,
          };
        }}
      >
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
  const hasRecipe = !!product && !!resolveParametricEntry(product);
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
