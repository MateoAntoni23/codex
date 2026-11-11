/**
 * CalibrationPlayground — tarea #236 (hito 3 parte B).
 *
 * Herramienta visual aislada del proyecto del usuario para verificar que la
 * calibración de un patrón produce el mismo cuerpo+bocas+ejes tanto en el
 * preview (antes de insertar) como en la pieza realmente confirmada.
 *
 * Qué NO es:
 *   - No es el diff de configuración "Configuración actual / Patrón aprobado"
 *     (ver `PruebaTab`). Esa herramienta compara snapshots persistentes del
 *     mapping; esta renderiza la geometría operativa.
 *
 * Pipelines reales reutilizados:
 *   - `resolveParametricEntry` / `buildRecipeFromProduct` / `buildLocalMesh`
 *     — misma receta que usan el workspace y `ConfiguratorViewer`.
 *   - `placeRecipe(...)` — exactamente el mismo cálculo que ejecuta el preview
 *     (`parametric-preview` en RoutingObjects) y la pieza confirmada
 *     (`parametric-confirmed` en TrayObjects). Si cambia la calibración entre
 *     el click "Insertar preview" y el click "Confirmar", las dos mallas
 *     renderizadas aquí divergirán visualmente — eso es el canal de alerta.
 *
 * Aislamiento del proyecto:
 *   - No toca `trayStore`, no crea `Piece`s, no modifica `catalogConfigStore`.
 *   - El canvas tiene `data-testid="cfg-calibration-canvas"` y los dos mallas
 *     exponen `userData.codex.calibrationRole = 'preview' | 'confirmed'` para
 *     que un e2e pueda inspeccionar las matrices directamente.
 *   - El anclaje virtual (startPos=[0,0,0], entryDir=[+1,0,0], chirality=native,
 *     entryPortName=default) es fijo y determinista — el usuario no elige
 *     posición; sólo mira cómo queda la calibración de ESTE patrón.
 *
 * Estados:
 *   - vacío → sólo ejes + grid; sin mallas
 *   - preview → malla translúcida + puertos amarillos
 *   - confirmed (sin preview) → malla sólida + puertos cian
 *   - ambos → preview sobre confirmed (si la calibración no cambió, las dos
 *     deben superponerse exactamente; si cambió, se separan)
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Product } from '../tray/model';
import { definicionEfectiva, modeloDeProducto } from '../workspace/placement/definitions';
import {
  buildDefinitionRawGeometry,
  definitionPreTransform,
  placeDefinition,
  poseMatrix,
  worldPorts,
} from '../workspace/placement/placementCore';

/** Colocación capturada: matriz cruda→mundo (pose · calibración) y bocas en mundo. */
interface PlacedSnapshot {
  readonly matrix: THREE.Matrix4;
  readonly ports: readonly { readonly name: string; readonly pos: V3; readonly outwardNormal: V3 }[];
}
import { useCatalogConfigStore } from './catalogConfigStore';

// Igual que ConfiguratorViewer: convierte mm → sistema de coordenadas R3F.
// (x, y, z)_mm → (x/1000, z/1000, -y/1000)_viewer.
const MM_TO_VIEWER = new THREE.Matrix4().set(
  1 / 1000,  0,        0,       0,
  0,         0,        1 / 1000, 0,
  0,         -1 / 1000, 0,       0,
  0,         0,        0,       1,
);

type V3 = readonly [number, number, number];
type Role = 'preview' | 'confirmed';

interface Snapshot {
  readonly placed: PlacedSnapshot;
  readonly localGeom: THREE.BufferGeometry;
  /** Matriz world (mm) × MM_TO_VIEWER para que el mesh renderice en metros. */
  readonly viewerMatrix: THREE.Matrix4;
  /** Timestamp del snapshot — útil para reproducir el "¿cuándo lo capturaste?". */
  readonly takenAt: string;
}

function toViewerPoint(mm: V3): [number, number, number] {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}

function PortMarkers({ placed, color, role }: { placed: PlacedSnapshot; color: string; role: Role }) {
  // Cada puerto: una esfera en su centro + segmento siguiendo la normal exterior.
  // Las coordenadas vienen ya en mm en el mundo (post-placeRecipe).
  return (
    <group>
      {placed.ports.map((p) => {
        const center = toViewerPoint(p.pos);
        const tipMm: V3 = [
          p.pos[0] + p.outwardNormal[0] * 120,
          p.pos[1] + p.outwardNormal[1] * 120,
          p.pos[2] + p.outwardNormal[2] * 120,
        ];
        const tip = toViewerPoint(tipMm);
        return (
          <group key={`${role}-${p.name}`}>
            <mesh
              position={center}
              userData={{ codex: { calibrationRole: role, port: p.name, centerMm: p.pos, normalMm: p.outwardNormal } }}
            >
              <sphereGeometry args={[0.014, 12, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Line points={[center, tip]} color={color} lineWidth={2} />
            <mesh position={tip}>
              <sphereGeometry args={[0.007, 8, 8]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function PlacedMesh({
  snapshot,
  role,
  productId,
}: {
  snapshot: Snapshot;
  role: Role;
  productId: string;
}) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.geometry = snapshot.localGeom;
    m.matrixAutoUpdate = false;
    m.matrix.copy(snapshot.viewerMatrix);
    m.matrixWorldNeedsUpdate = true;
    m.userData.codex = {
      calibrationRole: role,
      productoId: productId,
      matrixWorld: Array.from(snapshot.viewerMatrix.elements),
      takenAt: snapshot.takenAt,
    };
  }, [snapshot, role, productId]);

  const style = role === 'preview'
    ? { color: '#ffb347', opacity: 0.55 }
    : { color: '#50b8de', opacity: 0.85 };

  return (
    <mesh ref={meshRef} matrixAutoUpdate={false}>
      <meshStandardMaterial
        color={style.color}
        transparent
        opacity={style.opacity}
        side={THREE.DoubleSide}
        depthWrite={role === 'confirmed'}
      />
    </mesh>
  );
}

function AxisHelpers() {
  return (
    <group>
      <Line points={[[0, 0, 0], [0.4, 0, 0]]} color="#ff4444" lineWidth={1.5} />
      <Line points={[[0, 0, 0], [0, 0.4, 0]]} color="#44ff44" lineWidth={1.5} />
      <Line points={[[0, 0, 0], [0, 0, 0.4]]} color="#4488ff" lineWidth={1.5} />
      <gridHelper args={[4, 20, '#444466', '#2a2a44']} />
    </group>
  );
}

function CalibrationSceneBridge({
  preview,
  confirmed,
}: {
  preview: Snapshot | null;
  confirmed: Snapshot | null;
}) {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    const w = window as typeof window & { __codex?: Record<string, unknown> };
    if (!w.__codex) w.__codex = {};
    // dump por rol — útil para e2e que verifique preview↔confirmed sin
    // tener que armar un tray real.
    w.__codex.calibrationMeshes = () => {
      const out: Array<Record<string, unknown>> = [];
      scene.traverse((obj) => {
        const cd = (obj as THREE.Object3D).userData?.codex as
          | { calibrationRole?: Role; productoId?: string; matrixWorld?: number[]; takenAt?: string }
          | undefined;
        if (!cd || !cd.calibrationRole || typeof cd.productoId !== 'string') return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.geometry) return;
        out.push({
          role: cd.calibrationRole,
          productoId: cd.productoId,
          matrixWorld: Array.from(mesh.matrixWorld.elements),
          takenAt: cd.takenAt ?? null,
        });
      });
      return out;
    };
    // dump de snapshots crudos — mm, antes de MM_TO_VIEWER — útil cuando el
    // e2e quiere comparar bit a bit la salida de placeRecipe.
    w.__codex.calibrationSnapshots = () => ({
      preview: preview
        ? {
            matrix: Array.from(preview.placed.matrix.elements),
            ports: preview.placed.ports.map((p) => ({
              name: p.name,
              center: p.pos,
              normal: p.outwardNormal,
            })),
            takenAt: preview.takenAt,
          }
        : null,
      confirmed: confirmed
        ? {
            matrix: Array.from(confirmed.placed.matrix.elements),
            ports: confirmed.placed.ports.map((p) => ({
              name: p.name,
              center: p.pos,
              normal: p.outwardNormal,
            })),
            takenAt: confirmed.takenAt,
          }
        : null,
    });
    return () => {
      if (w.__codex) {
        delete w.__codex.calibrationMeshes;
        delete w.__codex.calibrationSnapshots;
      }
    };
  }, [scene, preview, confirmed]);
  return null;
}

function buildSnapshot(product: Product): Snapshot | { error: string } {
  // B-2: la misma definición efectiva y la misma colocación que el espacio de trabajo.
  const d = definicionEfectiva(product);
  if (!d.ok) return { error: d.motivo };
  try {
    const entryPortName = d.def.ports.find((p) => p.name === 'P1')?.name ?? d.def.ports[0]?.name ?? 'P1';
    const { colocacion } = placeDefinition({
      def: d.def, huella: d.huella, mano: 'nativa', entryPortName, startPos: [0, 0, 0], entryDir: [1, 0, 0],
    });
    const matrix = poseMatrix(colocacion.pose).multiply(definitionPreTransform(d.def));
    const placed: PlacedSnapshot = {
      matrix,
      ports: worldPorts(d.def, 'nativa', colocacion.pose).map((p) => ({ name: p.name, pos: p.pos as V3, outwardNormal: p.normal as V3 })),
    };
    const localGeom = buildDefinitionRawGeometry(d.def);
    const viewerMatrix = new THREE.Matrix4().multiplyMatrices(MM_TO_VIEWER, matrix);
    return { placed, localGeom, viewerMatrix, takenAt: new Date().toISOString() };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function CalibrationPlayground({ product }: { product: Product }) {
  // Suscribimos overrides: si el usuario cambia la calibración desde otra
  // pestaña, los snapshots existentes NO se recalculan automáticamente — es
  // justamente lo que queremos visualizar (preview capturado antes del cambio
  // vs confirmed capturado después muestra la divergencia). Pero la receta
  // DISPONIBLE sí refleja la calibración actual, para el próximo click.
  const overrides = useCatalogConfigStore((s) => s.overrides);
  void overrides; // leer para suscribirse al re-render de `buildSnapshot`

  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [confirmed, setConfirmed] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset al cambiar de producto — los snapshots del patrón anterior no tienen
  // sentido en el patrón nuevo.
  const productId = product.producto_id;
  useEffect(() => {
    setPreview(null);
    setConfirmed(null);
    setError(null);
  }, [productId]);

  const hasRecipe = useMemo(() => !!modeloDeProducto(product), [product]);

  const handleInsertPreview = useCallback(() => {
    const snap = buildSnapshot(product);
    if ('error' in snap) {
      setError(snap.error);
      return;
    }
    setError(null);
    setPreview(snap);
  }, [product]);

  const handleConfirm = useCallback(() => {
    const snap = buildSnapshot(product);
    if ('error' in snap) {
      setError(snap.error);
      return;
    }
    setError(null);
    setConfirmed(snap);
  }, [product]);

  const handleReset = useCallback(() => {
    setPreview(null);
    setConfirmed(null);
    setError(null);
  }, []);

  // Diferencia máxima entre los dos snapshots (si ambos existen).
  const matrixDeltaMax = useMemo(() => {
    if (!preview || !confirmed) return null;
    const a = preview.placed.matrix.elements;
    const b = confirmed.placed.matrix.elements;
    let m = 0;
    for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  }, [preview, confirmed]);

  return (
    <div className="cfg-tab-content" data-testid="cfg-calibration-tab">
      <h3 className="cfg-section-title">Calibración visual (preview ↔ confirmado)</h3>
      <div className="cfg-tab-note">
        Herramienta aislada del proyecto: renderiza la pieza con los mismos pipelines que usan el
        workspace para previsualizar (naranja, translúcido) y para confirmar (celeste, sólido).
        Si la calibración no cambió entre los dos clicks, las mallas se superponen con precisión.
      </div>

      <div className="cfg-field-group" data-testid="cfg-calibration-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={handleInsertPreview}
          disabled={!hasRecipe}
          data-testid="cfg-calibration-insert"
        >
          Insertar preview
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!hasRecipe}
          data-testid="cfg-calibration-confirm"
        >
          Confirmar
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={!preview && !confirmed}
          data-testid="cfg-calibration-reset"
        >
          Reiniciar
        </button>
      </div>

      {error && (
        <div className="cfg-tab-note cfg-tab-note-warning" data-testid="cfg-calibration-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {!hasRecipe && !error && (
        <div className="cfg-tab-note cfg-tab-note-warning" style={{ marginTop: 12 }}>
          Este producto no tiene receta paramétrica — no se puede calibrar visualmente.
        </div>
      )}

      {matrixDeltaMax !== null && (
        <div
          className={`cfg-tab-note ${matrixDeltaMax < 1e-6 ? '' : 'cfg-tab-note-warning'}`}
          data-testid="cfg-calibration-delta"
          style={{ marginTop: 12 }}
        >
          Δ máx de matriz preview↔confirmado: <code>{matrixDeltaMax.toExponential(2)}</code>
          {matrixDeltaMax < 1e-6
            ? ' — calibración estable.'
            : ' — hay desplazamiento entre preview y confirmado; revisá qué editaste entre ambos clicks.'}
        </div>
      )}

      <div
        style={{
          width: '100%',
          height: 360,
          marginTop: 12,
          border: '1px solid #2a2a44',
          borderRadius: 4,
          background: '#0a0a14',
        }}
        data-testid="cfg-calibration-canvas-container"
      >
        <Canvas
          camera={{ position: [1.8, 1.4, 1.8], fov: 45 }}
          style={{ width: '100%', height: '100%' }}
          data-testid="cfg-calibration-canvas"
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 3, 2]} intensity={1.0} />
          <Suspense fallback={null}>
            {confirmed && (
              <>
                <PlacedMesh snapshot={confirmed} role="confirmed" productId={productId} />
                <PortMarkers placed={confirmed.placed} color="#44ddff" role="confirmed" />
              </>
            )}
            {preview && (
              <>
                <PlacedMesh snapshot={preview} role="preview" productId={productId} />
                <PortMarkers placed={preview.placed} color="#ffcf33" role="preview" />
              </>
            )}
          </Suspense>
          <AxisHelpers />
          <CalibrationSceneBridge preview={preview} confirmed={confirmed} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>

      <div className="cfg-tab-hint" style={{ marginTop: 8, fontSize: '0.85em', opacity: 0.75 }}>
        Anclaje virtual fijo: puerto de entrada en el origen, orientado hacia +X.
        No modifica trazado ni overrides; sólo exhibe la geometría operativa del patrón.
      </div>
    </div>
  );
}
