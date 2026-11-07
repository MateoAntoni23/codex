/**
 * ParametricScene — contenido 3D: GLB cargado + ejes locales + bocas + normales.
 *
 * Convención de unidades:
 *   - El GLB exportado desde CadQuery guarda coordenadas en mm.
 *   - Aquí escalamos toda la escena por 0.001 para trabajar en metros (unidades
 *     naturales de three.js). Camera, luces y grid están en el mismo marco.
 *
 * Convención de ejes (coincide con el local del generador paramétrico):
 *   - X local  = longitud de la pieza (longitudinal)
 *   - Y local  = ala (altura 65 mm)
 *   - Z local  = ancho (positivo hacia el observador, pieza en Z ≤ 0)
 *
 * El GLB conserva estos ejes; el Canvas usa Y-up (default three.js).
 */

import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { ParametricEntry, ParametricPort, ParametricVariantView, Vec3 } from './catalog';
import { findEntry, useParametricStore } from './useParametricStore';

const MM_TO_M = 0.001;

function GlbModel({ url, color, opacity = 1 }: { url: string; color: string; opacity?: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const base = new THREE.MeshStandardMaterial({
          color,
          metalness: 0.15,
          roughness: 0.55,
          transparent: opacity < 1,
          opacity,
          side: THREE.DoubleSide,
        });
        mesh.material = base;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    return clone;
  }, [scene, color, opacity]);
  return <primitive object={cloned} scale={MM_TO_M} />;
}

/** Convierte un punto mm → metros (sin rotación: GLB y escena comparten Y-up). */
function mmToM(p: Vec3): [number, number, number] {
  return [p[0] * MM_TO_M, p[1] * MM_TO_M, p[2] * MM_TO_M];
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
  const nLen = 0.15; // 150 mm de vector normal
  const normalEnd: [number, number, number] = [
    center[0] + normal[0] * nLen,
    center[1] + normal[1] * nLen,
    center[2] + normal[2] * nLen,
  ];

  // Rectángulo que representa la boca: ancho × ala alineado según u_dir/v_dir
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
    corners.forEach((p) => {
      positions.push(p[0] * MM_TO_M, p[1] * MM_TO_M, p[2] * MM_TO_M);
    });
    // cerrar el loop
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
          <bufferAttribute
            attach="attributes-position"
            args={[rectPoints, 3]}
          />
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
  // Trayectoria simple: polilínea entre centros de bocas en el orden declarado.
  const pts = useMemo(() => {
    const flat: number[] = [];
    ports.forEach((p) => {
      flat.push(p.center[0] * MM_TO_M, p.center[1] * MM_TO_M, p.center[2] * MM_TO_M);
    });
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

function ActiveView({ entry, activeView }: { entry: ParametricEntry; activeView: ParametricVariantView }) {
  const showAxes = useParametricStore((s) => s.showAxes);
  const showPorts = useParametricStore((s) => s.showPorts);
  const showNormals = useParametricStore((s) => s.showNormals);
  const showTrajectory = useParametricStore((s) => s.showTrajectory);
  const compare = useParametricStore((s) => s.compareOriginal);
  const view = useParametricStore((s) => s.view);
  const selectedPort = useParametricStore((s) => s.selectedPort);
  const selectPort = useParametricStore((s) => s.selectPort);

  const originalUrl = entry.original_glb_url;
  const color = view === 'variant' ? '#6ab0ff' : view === 'reconstruction' ? '#b0e085' : '#cccccc';

  return (
    <group>
      {view === 'original' ? (
        <GlbModel url={originalUrl} color="#cccccc" />
      ) : (
        <>
          <GlbModel url={activeView.glb_url} color={color} />
          {compare && <GlbModel url={originalUrl} color="#888888" opacity={0.25} />}
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

  // Si está la vista 'original', los puertos y bocas no tienen datos derivados
  // paramétricos; reutilizamos los de la reconstrucción como referencia.
  const activeView: ParametricVariantView = view === 'variant' ? entry.variant : entry.reconstruction;

  return (
    <Suspense fallback={null}>
      <ActiveView entry={entry} activeView={activeView} />
    </Suspense>
  );
}

// Precarga lazy al cambiar de receta.
export function preloadRecipe(recipe: string) {
  const entry = findEntry(recipe);
  useGLTF.preload(entry.original_glb_url);
  useGLTF.preload(entry.reconstruction.glb_url);
  useGLTF.preload(entry.variant.glb_url);
}
