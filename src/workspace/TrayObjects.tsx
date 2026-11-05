/**
 * TrayObjects — renders tray pieces in the unified R3F scene.
 *
 * Rectos: BoxGeometry centered between P1 and P2, oriented along P1→P2.
 * Curves and T pieces: schematic Line between ports (no catalog dimensions).
 *
 * Coordinate transform: domain mm (Z-up) → viewer m (Y-up)
 *   viewer = [x/1000, z/1000, -y/1000]
 */
import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import type { Product } from '../tray/model';

type V3 = [number, number, number];

function toViewer(mm: V3): V3 {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}

function midpoint(a: V3, b: V3): V3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function lengthBetween(a: V3, b: V3): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);
}

// Quaternion that rotates the THREE default X axis to align with `dir`.
function alignToDir(dir: V3): THREE.Quaternion {
  const from = new THREE.Vector3(1, 0, 0);
  const to   = new THREE.Vector3(...dir).normalize();
  if (to.lengthSq() < 1e-10) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

function RectoPiece({
  p1mm, p2mm, width, selected, onClick,
}: {
  p1mm: V3; p2mm: V3; width: number; selected: boolean; onClick: () => void;
}) {
  const p1v = toViewer(p1mm);
  const p2v = toViewer(p2mm);
  const len = lengthBetween(p1v, p2v);
  const center = midpoint(p1v, p2v);
  const dir: V3 = [(p2v[0] - p1v[0]) / (len || 1), (p2v[1] - p1v[1]) / (len || 1), (p2v[2] - p1v[2]) / (len || 1)];
  const quat = useMemo(() => alignToDir(dir), [dir[0], dir[1], dir[2]]);
  const alaM   = 0.06;
  const widthM = width > 0 ? width / 1000 : 0.3;
  const color  = selected ? '#ffcf33' : '#50b8de';
  return (
    <mesh
      position={center}
      quaternion={quat}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <boxGeometry args={[len, alaM, widthM]} />
      <meshStandardMaterial color={color} transparent opacity={0.7} />
    </mesh>
  );
}

function SchematicPiece({
  ports, selected, onClick, label,
}: {
  ports: V3[]; selected: boolean; onClick: () => void; label: string;
}) {
  if (ports.length < 2) return null;
  const color = selected ? '#ffcf33' : '#8899bb';
  const start = ports[0];
  return (
    <group>
      {ports.slice(1).map((end, i) => (
        <Line
          key={i}
          points={[start, end]}
          color={color}
          lineWidth={selected ? 10 : 5}
          onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick(); }}
        />
      ))}
      <Html position={start} style={{ pointerEvents: 'none', color: '#aabbcc', fontSize: 10 }}>
        {label}
      </Html>
    </group>
  );
}

export function TrayObjects() {
  const entrada   = useTrayStore((s) => s.entrada);
  const traySelected = useWorkspaceStore((s) => s.selectedTrayId);
  const selectTray   = useWorkspaceStore((s) => s.selectTray);
  const layers    = useWorkspaceStore((s) => s.layers);
  const context   = useTrayStore((s) => s.context);

  if (!entrada || !layers.trays) return null;

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of context?.productos ?? []) m.set(p.producto_id, p);
    return m;
  }, [context?.productos]);

  return (
    <group>
      {entrada.piezas.map((piece) => {
        const ports = Object.values(piece.puertos);
        const p1 = ports[0]?.posicion_mm as V3 | undefined;
        const p2 = ports[1]?.posicion_mm as V3 | undefined;
        if (!p1 || !p2) return null;

        const product = productMap.get(piece.producto_id);
        const tipo    = product?.tipo_pieza ?? 'recta';
        const isSelected = traySelected === piece.instancia_id;
        const onClick = () => selectTray(piece.instancia_id);

        if (tipo === 'recta') {
          return (
            <RectoPiece
              key={piece.instancia_id}
              p1mm={p1}
              p2mm={p2}
              width={product?.ancho_nominal_mm ?? 0}
              selected={isSelected}
              onClick={onClick}
            />
          );
        }

        // Curves and T: schematic lines through all ports
        const allPorts: V3[] = ports.map((p) => toViewer(p.posicion_mm as V3));
        return (
          <SchematicPiece
            key={piece.instancia_id}
            ports={allPorts}
            selected={isSelected}
            onClick={onClick}
            label={piece.instancia_id}
          />
        );
      })}

      {/* Supports */}
      {layers.supports && entrada.soportes.map((s) => {
        const piece = entrada.piezas.find((p) => p.instancia_id === s.instancia_id);
        const ports = piece ? Object.values(piece.puertos) : [];
        const a = ports[0]?.posicion_mm as V3 | undefined;
        const b = ports[1]?.posicion_mm as V3 | undefined;
        if (!a || !b) return null;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (!len) return null;
        const t   = s.distancia_desde_P1_mm / len;
        const q: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const qv  = toViewer(q);
        return (
          <mesh key={s.soporte_id} position={qv}>
            <boxGeometry args={[0.5, 0.12, 0.12]} />
            <meshBasicMaterial color="#bb77bb" />
          </mesh>
        );
      })}

      {/* PE route */}
      {layers.pe && entrada.pe.conductores.map((c, i) => {
        const path = c.recorrido as unknown[];
        if (!Array.isArray(path)) return null;
        const points: V3[] = [];
        for (const step of path) {
          const id = typeof step === 'string' ? step : (step && typeof step === 'object' && 'instancia' in step ? String((step as Record<string, unknown>).instancia) : null);
          const p  = entrada.piezas.find((p) => p.instancia_id === id);
          if (p) for (const port of Object.values(p.puertos).slice(0, 2)) {
            points.push(toViewer(port.posicion_mm as V3));
          }
        }
        if (points.length < 2) return null;
        return (
          <Line
            key={i}
            points={points.map((p) => [p[0], p[1] + 0.08, p[2]] as V3)}
            color="#b9e539"
            dashed
            dashSize={0.1}
            gapSize={0.08}
            lineWidth={2}
          />
        );
      })}
    </group>
  );
}
