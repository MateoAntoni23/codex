/**
 * RoutingObjects — R3F objects rendered during interactive tray routing.
 *
 * - Free port markers (orange spheres) shown while selecting a start port.
 * - Transparent preview mesh of the upcoming piece during configuration.
 *
 * Coordinate transform matches TrayObjects: [x/1000, z/1000, -y/1000]
 */
import { bocasOcupadasPorEnganches } from './derivacion/enganche';
import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useTrayStore } from '../tray/store';
import { useRoutingStore } from './useRoutingStore';
import {
  getFreePorts,
  computeEndpoint,
  snapDirectionToAxis,
} from './routingRules';
import type { Point3 } from './routingRules';
import { computeTurnPerp } from './addCurvePiece';
import { isHorizontalCurve } from './pieceClassification';
import { tieneDefinicion } from './placement/definitions';
import { isPortDiagEnabled } from './portFrameDiag';
import { PlacedMesh } from './placement/PlacedMesh';
import { isLadderFamily } from './ladderGeometry';
import { routingPlacementFromState } from './placement/routingPlacementState';

function toViewer(mm: Point3): Point3 {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}

function alignToDir(dir: Point3): THREE.Quaternion {
  const from = new THREE.Vector3(1, 0, 0);
  const to = new THREE.Vector3(...dir).normalize();
  if (to.lengthSq() < 1e-10) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

// ─── Port marker ──────────────────────────────────────────────────────────────

function PortMarker({
  pos,
  label,
  dimmed,
  hovered,
  onClick,
  onOver,
  onOut,
}: {
  pos: Point3;
  label: string;
  dimmed: boolean;
  hovered: boolean;
  onClick: () => void;
  onOver: () => void;
  onOut: () => void;
}) {
  const r = hovered ? 0.1 : dimmed ? 0.045 : 0.065;
  const color = hovered ? '#ff9900' : dimmed ? '#7a4a1a' : '#ff7700';
  const emissiveIntensity = hovered ? 2.5 : dimmed ? 0.4 : 1.2;

  return (
    <group position={toViewer(pos)}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); onOver(); }}
        onPointerOut={(e) => { e.stopPropagation(); onOut(); }}
      >
        <sphereGeometry args={[r, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} />
      </mesh>

      {hovered && (
        <Html center distanceFactor={6} style={{ pointerEvents: 'none' }} position={[0, 0.2, 0]}>
          <span style={{
            background: 'rgba(0,0,0,0.8)',
            color: '#ffaa44',
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}>
            {label} · + Continuar aquí
          </span>
        </Html>
      )}
    </group>
  );
}

// ─── Preview mesh ─────────────────────────────────────────────────────────────

function PreviewMesh({
  center,
  dirV,
  len,
  widthMm,
  alaMm,
}: {
  center: Point3;
  dirV: Point3;
  len: number;
  widthMm: number;
  alaMm: number;
}) {
  const quat = useMemo(() => alignToDir(dirV), [dirV[0], dirV[1], dirV[2]]);
  return (
    <mesh position={center} quaternion={quat}>
      <boxGeometry args={[len, alaMm / 1000, widthMm / 1000]} />
      <meshStandardMaterial
        color="#ff9900"
        transparent
        opacity={0.35}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Hito 2: el preview paramétrico es la colocación calculada por
// `computeRoutingPlacement` (la misma que se guarda al confirmar), dibujada con
// `PlacedMesh` (la misma malla y matriz que la pieza confirmada).

// ─── Curve arc preview ────────────────────────────────────────────────────────

function CurvePreviewMesh({ arcPoints, widthMm }: { arcPoints: THREE.Vector3[]; widthMm: number }) {
  const geometry = useMemo(() => {
    if (arcPoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(arcPoints);
    return new THREE.TubeGeometry(curve, arcPoints.length * 2, (widthMm / 2) / 1000, 6, false);
  }, [arcPoints, widthMm]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#ff9900" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RoutingObjects() {
  const entrada         = useTrayStore((s) => s.entrada);
  const context         = useTrayStore((s) => s.context);
  const active          = useRoutingStore((s) => s.active);
  const step            = useRoutingStore((s) => s.step);
  const hoveredPieceId  = useRoutingStore((s) => s.hoveredPieceId);
  const startPort       = useRoutingStore((s) => s.startPort);
  const previewLengthMm = useRoutingStore((s) => s.previewLengthMm);
  const snapToAxis      = useRoutingStore((s) => s.snapToAxis);
  const turnDirection   = useRoutingStore((s) => s.turnDirection);
  const sentidoVertical = useRoutingStore((s) => s.sentidoVertical);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const entryPortName   = useRoutingStore((s) => s.entryPortName);
  const hoverPiece      = useRoutingStore((s) => s.hoverPiece);
  const selectStartPort = useRoutingStore((s) => s.selectStartPort);

  const freePorts = useMemo(() => {
    if (!entrada || !active) return [];
    return getFreePorts(entrada.piezas, entrada.conexiones, bocasOcupadasPorEnganches(entrada));
  }, [entrada, active, entrada?.conexiones, entrada?.piezas]);

  const selectedProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === selectedProductId),
    [context?.productos, selectedProductId],
  );

  // A-1: la colocación del preview es EL cálculo (el mismo que guarda confirmar).
  const placement = useMemo(
    () => routingPlacementFromState(context, entrada, {
      startPort, selectedProductId, entryPortName, turnDirection, previewLengthMm, snapToAxis, step, sentidoVertical,
    }),
    [context, entrada, startPort, selectedProductId, entryPortName, turnDirection, previewLengthMm, snapToAxis, step, sentidoVertical],
  );

  const previewData = useMemo(() => {
    if (!startPort || step === 'selectingPort') return null;
    // Si hay modelo (colocación calculada), el esquema de reserva no se calcula.
    if (placement || tieneDefinicion(selectedProduct)) return null;

    if (selectedProduct && isHorizontalCurve(selectedProduct)) {
      const angleDeg = (selectedProduct as Record<string, unknown>).angulo_grados as number | undefined;
      // Sin modelo: esquema con el radio del catálogo; sin radio declarado no
      // hay esquema (no se inventa uno; la confirmación también lo rechaza).
      const radioInterior = (selectedProduct as Record<string, unknown>).radio_mm as number | undefined;
      if (!angleDeg || angleDeg <= 0 || typeof radioInterior !== 'number') return null;
      const radiusMm = radioInterior + (selectedProduct.ancho_nominal_mm ?? 150) / 2;
      const entryDir = startPort.dir;
      const turnPerp = computeTurnPerp(entryDir, turnDirection);
      const θTotal = (angleDeg * Math.PI) / 180;
      const segments = 20;
      const arcPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const θ = (i / segments) * θTotal;
        const pt: Point3 = [
          startPort.pos[0] + radiusMm * Math.sin(θ) * entryDir[0] + radiusMm * (1 - Math.cos(θ)) * turnPerp[0],
          startPort.pos[1] + radiusMm * Math.sin(θ) * entryDir[1] + radiusMm * (1 - Math.cos(θ)) * turnPerp[1],
          startPort.pos[2] + radiusMm * Math.sin(θ) * entryDir[2] + radiusMm * (1 - Math.cos(θ)) * turnPerp[2],
        ];
        const v = toViewer(pt);
        arcPoints.push(new THREE.Vector3(v[0], v[1], v[2]));
      }
      return { type: 'curve' as const, arcPoints, widthMm: selectedProduct.ancho_nominal_mm ?? 150 };
    }

    // Straight preview
    if (previewLengthMm <= 0) return null;
    const dir = snapToAxis ? snapDirectionToAxis(startPort.dir) : startPort.dir;
    const endMm = computeEndpoint(startPort.pos, dir, previewLengthMm);
    const startV = toViewer(startPort.pos);
    const endV = toViewer(endMm);
    const len = Math.hypot(endV[0] - startV[0], endV[1] - startV[1], endV[2] - startV[2]);
    if (len < 0.001) return null;
    const center: Point3 = [
      (startV[0] + endV[0]) / 2,
      (startV[1] + endV[1]) / 2,
      (startV[2] + endV[2]) / 2,
    ];
    const dirV: Point3 = [
      (endV[0] - startV[0]) / len,
      (endV[1] - startV[1]) / len,
      (endV[2] - startV[2]) / len,
    ];
    return { type: 'straight' as const, center, dirV, len };
  }, [startPort, step, previewLengthMm, snapToAxis, selectedProduct, turnDirection, placement]);

  if (!active || !entrada) return null;

  const hasHover = hoveredPieceId !== null;

  return (
    <group>
      {/* Port markers — shown while selecting start port */}
      {step === 'selectingPort' && freePorts.map((fp) => {
        const isHovered = hoveredPieceId === fp.pieceId;
        return (
          <PortMarker
            key={`${fp.pieceId}:${fp.portName}`}
            pos={fp.pos}
            label={`${fp.pieceId}.${fp.portName}`}
            dimmed={hasHover && !isHovered}
            hovered={isHovered}
            onClick={() => {
              // No preseleccionar el producto de la pieza origen: el
              // panel de routing muestra la lista filtrada por compat.
              // y preseleccionar algo fuera de esa lista producía la
              // disonancia "selector muestra TRPS, preview muestra CPS".
              selectStartPort(fp);
            }}
            onOver={() => hoverPiece(fp.pieceId)}
            onOut={() => hoverPiece(null)}
          />
        );
      })}

      {/* Start port indicator — shown while configuring */}
      {startPort && step !== 'selectingPort' && (
        <group position={toViewer(startPort.pos)}>
          <mesh>
            <sphereGeometry args={[0.08, 12, 12]} />
            <meshStandardMaterial color="#ff9900" emissive="#ff6600" emissiveIntensity={2} />
          </mesh>
        </group>
      )}

      {/* Preview paramétrico (receta medida) — tiene prioridad sobre el fallback */}
      {placement?.ok && selectedProduct && (
        <PlacedMesh
          estilo={isLadderFamily(selectedProduct) ? 'escalera' : 'macizo'}
          def={placement.def}
          huella={placement.huella}
          mano={placement.colocacion.mano}
          pose={placement.colocacion.pose}
          color="#ff9900"
          opacity={isPortDiagEnabled() ? 0.2 : 0.35}
          depthWrite={false}
          userData={{
            kind: 'parametric-preview',
            sku: selectedProduct.sku,
            turnDirection,
            entryPortName: placement.entryPortName,
          }}
        />
      )}

      {/* Fallback: preview rectangular/tubo para productos sin receta medida.
          Si el producto no publica ala_nominal_mm, NO inventamos un genérico
          (65/50 varían por familia) — no se renderiza preview y el caller ve
          el aviso de datos faltantes en consola vía recipes.ts. */}
      {previewData?.type === 'straight' && (() => {
        const ala = (selectedProduct as Record<string, unknown> | undefined)?.ala_nominal_mm;
        if (typeof ala !== 'number' || !(ala > 0)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[routing/preview] ${selectedProduct?.sku ?? 'sin SKU'} no publica ala_nominal_mm — preview omitido.`,
          );
          return null;
        }
        return (
          <PreviewMesh
            center={previewData.center}
            dirV={previewData.dirV}
            len={previewData.len}
            widthMm={selectedProduct?.ancho_nominal_mm ?? 150}
            alaMm={ala}
          />
        );
      })()}
      {previewData?.type === 'curve' && (
        <CurvePreviewMesh arcPoints={previewData.arcPoints} widthMm={previewData.widthMm} />
      )}
    </group>
  );
}
