/**
 * PreviewSceneObjects — renderizado 3D de elementos v2 para la vista de prueba.
 *
 * Convención de rotación para el piso (PlaneGeometry + Grid):
 *   - El <group> recibe la posición y rotationViewer del elemento (orientación
 *     en espacio mundial). Mesh y Grid heredan esa transformación.
 *   - El <mesh> de PlaneGeometry aplica Q_PLANE_BASE localmente: orienta la
 *     geometría de XY (normal +Z nativo) a XZ (normal +Y visor).
 *   - <Grid> NO recibe Q_PLANE_BASE. Drei ya transforma su geometría a XZ en
 *     su shader (position.xzy), por lo que añadir la rotación la duplicaría
 *     y levantaría la grilla fuera del piso.
 *   - Box / Cylinder / Asset: usar rotationViewer directamente como cuaternión.
 */

import { useMemo } from 'react';
import { Html, Grid, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { elementToRenderProps } from '../scene/v2-adapter';
import { usePreviewStore } from './usePreviewStore';
import { PREVIEW_ELEMENTS, PREVIEW_PROJECT_ORIGIN } from './previewData';
import type { ElementRenderProps } from '../scene/v2-adapter';

type Q4 = [number, number, number, number];

// Cuaternión local del mesh de piso: lleva PlaneGeometry de XY (normal +Z) a XZ (normal +Y visor)
const Q_PLANE_BASE_Q4: Q4 = [-Math.SQRT2 / 2, 0, 0, Math.SQRT2 / 2];

const CATEGORY_COLOR: Record<string, string> = {
  electrical_panel: '#5577aa',
  motor:            '#778866',
  pump:             '#6688aa',
  sensor:           '#aa7733',
  process_valve:    '#8866aa',
  solenoid_valve:   '#aa6688',
  actuator:         '#668899',
  luminaire:        '#aaaa44',
  pushbutton:       '#aa6644',
  terminal_block:   '#888888',
  manifold:         '#7788aa',
  pneumatic_panel:  '#5599aa',
  infrastructure:   '#445566',
};

function categoryColor(c: string) {
  return CATEGORY_COLOR[c] ?? '#888888';
}

// ─── Marcador de origen ───────────────────────────────────────────────────────

function PreviewOriginMarker() {
  const L = 1.5;
  const o = PREVIEW_PROJECT_ORIGIN;
  const pos: [number, number, number] = [o.x / 1000, o.z / 1000, -(o.y / 1000)];
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Line points={[[0, 0, 0], [L, 0, 0]]}  color="#ff4444" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, 0, -L]]} color="#44cc66" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, L, 0]]}  color="#4488ff" lineWidth={2} />
    </group>
  );
}

// ─── Elemento individual ──────────────────────────────────────────────────────

interface ElementProps {
  renderProps: ElementRenderProps;
  isSelected: boolean;
  onSelect: () => void;
}

function PreviewElement({ renderProps: p, isSelected, onSelect }: ElementProps) {
  const { positionViewer, rotationViewer, sizeViewer, geometryKind, category, isFloor, name } = p;

  const meshQuat = useMemo<Q4>(
    () => (rotationViewer ? (rotationViewer as Q4) : [0, 0, 0, 1]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rotationViewer?.[0], rotationViewer?.[1], rotationViewer?.[2], rotationViewer?.[3]],
  );

  if (!positionViewer) return null;

  const color = categoryColor(category);
  const emissive = isSelected ? '#223366' : '#000000';
  const emissiveIntensity = isSelected ? 2 : 0;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  // ── Piso (plane + isFloor) ────────────────────────────────────────────────
  if (geometryKind === 'plane' && isFloor) {
    const [w, , d] = sizeViewer ?? [30, 0, 30];
    return (
      // Grupo: aplica posición y rotationViewer del elemento al conjunto.
      <group position={positionViewer} quaternion={meshQuat}>
        {/* Mesh: Q_PLANE_BASE_Q4 localmente para girar PlaneGeometry a XZ. */}
        <mesh quaternion={Q_PLANE_BASE_Q4} receiveShadow onClick={handleClick}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial
            color="#2a2a3a"
            emissive={isSelected ? '#111133' : '#000000'}
            emissiveIntensity={isSelected ? 1 : 0}
          />
        </mesh>
        {/* Grid: sin rotación adicional — drei ya lo renderiza en XZ nativamente. */}
        <Grid
          args={[w, d]}
          cellSize={1}
          cellThickness={0.4}
          cellColor="#444466"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#6666aa"
          fadeDistance={80}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />
      </group>
    );
  }

  // ── Infraestructura box (nave) — wireframe ────────────────────────────────
  if (geometryKind === 'box' && category === 'infrastructure') {
    return (
      <mesh position={positionViewer} quaternion={meshQuat} onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshBasicMaterial color={isSelected ? '#aabbcc' : '#8899aa'} wireframe />
      </mesh>
    );
  }

  // ── Box ───────────────────────────────────────────────────────────────────
  if (geometryKind === 'box') {
    return (
      <mesh position={positionViewer} quaternion={meshQuat} castShadow onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  // ── Cylinder ──────────────────────────────────────────────────────────────
  if (geometryKind === 'cylinder') {
    const [dx, dy] = sizeViewer ?? [0.3, 1, 0.3];
    return (
      <mesh position={positionViewer} quaternion={meshQuat} castShadow onClick={handleClick}>
        <cylinderGeometry args={[dx / 2, dx / 2, dy, 24]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  // ── Asset — wireframe bounding box ───────────────────────────────────────
  if (geometryKind === 'asset') {
    return (
      <mesh position={positionViewer} quaternion={meshQuat} onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
    );
  }

  // ── Geometría desconocida — marcador "Dimensiones pendientes" ─────────────
  return (
    <group position={positionViewer}>
      <mesh onClick={handleClick}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial
          color="#eeaa00"
          emissive="#ff8800"
          emissiveIntensity={isSelected ? 3 : 1.5}
          wireframe
        />
      </mesh>
      <Html center distanceFactor={8} style={{ pointerEvents: 'none' }} position={[0, 0.45, 0]}>
        <div className="preview-pending-label">
          {name} — Dimensiones pendientes
        </div>
      </Html>
    </group>
  );
}

// ─── Escena completa ──────────────────────────────────────────────────────────

export function PreviewSceneObjects() {
  const selectedId = usePreviewStore((s) => s.selectedId);
  const select = usePreviewStore((s) => s.select);

  const allRenderProps = useMemo(
    () => PREVIEW_ELEMENTS.map((el) => elementToRenderProps(el, PREVIEW_ELEMENTS)),
    [],
  );

  return (
    <>
      <PreviewOriginMarker />
      {allRenderProps.map((rp) => {
        if (!rp.placed) return null; // sin ubicar: no se dibujan en escena
        return (
          <PreviewElement
            key={rp.id}
            renderProps={rp}
            isSelected={selectedId === rp.id}
            onSelect={() => select(rp.id)}
          />
        );
      })}
    </>
  );
}
