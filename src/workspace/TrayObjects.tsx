/**
 * TrayObjects — renders tray pieces in the unified R3F scene.
 *
 * Rectos: BoxGeometry centered between P1 and P2, oriented along P1→P2,
 *   using ancho_nominal_mm and ala_nominal_mm from catalog.
 *   If catalog dimensions are missing, renders as a schematic line labeled "sin dimensiones".
 * Curves and T pieces: schematic Line between ports (no catalog dimensions).
 *
 * Coordinate transform: domain mm (Z-up) → viewer m (Y-up)
 *   viewer = [x/1000, z/1000, -y/1000]
 *
 * All hooks are declared before any conditional return to comply with Rules of Hooks.
 */
import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useRoutingStore } from './useRoutingStore';
import type { Piece, Product } from '../tray/model';
import {
  resolveRecipe,
  verifyGeometricFit,
  placeRecipe,
  buildLocalMesh,
  type Vec3 as BridgeVec3,
} from './parametricBridge';
import { PlacedRecipePortFrames, logPlacement, isPortDiagEnabled } from './portFrameDiag';
import { LadderPiece, isLadderFamily } from './ladderGeometry';

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

function alignToDir(dir: V3): THREE.Quaternion {
  const from = new THREE.Vector3(1, 0, 0);
  const to   = new THREE.Vector3(...dir).normalize();
  if (to.lengthSq() < 1e-10) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

function alaFromProduct(product: Product | undefined): number | null {
  if (!product) return null;
  const v = (product as Record<string, unknown>).ala_nominal_mm;
  return typeof v === 'number' && v > 0 ? v : null;
}

function RectoPiece({
  p1mm, p2mm, widthMm, alaMm, selected, onClick, label, instanciaId, sku,
}: {
  p1mm: V3; p2mm: V3; widthMm: number | null; alaMm: number | null;
  selected: boolean; onClick: () => void; label: string;
  instanciaId: string; sku: string | null;
}) {
  const p1v = toViewer(p1mm);
  const p2v = toViewer(p2mm);
  const len = lengthBetween(p1v, p2v);
  const center = midpoint(p1v, p2v);
  const safeLen = len || 1;
  const dir: V3 = [(p2v[0] - p1v[0]) / safeLen, (p2v[1] - p1v[1]) / safeLen, (p2v[2] - p1v[2]) / safeLen];
  const quat = useMemo(() => alignToDir(dir), [dir[0], dir[1], dir[2]]);
  const color = selected ? '#ffcf33' : '#50b8de';
  const lenMm = lengthBetween(p1mm, p2mm);

  if (widthMm == null || alaMm == null) {
    return (
      <group
        onUpdate={(g) => {
          g.userData.codex = {
            kind: 'schematic-line-fallback',
            instanciaId, sku,
            p1mm, p2mm,
            widthMm, alaMm, lenMm,
            reason: 'missing-dimensions',
          };
        }}
      >
        <Line points={[p1v, p2v]} color={selected ? '#ffcf33' : '#8899bb'} lineWidth={selected ? 10 : 5}
          onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick(); }} />
        <Html position={center} style={{ pointerEvents: 'none', color: '#ff9955', fontSize: 10 }}>
          {label} · sin dimensiones
        </Html>
      </group>
    );
  }

  return (
    <mesh
      position={center}
      quaternion={quat}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onUpdate={(m) => {
        m.userData.codex = {
          kind: 'recto-box-fallback',
          instanciaId, sku,
          widthMm, alaMm, lenMm,
          p1mm, p2mm,
        };
      }}
    >
      <boxGeometry args={[len, alaMm / 1000, widthMm / 1000]} />
      <meshStandardMaterial color={color} transparent opacity={0.75} />
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
 * ParametricMesh — renderiza una pieza con la receta medida del STEP.
 *
 * Toma el anclaje (P1 real), aplica la quiralidad detectada por el puente,
 * y compone el transform mm→viewer con el transform local→mundo. El fit
 * debe estar validado (matches=true) antes de montar este componente.
 */
function ParametricMesh({
  product, piece, fit, selected, onClick,
}: {
  product: Product;
  piece: Piece;
  fit: NonNullable<ReturnType<typeof verifyGeometricFit>>;
  selected: boolean;
  onClick: () => void;
}) {
  const data = useMemo(() => {
    const entryPort = piece.puertos[fit.entryPortName];
    if (!entryPort) return null;
    const startPos = entryPort.posicion_mm as BridgeVec3;
    const entryDir: BridgeVec3 = [
      -entryPort.direccion[0],
      -entryPort.direccion[1],
      -entryPort.direccion[2],
    ];
    const storedSectionUp = entryPort.orientacion_seccion_ws as
      | BridgeVec3
      | undefined;
    const entry = fit.entry;
    const overrides = entry.piece_kind === 'tramo_recto'
      ? { longitud_mm: pieceLengthFromPorts(piece) }
      : undefined;
    const placed = placeRecipe(
      product, entry, startPos, entryDir, fit.chirality, overrides,
      {
        entryPortName: fit.entryPortName,
        ...(storedSectionUp ? { sectionUp: storedSectionUp } : {}),
      },
    );
    const g = buildLocalMesh(placed.recipe);
    const m = new THREE.Matrix4().multiplyMatrices(MM_TO_VIEWER, placed.matrix);
    logPlacement(`confirmed ${piece.instancia_id} (${product.sku})`, {
      sku: product.sku,
      ala_mm: placed.recipe.height,
      ancho_mm: (product.ancho_nominal_mm ?? null),
      chirality: fit.chirality,
      entryPortName: fit.entryPortName,
      startPosMm: startPos,
      entryDir,
      placedP1Mm: placed.p1.pos,
      placedP2Mm: placed.p2.pos,
      storedEntryMm: entryPort.posicion_mm as BridgeVec3,
    });
    return { geom: g, matrix: m, mirrored: placed.mirrored, placed };
  }, [fit, product, piece]);

  if (!data) return null;
  const color = selected ? '#ffcf33' : '#50b8de';
  return (
    <group>
      <mesh
        matrixAutoUpdate={false}
        onUpdate={(m) => {
          m.matrix.copy(data.matrix);
          m.matrixWorldNeedsUpdate = true;
          m.userData.codex = {
            kind: 'parametric-confirmed',
            instanciaId: piece.instancia_id,
            sku: product.sku,
            chirality: fit.chirality,
            mirrored: data.mirrored,
            entryPortName: fit.entryPortName,
            placedP1: data.placed.p1.pos,
            placedP2: data.placed.p2.pos,
            placedPorts: data.placed.ports.map((p) => ({
              name: p.name,
              pos: p.pos,
              outwardNormal: p.outwardNormal,
            })),
          };
        }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <primitive object={data.geom} attach="geometry" />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={isPortDiagEnabled() ? 0.4 : 0.75}
          side={data.mirrored ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>
      <PlacedRecipePortFrames tag={piece.instancia_id} placed={data.placed} />
    </group>
  );
}

/**
 * PieceVisual — despacho: receta paramétrica si existe y encaja; si no,
 * mantiene la representación anterior (Box para rectas, Line para el resto).
 */
function PieceVisual({
  product, piece, fallbackPorts, p1mm, p2mm, widthMm, alaMm, tipo,
  selected, onClick, label,
}: {
  product: Product | undefined;
  piece: Piece;
  fallbackPorts: V3[];
  p1mm: V3;
  p2mm: V3;
  widthMm: number | null;
  alaMm: number | null;
  tipo: string;
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  const fit = useMemo(
    () => (product && resolveRecipe(product) ? verifyGeometricFit(product, piece) : null),
    [product, piece],
  );

  if (isPortDiagEnabled()) {
    const path = product && fit && fit.matches
      ? 'parametric'
      : (tipo === 'recta' ? 'recto-box-fallback' : 'schematic-line-fallback');
    const fitInfo = fit
      ? { chirality: fit.chirality, p2PosErr: fit.p2PosErrorMm, p2DirErr: fit.p2DirErrorDeg, matches: fit.matches }
      : null;
    // eslint-disable-next-line no-console
    console.log(
      `%c[diag/path] ${piece.instancia_id} (${product?.sku ?? 'no-sku'}) → ${path}`,
      'color:#99ccff',
      { tipo, fit: fitInfo, ala_mm: alaMm, ancho_mm: widthMm },
    );
  }

  if (product && fit && fit.matches) {
    return (
      <ParametricMesh
        product={product}
        piece={piece}
        fit={fit}
        selected={selected}
        onClick={onClick}
      />
    );
  }

  // Familia escalera (SAM-STE-Z): generador propio de largueros + travesaños
  // a partir de puertos almacenados + dimensiones del catálogo. No mapea a
  // recetas de perforada (STP-Z).
  if (product && isLadderFamily(product)) {
    return (
      <LadderPiece
        piece={piece}
        product={product}
        selected={selected}
        onClick={onClick}
      />
    );
  }

  if (tipo === 'recta') {
    return (
      <RectoPiece
        p1mm={p1mm}
        p2mm={p2mm}
        widthMm={widthMm}
        alaMm={alaMm}
        selected={selected}
        onClick={onClick}
        label={label}
        instanciaId={piece.instancia_id}
        sku={product?.sku ?? null}
      />
    );
  }

  const portsMm = Object.values(piece.puertos).map((pp) => pp.posicion_mm as V3);
  return (
    <SchematicPiece
      ports={fallbackPorts}
      selected={selected}
      onClick={onClick}
      label={label}
      instanciaId={piece.instancia_id}
      sku={product?.sku ?? null}
      tipo={tipo}
      portsMm={portsMm}
    />
  );
}

function pieceLengthFromPorts(piece: Piece): number | null {
  const p1 = piece.puertos.P1;
  const p2 = piece.puertos.P2;
  if (!p1 || !p2) return null;
  if (typeof piece.longitud_mm === 'number' && piece.longitud_mm > 0) return piece.longitud_mm;
  const dx = p2.posicion_mm[0] - p1.posicion_mm[0];
  const dy = p2.posicion_mm[1] - p1.posicion_mm[1];
  const dz = p2.posicion_mm[2] - p1.posicion_mm[2];
  const d = Math.hypot(dx, dy, dz);
  return d > 0 ? d : null;
}

function SchematicPiece({
  ports, selected, onClick, label, instanciaId, sku, tipo, portsMm,
}: {
  ports: V3[]; selected: boolean; onClick: () => void; label: string;
  instanciaId: string; sku: string | null; tipo: string; portsMm: V3[];
}) {
  if (ports.length < 2) return null;
  const color = selected ? '#ffcf33' : '#8899bb';
  const start = ports[0];
  return (
    <group
      onUpdate={(g) => {
        g.userData.codex = {
          kind: 'schematic-line-fallback',
          instanciaId, sku, tipo,
          portsMm,
          reason: tipo === 'recta' ? 'no-parametric-recipe' : `non-straight-tipo:${tipo}`,
        };
      }}
    >
      {ports.slice(1).map((end, i) => (
        <Line key={i} points={[start, end]} color={color} lineWidth={selected ? 10 : 5}
          onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick(); }} />
      ))}
      <Html position={start} style={{ pointerEvents: 'none', color: '#aabbcc', fontSize: 10 }}>
        {label}
      </Html>
    </group>
  );
}

/** Port marker — shown when connection tool is active */
function PortMarker({
  posViewer, label, isSelected, onClick,
}: {
  posViewer: V3; label: string; isSelected: boolean; onClick: () => void;
}) {
  return (
    <group position={posViewer}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={isSelected ? '#ff6600' : '#00ffcc'} emissive={isSelected ? '#ff4400' : '#009988'} emissiveIntensity={1.5} />
      </mesh>
      <Html center distanceFactor={6} style={{ pointerEvents: 'none' }} position={[0, 0.14, 0]}>
        <span style={{ background: 'rgba(0,0,0,0.75)', color: isSelected ? '#ff9933' : '#00ffcc', fontSize: 10, padding: '1px 4px', borderRadius: 3, whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </Html>
    </group>
  );
}

/** P1 position marker — shown on selected support's piece */
function P1Marker({ posViewer }: { posViewer: V3 }) {
  return (
    <group position={posViewer}>
      <mesh>
        <sphereGeometry args={[0.07, 10, 10]} />
        <meshBasicMaterial color="#ff4444" />
      </mesh>
      <Html center distanceFactor={6} style={{ pointerEvents: 'none' }} position={[0, 0.14, 0]}>
        <span style={{ background: 'rgba(0,0,0,0.8)', color: '#ff6666', fontSize: 10, padding: '1px 4px', borderRadius: 3 }}>P1</span>
      </Html>
    </group>
  );
}

export function TrayObjects() {
  // All hooks BEFORE any conditional return
  const entrada              = useTrayStore((s) => s.entrada);
  const traySelected         = useWorkspaceStore((s) => s.selectedTrayId);
  const selectedSupportId    = useWorkspaceStore((s) => s.selectedSupportId);
  const selectTray           = useWorkspaceStore((s) => s.selectTray);
  const selectSupport        = useWorkspaceStore((s) => s.selectSupport);
  const layers               = useWorkspaceStore((s) => s.layers);
  const context              = useTrayStore((s) => s.context);
  const connectionToolActive = useWorkspaceStore((s) => s.connectionToolActive);
  const connectionPortA      = useWorkspaceStore((s) => s.connectionPortA);
  const setConnectionPortA   = useWorkspaceStore((s) => s.setConnectionPortA);
  const deactivateConnectionTool = useWorkspaceStore((s) => s.deactivateConnectionTool);
  const trayEdit             = useTrayStore((s) => s.edit);
  const markDirty            = useWorkspaceStore((s) => s.markDirty);
  const routingActive        = useRoutingStore((s) => s.active);
  const routingHoverPiece    = useRoutingStore((s) => s.hoverPiece);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of context?.productos ?? []) m.set(p.producto_id, p);
    return m;
  }, [context?.productos]);

  if (!entrada || !layers.trays) return null;

  const handlePortClick = (instanciaId: string, puertoId: string) => {
    const port: [string, string] = [instanciaId, puertoId];
    if (!connectionPortA) {
      setConnectionPortA(port);
    } else {
      // Port B selected — confirm and create connection
      const [aInst, aPort] = connectionPortA;
      if (aInst === instanciaId && aPort === puertoId) {
        setConnectionPortA(null);
        return;
      }
      const conexion_id = `CON-${Date.now().toString(36).toUpperCase()}`;
      if (confirm(`Conectar ${aInst}.${aPort} ↔ ${instanciaId}.${puertoId}?\nID: ${conexion_id}`)) {
        const next = structuredClone(entrada);
        next.conexiones.push({ conexion_id, a: [aInst, aPort], b: [instanciaId, puertoId] });
        trayEdit(next);
        markDirty();
      }
      deactivateConnectionTool();
    }
  };

  // Piece whose P1 we highlight (selected support)
  const selectedSupport = selectedSupportId ? entrada.soportes.find((s) => s.soporte_id === selectedSupportId) : null;
  const supportPieceForP1 = selectedSupport ? entrada.piezas.find((p) => p.instancia_id === selectedSupport.instancia_id) : null;

  return (
    <group>
      {entrada.piezas.map((piece) => {
        const ports = Object.values(piece.puertos);
        const p1 = ports[0]?.posicion_mm as V3 | undefined;
        const p2 = ports[1]?.posicion_mm as V3 | undefined;
        if (!p1 || !p2) return null;

        const product   = productMap.get(piece.producto_id);
        const tipo      = product?.tipo_pieza ?? 'recta';
        const isSelected = traySelected === piece.instancia_id;
        const onClick   = () => {
          if (connectionToolActive || routingActive) return;
          selectTray(piece.instancia_id);
        };
        const onOver = routingActive
          ? (e: { stopPropagation: () => void }) => { e.stopPropagation(); routingHoverPiece(piece.instancia_id); }
          : undefined;
        const onOut = routingActive
          ? (e: { stopPropagation: () => void }) => { e.stopPropagation(); routingHoverPiece(null); }
          : undefined;

        return (
          <group
            key={piece.instancia_id}
            onPointerOver={onOver}
            onPointerOut={onOut}
          >
            <PieceVisual
              product={product}
              piece={piece}
              fallbackPorts={ports.map((pp) => toViewer(pp.posicion_mm as V3))}
              p1mm={p1}
              p2mm={p2}
              widthMm={product?.ancho_nominal_mm ?? null}
              alaMm={alaFromProduct(product)}
              tipo={tipo}
              selected={isSelected}
              onClick={onClick}
              label={piece.instancia_id}
            />

            {/* Port markers when connection tool is active */}
            {connectionToolActive && Object.entries(piece.puertos).map(([portId, port]) => {
              const isPortA = connectionPortA?.[0] === piece.instancia_id && connectionPortA?.[1] === portId;
              return (
                <PortMarker
                  key={`${piece.instancia_id}-${portId}`}
                  posViewer={toViewer(port.posicion_mm as V3)}
                  label={`${piece.instancia_id}.${portId}`}
                  isSelected={isPortA}
                  onClick={() => handlePortClick(piece.instancia_id, portId)}
                />
              );
            })}
          </group>
        );
      })}

      {/* P1 marker on the piece of the selected support */}
      {supportPieceForP1 && (() => {
        const p1mm = Object.values(supportPieceForP1.puertos)[0]?.posicion_mm as V3 | undefined;
        return p1mm ? <P1Marker posViewer={toViewer(p1mm)} /> : null;
      })()}

      {layers.supports && entrada.soportes.map((s) => {
        const piece = entrada.piezas.find((p) => p.instancia_id === s.instancia_id);
        const sPorts = piece ? Object.values(piece.puertos) : [];
        const a = sPorts[0]?.posicion_mm as V3 | undefined;
        const b = sPorts[1]?.posicion_mm as V3 | undefined;
        if (!a || !b) return null;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (!len) return null;
        const t = s.distancia_desde_P1_mm / len;
        const q: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const isSelectedSupport = selectedSupportId === s.soporte_id;
        return (
          <mesh
            key={s.soporte_id}
            position={toViewer(q)}
            onClick={(e) => { e.stopPropagation(); selectSupport(s.soporte_id); }}
          >
            <boxGeometry args={[0.5, 0.12, 0.12]} />
            <meshBasicMaterial color={isSelectedSupport ? '#ffcf33' : '#bb77bb'} />
          </mesh>
        );
      })}

      {layers.pe && entrada.pe.conductores.map((c, i) => {
        const path = c.recorrido as unknown[];
        if (!Array.isArray(path)) return null;
        const points: V3[] = [];
        for (const step of path) {
          const id = typeof step === 'string' ? step
            : (step && typeof step === 'object' && 'instancia' in step ? String((step as Record<string, unknown>).instancia) : null);
          const p = entrada.piezas.find((p) => p.instancia_id === id);
          if (p) for (const port of Object.values(p.puertos).slice(0, 2)) {
            points.push(toViewer(port.posicion_mm as V3));
          }
        }
        if (points.length < 2) return null;
        return (
          <Line key={i} points={points.map((p) => [p[0], p[1] + 0.08, p[2]] as V3)}
            color="#b9e539" dashed dashSize={0.1} gapSize={0.08} lineWidth={2} />
        );
      })}
    </group>
  );
}
