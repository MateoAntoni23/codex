/**
 * ParametricScene — contenido 3D: GLB cargado + ejes locales + bocas + normales.
 *
 * Causa raíz corregida en este módulo (ver `stripOcpRootRotation`):
 *   OpenCASCADE 7.8 escribe en cada GLB una rotación de −90° alrededor de X
 *   en el nodo raíz (quaternion [-√2/2, 0, 0, √2/2]) para convertir su marco
 *   Z-up interno al Y-up que exige glTF. Nuestros generadores ya producen la
 *   geometría en Y-up (ala en Y), así que esa rotación QUEDA DUPLICADA y
 *   desacopla la malla del marco en el que vienen expresadas las bocas,
 *   normales y recorrido. Al cargar el GLB, neutralizamos el quaternion del
 *   nodo raíz para que la malla y los datos comparables vivan en el mismo
 *   marco (el de `generators/*.py`).
 *
 * Marcos explícitos usados aquí:
 *   - file frame (mm, Y-up, ala en Y): dentro del GLB una vez neutralizada la
 *     rotación raíz.
 *   - canonical frame (mm, Y-up): marco de generación de la reconstrucción.
 *     Coincide con el file frame de reconstrucciones y variantes. El STEP
 *     original carga en su propio file frame y se traslada al centro del
 *     bbox canónico (`canonical_bbox_mm` del catálogo) para comparación 1:1.
 *   - scene frame (m, Y-up): lo mismo, escalado por 0.001.
 *   - calibration frame: calibración manual (traslación XYZ y rotación Euler)
 *     aplicada SÓLO a la malla; las bocas permanecen en el marco canónico.
 */

import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { ParametricEntry, ParametricPort, ParametricVariantView, Vec3 } from './catalog';
import { useParametricStore, findEntry } from './useParametricStore';
import { useCalibrationStore, calibrationKey, IDENTITY_CALIBRATION, type Calibration } from './useCalibrationStore';

const MM_TO_M = 0.001;
const OCP_ROOT_SUFFIX = '_root';

/** Neutraliza la rotación −90°X que OpenCASCADE 7.8 escribe en cada GLB. */
function stripOcpRootRotation(scene: THREE.Object3D): void {
  scene.traverse((obj) => {
    if (obj.name.endsWith(OCP_ROOT_SUFFIX)) {
      obj.quaternion.identity();
      obj.updateMatrix();
      obj.updateMatrixWorld(true);
    }
  });
}

/** Clona la escena del GLB, neutraliza la rotación OCP y aplica material. */
function useCleanGlb(url: string, color: string, opacity: number): THREE.Group {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const clone = scene.clone(true);
    stripOcpRootRotation(clone);
    clone.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.material = new THREE.MeshStandardMaterial({
          color,
          metalness: 0.15,
          roughness: 0.55,
          transparent: opacity < 1,
          opacity,
          side: THREE.DoubleSide,
        });
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    return clone;
  }, [scene, color, opacity]);
}

function fileBboxMm(obj: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(obj);
}

function mmToM(p: Vec3): [number, number, number] {
  return [p[0] * MM_TO_M, p[1] * MM_TO_M, p[2] * MM_TO_M];
}

/**
 * Renderiza un GLB alineado al marco canónico.
 * - `alignToCenterMm` (opcional): si se provee, traslada la malla de modo que
 *   el centro de su bbox coincida con este punto en el marco canónico (se usa
 *   para el STEP original, que suele tener offsets globales de ensamble SAMET).
 * - `calibration` (opcional): transformación extra aplicada DESPUÉS del
 *   alineamiento, sólo a la malla; no toca puertos.
 */
function AlignedGlb({
  url,
  color,
  opacity = 1,
  alignToCenterMm,
  calibration,
}: {
  url: string;
  color: string;
  opacity?: number;
  alignToCenterMm?: Vec3;
  calibration?: Calibration;
}) {
  const clean = useCleanGlb(url, color, opacity);

  const alignOffsetMm = useMemo<Vec3>(() => {
    if (!alignToCenterMm) return [0, 0, 0];
    const b = fileBboxMm(clean);
    const centerX = (b.min.x + b.max.x) / 2;
    const centerY = (b.min.y + b.max.y) / 2;
    const centerZ = (b.min.z + b.max.z) / 2;
    return [
      alignToCenterMm[0] - centerX,
      alignToCenterMm[1] - centerY,
      alignToCenterMm[2] - centerZ,
    ];
  }, [clean, alignToCenterMm]);

  const cal: Calibration = calibration ?? IDENTITY_CALIBRATION;

  // Pivote para la rotación de calibración: centro del bbox tras alinear.
  const pivotMm = useMemo<Vec3>(() => {
    const b = fileBboxMm(clean);
    return [
      (b.min.x + b.max.x) / 2 + alignOffsetMm[0],
      (b.min.y + b.max.y) / 2 + alignOffsetMm[1],
      (b.min.z + b.max.z) / 2 + alignOffsetMm[2],
    ];
  }, [clean, alignOffsetMm]);

  const DEG = Math.PI / 180;
  return (
    <group
      position={[
        (pivotMm[0] + cal.tx_mm) * MM_TO_M,
        (pivotMm[1] + cal.ty_mm) * MM_TO_M,
        (pivotMm[2] + cal.tz_mm) * MM_TO_M,
      ]}
      rotation={[cal.rx_deg * DEG, cal.ry_deg * DEG, cal.rz_deg * DEG]}
    >
      <group position={[-pivotMm[0] * MM_TO_M, -pivotMm[1] * MM_TO_M, -pivotMm[2] * MM_TO_M]}>
        <group position={[alignOffsetMm[0] * MM_TO_M, alignOffsetMm[1] * MM_TO_M, alignOffsetMm[2] * MM_TO_M]}>
          <primitive object={clean} scale={MM_TO_M} />
        </group>
      </group>
    </group>
  );
}

function PortMarker({
  port,
  selected,
  onSelect,
  showNormal,
}: {
  port: ParametricPort;
  selected: boolean;
  onSelect(): void;
  showNormal: boolean;
}) {
  const center = mmToM(port.center);
  const normal = port.normal;
  const nLen = 0.15;
  const normalEnd: [number, number, number] = [
    center[0] + normal[0] * nLen,
    center[1] + normal[1] * nLen,
    center[2] + normal[2] * nLen,
  ];

  const rectPoints = useMemo(() => {
    const u = port.u_dir;
    const v = port.v_dir;
    const halfU = port.ancho_mm / 2;
    const halfV = port.ala_mm / 2;
    const c = port.center;
    const corners: Vec3[] = [
      [c[0] + u[0] * halfU + v[0] * halfV, c[1] + u[1] * halfU + v[1] * halfV, c[2] + u[2] * halfU + v[2] * halfV],
      [c[0] - u[0] * halfU + v[0] * halfV, c[1] - u[1] * halfU + v[1] * halfV, c[2] - u[2] * halfU + v[2] * halfV],
      [c[0] - u[0] * halfU - v[0] * halfV, c[1] - u[1] * halfU - v[1] * halfV, c[2] - u[2] * halfU - v[2] * halfV],
      [c[0] + u[0] * halfU - v[0] * halfV, c[1] + u[1] * halfU - v[1] * halfV, c[2] + u[2] * halfU - v[2] * halfV],
    ];
    const positions: number[] = [];
    corners.forEach((p) => positions.push(p[0] * MM_TO_M, p[1] * MM_TO_M, p[2] * MM_TO_M));
    positions.push(corners[0][0] * MM_TO_M, corners[0][1] * MM_TO_M, corners[0][2] * MM_TO_M);
    return new Float32Array(positions);
  }, [port]);

  const color = selected ? '#ffdd44' : '#44aaff';

  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <mesh position={center}>
        <sphereGeometry args={[selected ? 0.025 : 0.015, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[rectPoints, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} linewidth={2} />
      </line>
      {showNormal && (
        <>
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([...center, ...normalEnd]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color={color} linewidth={2} />
          </line>
          <mesh position={normalEnd}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </>
      )}
    </group>
  );
}

function LocalAxes({ lengthMm = 400 }: { lengthMm?: number }) {
  const L = lengthMm * MM_TO_M;
  return (
    <group>
      <AxisArrow direction={[1, 0, 0]} length={L} color="#ff5566" />
      <AxisArrow direction={[0, 1, 0]} length={L} color="#55cc55" />
      <AxisArrow direction={[0, 0, 1]} length={L} color="#4488ff" />
    </group>
  );
}

function AxisArrow({ direction, length, color }: { direction: [number, number, number]; length: number; color: string }) {
  const end: [number, number, number] = [direction[0] * length, direction[1] * length, direction[2] * length];
  const pts = useMemo(() => new Float32Array([0, 0, 0, ...end]), [end[0], end[1], end[2]]);
  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pts, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </line>
      <mesh position={end}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function Trajectory({ ports }: { ports: readonly ParametricPort[] }) {
  const pts = useMemo(() => {
    const flat: number[] = [];
    ports.forEach((p) => flat.push(p.center[0] * MM_TO_M, p.center[1] * MM_TO_M, p.center[2] * MM_TO_M));
    return new Float32Array(flat);
  }, [ports]);
  if (ports.length < 2) return null;
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pts, 3]} />
      </bufferGeometry>
      <lineDashedMaterial color="#aaaaff" dashSize={0.05} gapSize={0.03} />
    </line>
  );
}

function bboxCenterMm(bbox: ParametricEntry['canonical_bbox_mm']): Vec3 {
  return [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
}

function ActiveView({ entry, activeView }: { entry: ParametricEntry; activeView: ParametricVariantView }) {
  const showAxes = useParametricStore((s) => s.showAxes);
  const showPorts = useParametricStore((s) => s.showPorts);
  const showNormals = useParametricStore((s) => s.showNormals);
  const showTrajectory = useParametricStore((s) => s.showTrajectory);
  const compare = useParametricStore((s) => s.compareOriginal);
  const view = useParametricStore((s) => s.view);
  const selectedPort = useParametricStore((s) => s.selectedPort);
  const selectPort = useParametricStore((s) => s.selectPort);

  const activeKey = calibrationKey(entry.recipe, view);
  const cal = useCalibrationStore((s) => s.calibrations[activeKey]);
  const previewCal = useCalibrationStore((s) => s.preview);
  const effectiveCal: Calibration | undefined = previewCal?.key === activeKey ? previewCal.value : cal;

  const canonicalCenter = useMemo(() => bboxCenterMm(entry.canonical_bbox_mm), [entry]);
  const color = view === 'variant' ? '#6ab0ff' : view === 'reconstruction' ? '#b0e085' : '#cccccc';

  return (
    <group>
      {view === 'original' ? (
        <AlignedGlb
          url={entry.original_glb_url}
          color="#cccccc"
          alignToCenterMm={canonicalCenter}
          calibration={effectiveCal}
        />
      ) : (
        <>
          <AlignedGlb url={activeView.glb_url} color={color} calibration={effectiveCal} />
          {compare && (
            <AlignedGlb
              url={entry.original_glb_url}
              color="#888888"
              opacity={0.25}
              alignToCenterMm={canonicalCenter}
              /* el overlay original usa su propia calibración (clave :original) */
              calibration={useCalibrationStore.getState().calibrations[calibrationKey(entry.recipe, 'original')]}
            />
          )}
        </>
      )}

      {showAxes && <LocalAxes />}
      {showTrajectory && <Trajectory ports={activeView.ports} />}
      {showPorts &&
        activeView.ports.map((p) => (
          <PortMarker
            key={p.name}
            port={p}
            selected={selectedPort === p.name}
            onSelect={() => selectPort(p.name === selectedPort ? null : p.name)}
            showNormal={showNormals}
          />
        ))}
    </group>
  );
}

export function ParametricScene() {
  const recipe = useParametricStore((s) => s.recipe);
  const view = useParametricStore((s) => s.view);
  const entry = findEntry(recipe);
  const activeView: ParametricVariantView = view === 'variant' ? entry.variant : entry.reconstruction;

  return (
    <Suspense fallback={null}>
      <ActiveView entry={entry} activeView={activeView} />
    </Suspense>
  );
}

export function preloadRecipe(recipe: string) {
  const entry = findEntry(recipe);
  useGLTF.preload(entry.original_glb_url);
  useGLTF.preload(entry.reconstruction.glb_url);
  useGLTF.preload(entry.variant.glb_url);
}
