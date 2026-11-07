/**
 * RoutingObjects — R3F objects rendered during interactive tray routing.
 *
 * - Free port markers (orange spheres) shown while selecting a start port.
 * - Transparent preview mesh of the upcoming piece during configuration.
 *
 * Coordinate transform matches TrayObjects: [x/1000, z/1000, -y/1000]
 */
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
import {
  resolveRecipe,
  placeRecipe,
  buildLocalMesh,
  chiralityForTurn,
  type Vec3 as BridgeVec3,
} from './parametricBridge';
import type { Product } from '../tray/model';

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

// ─── Transform mm (Z-up) → viewer m (Y-up), como THREE.Matrix4 constante ──
const MM_TO_VIEWER = new THREE.Matrix4().set(
  1 / 1000,       0,         0, 0,
         0,       0,  1 / 1000, 0,
         0, -1 / 1000,        0, 0,
         0,       0,         0, 1,
);

/**
 * ParametricPreview — preview que usa la misma receta y transform que la
 * pieza confirmada. Compartir el puente garantiza que lo que se ve antes
 * de confirmar coincide con lo que queda al confirmar.
 */
function ParametricPreview({
  product,
  startPos,
  entryDir,
  turnDirection,
  overrideLengthMm,
}: {
  product: Product;
  startPos: BridgeVec3;
  entryDir: BridgeVec3;
  turnDirection: 'left' | 'right';
  overrideLengthMm?: number | null;
}) {
  const data = useMemo(() => {
    const entry = resolveRecipe(product);
    if (!entry) return null;
    try {
      const overrides = entry.piece_kind === 'tramo_recto' && overrideLengthMm && overrideLengthMm > 0
        ? { longitud_mm: overrideLengthMm }
        : undefined;
      const chirality = entry.piece_kind === 'curva_horizontal'
        ? chiralityForTurn(turnDirection)
        : 'native';
      const placed = placeRecipe(product, entry, startPos, entryDir, chirality, overrides);
      const geom = buildLocalMesh(placed.recipe);
      const matrix = new THREE.Matrix4().multiplyMatrices(MM_TO_VIEWER, placed.matrix);
      return { geom, matrix, mirrored: placed.mirrored };
    } catch {
      return null;
    }
  }, [product, startPos[0], startPos[1], startPos[2], entryDir[0], entryDir[1], entryDir[2], turnDirection, overrideLengthMm]);

  if (!data) return null;
  return (
    <mesh
      matrixAutoUpdate={false}
      onUpdate={(m) => {
        m.matrix.copy(data.matrix);
        m.matrixWorldNeedsUpdate = true;
      }}
    >
      <primitive object={data.geom} attach="geometry" />
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
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const hoverPiece      = useRoutingStore((s) => s.hoverPiece);
  const selectStartPort = useRoutingStore((s) => s.selectStartPort);
  const setProduct      = useRoutingStore((s) => s.setProduct);

  const freePorts = useMemo(() => {
    if (!entrada || !active) return [];
    return getFreePorts(entrada.piezas, entrada.conexiones);
  }, [entrada, active, entrada?.conexiones, entrada?.piezas]);

  const selectedProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === selectedProductId),
    [context?.productos, selectedProductId],
  );

  // Preview paramétrico cuando el producto seleccionado tiene receta medida.
  const parametricPreview = useMemo(() => {
    if (!startPort || step === 'selectingPort' || !selectedProduct) return null;
    const entry = resolveRecipe(selectedProduct);
    if (!entry) return null;
    // La dirección de avance que recibe el puente es la dirección "hacia la
    // nueva pieza", opuesta a la normal saliente del P1 origen (pieza previa).
    const entryDir: BridgeVec3 = [
      startPort.dir[0],
      startPort.dir[1],
      startPort.dir[2],
    ];
    const startPos: BridgeVec3 = [
      startPort.pos[0],
      startPort.pos[1],
      startPort.pos[2],
    ];
    // Para rectos, usar previewLengthMm si se configuró; si no, longitud catalogo.
    const overrideLengthMm = entry.piece_kind === 'tramo_recto' && previewLengthMm > 0
      ? previewLengthMm
      : null;
    return {
      product: selectedProduct,
      startPos,
      entryDir,
      overrideLengthMm,
    };
  }, [startPort, step, selectedProduct, previewLengthMm]);

  const previewData = useMemo(() => {
    if (!startPort || step === 'selectingPort') return null;
    // Si hay preview paramétrico, el fallback no se calcula.
    if (parametricPreview) return null;

    if (selectedProduct && isHorizontalCurve(selectedProduct)) {
      const angleDeg = (selectedProduct as Record<string, unknown>).angulo_grados as number | undefined;
      const radioInterior = (selectedProduct as Record<string, unknown>).radio_mm as number | undefined ?? 300;
      if (!angleDeg || angleDeg <= 0) return null;
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
  }, [startPort, step, previewLengthMm, snapToAxis, selectedProduct, turnDirection, parametricPreview]);

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
              const srcPiece = entrada.piezas.find((p) => p.instancia_id === fp.pieceId);
              if (srcPiece) setProduct(srcPiece.producto_id);
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
      {parametricPreview && (
        <ParametricPreview
          product={parametricPreview.product}
          startPos={parametricPreview.startPos}
          entryDir={parametricPreview.entryDir}
          turnDirection={turnDirection}
          overrideLengthMm={parametricPreview.overrideLengthMm}
        />
      )}

      {/* Fallback: preview rectangular/tubo para productos sin receta medida */}
      {previewData?.type === 'straight' && (
        <PreviewMesh
          center={previewData.center}
          dirV={previewData.dirV}
          len={previewData.len}
          widthMm={selectedProduct?.ancho_nominal_mm ?? 150}
          alaMm={(selectedProduct as Record<string, unknown> | undefined)?.ala_nominal_mm as number ?? 65}
        />
      )}
      {previewData?.type === 'curve' && (
        <CurvePreviewMesh arcPoints={previewData.arcPoints} widthMm={previewData.widthMm} />
      )}
    </group>
  );
}
