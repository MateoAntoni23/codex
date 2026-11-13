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
import type { Piece, Product, TrayInput } from '../tray/model';
import { isPortDiagEnabled } from './portFrameDiag';
import { placedOf } from './placement/definitions';
import { worldPorts } from './placement/placementCore';
import { angleMismatch } from './placement/angleCheck';
import { PlacedMesh } from './placement/PlacedMesh';
import { bocaConSeccion, checkJoin, formatJoin } from './placement/joins';
import { compatibilidadDirecta } from './compatibilidadFisica';
import { UNIONS_KEY, unionRecord, unionsOf } from './workspaceOperation';
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

/**
 * PieceVisual — despacho: receta paramétrica si existe y encaja; si no,
 * mantiene la representación anterior (Box para rectas, Line para el resto).
 */
function PieceVisual({
  product, piece, entrada, fallbackPorts, p1mm, p2mm, widthMm, alaMm, tipo,
  selected, onClick, label,
}: {
  product: Product | undefined;
  piece: Piece;
  entrada: TrayInput;
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
  // A-5: se dibuja desde lo guardado (definición + mano + pose). No se re-deduce
  // nada con verifyGeometricFit (queda para la migración y el diagnóstico).
  const placed = placedOf(entrada, piece);
  const colocacion = piece.colocacion;
  // Modelo no resuelto: la definición guardada gira otro ángulo que el declarado
  // (p. ej. colocada antes de la verificación). No se dibuja su malla como si
  // estuviera bien: queda el esquema por sus bocas, con marcador y motivo.
  const angleIssue = placed ? angleMismatch(placed.def) : null;

  // Escalera con definición guardada: largueros + planta DESDE LA DEFINICIÓN
  // (B-2), con la misma matriz y las mismas bocas que el preview.
  if (product && placed && !angleIssue && isLadderFamily(product)) {
    return (
      <PlacedMesh
        estilo="escalera"
        def={placed.def}
        huella={placed.colocacion.definicion.huella}
        mano={placed.colocacion.mano}
        pose={placed.colocacion.pose}
        color={selected ? '#ffcf33' : '#50b8de'}
        opacity={isPortDiagEnabled() ? 0.4 : 0.85}
        onClick={onClick}
        userData={{
          kind: 'ladder-definition',
          instanciaId: piece.instancia_id,
          sku: product.sku,
          entryPortName: placed.colocacion.boca_entrada ?? null,
          // Mismo formato que el esquema por bocas (nombre → posición en mm), para diagnóstico.
          ports: Object.fromEntries(worldPorts(placed.def, placed.colocacion.mano, placed.colocacion.pose).map((wp) => [wp.name, wp.pos])),
          widthMm: placed.def.ports[0]?.ancho_mm ?? null,
          alaMm: placed.def.mesh.height,
        }}
      />
    );
  }

  // Escalera SIN definición (sin resolver o proyecto anterior): esquema de
  // largueros a partir de sus bocas guardadas, con marcador si corresponde.
  if (product && isLadderFamily(product) && !angleIssue) {
    return (
      <group>
        <LadderPiece piece={piece} product={product} selected={selected} onClick={onClick} />
        {colocacion?.estado === 'sin_resolver' && <UnresolvedMarker piece={piece} motivo={colocacion.motivo} />}
      </group>
    );
  }

  if (product && placed && !angleIssue) {
    const nominal = placed.def.procedencia?.tipo === 'nominal';
    return (
      <group>
      {nominal && <UnresolvedMarker piece={piece} motivo={placed.def.procedencia!.nota} titulo="Geometría nominal" tipo="nominal" />}
      <PlacedMesh
        def={placed.def}
        huella={placed.colocacion.definicion.huella}
        mano={placed.colocacion.mano}
        pose={placed.colocacion.pose}
        color={selected ? '#ffcf33' : '#50b8de'}
        opacity={isPortDiagEnabled() ? 0.4 : 0.75}
        onClick={onClick}
        userData={{
          kind: 'parametric-confirmed',
          instanciaId: piece.instancia_id,
          sku: product.sku,
          entryPortName: placed.colocacion.boca_entrada ?? null,
        }}
      />
      </group>
    );
  }

  const fallback = tipo === 'recta'
    ? (
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
    )
    : (
      <SchematicPiece
        ports={fallbackPorts}
        selected={selected}
        onClick={onClick}
        label={label}
        instanciaId={piece.instancia_id}
        sku={product?.sku ?? null}
        tipo={tipo}
        portsMm={Object.values(piece.puertos).map((pp) => pp.posicion_mm as V3)}
      />
    );
  return (
    <group>
      {fallback}
      {colocacion?.estado === 'sin_resolver' && <UnresolvedMarker piece={piece} motivo={colocacion.motivo} />}
      {angleIssue && <UnresolvedMarker piece={piece} motivo={angleIssue.motivo} titulo="Modelo no resuelto" />}
    </group>
  );
}

/**
 * A-10: marcador visible de una pieza "sin resolver" (no encajó al migrar) o
 * con modelo no resuelto (giro medido ≠ declarado): conserva sus bocas y se
 * dibuja con este aviso y su motivo en su centro.
 */
function UnresolvedMarker({ piece, motivo, titulo = 'Sin resolver', tipo = 'unresolved' }: { piece: Piece; motivo: string; titulo?: string; tipo?: 'unresolved' | 'nominal' }) {
  const nominal = tipo === 'nominal';
  const ports = Object.values(piece.puertos);
  if (!ports.length) return null;
  const c = [0, 1, 2].map((i) => ports.reduce((s, p) => s + p.posicion_mm[i], 0) / ports.length) as V3;
  return (
    <group
      position={toViewer(c)}
      onUpdate={(g) => { g.userData.codex = { kind: nominal ? 'nominal-marker' : 'unresolved-marker', instanciaId: piece.instancia_id, titulo, motivo }; }}
    >
      <mesh>
        <octahedronGeometry args={[0.18, 0]} />
        <meshBasicMaterial color={nominal ? '#e0b040' : '#ff5a4f'} wireframe />
      </mesh>
      <Html center style={{ pointerEvents: 'none' }} position={[0, 0.3, 0]}>
        <div
          data-testid={nominal ? 'nominal-marker' : 'unresolved-marker'}
          title={motivo}
          style={{ background: nominal ? 'rgba(50,40,0,0.85)' : 'rgba(60,0,0,0.85)', color: nominal ? '#ffe9b0' : '#ffd0cc', fontSize: 10, padding: '2px 6px', borderRadius: 3, maxWidth: 260 }}
        >
          <strong>{titulo}</strong>
          <div style={{ fontSize: 9, opacity: 0.9 }}>{motivo}</div>
        </div>
      </Html>
    </group>
  );
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
      // A-7: se informa hueco, ángulo y giro; NUNCA se mueven piezas para tapar el hueco.
      const pa = entrada.piezas.find((p) => p.instancia_id === aInst);
      const pb = entrada.piezas.find((p) => p.instancia_id === instanciaId);
      const A = pa ? bocaConSeccion(entrada, pa, aPort) : null;
      const B = pb ? bocaConSeccion(entrada, pb, puertoId) : null;
      if (!pa || !pb || !A || !B) { deactivateConnectionTool(); return; }
      const check = checkJoin(A, B);
      // Regla física de unión directa (compatibilidadFisica.ts); la tabla sólo confirma o bloquea.
      const prodA = context?.productos.find((p) => p.producto_id === pa.producto_id);
      const prodB = context?.productos.find((p) => p.producto_id === pb.producto_id);
      const fisica = prodA && prodB ? compatibilidadDirecta(prodA, prodB, context?.compatibilidades ?? []) : null;
      const documented = !!fisica?.ok;
      // Mezcla de acabados: se permite y se avisa (no invalida la unión).
      const mezcla = fisica?.ok ? fisica.mezcla : null;
      const head = `Unir ${aInst}.${aPort} ↔ ${instanciaId}.${puertoId}
${formatJoin(check)}`;
      const body = (check.ok
        ? 'La unión cumple las tolerancias (D-14).'
        : `La unión NO cumple las tolerancias (${check.motivos.join('; ')}). No se mueve ninguna pieza: el hueco queda a la vista.`)
        + (check.avisos.length ? `
Avisos: ${check.avisos.join('; ')}` : '')
        + (mezcla ? `
⚠ MEZCLA DE ACABADOS — ${mezcla.texto}` : '');
      if (confirm(`${head}
${body}
¿Registrar la unión?`)) {
        let motivo: string | undefined;
        if (!documented) {
          motivo = (prompt('El catálogo no documenta esta unión. Motivo de la excepción:') ?? '').trim();
          if (motivo.length < 3) { deactivateConnectionTool(); return; }
        }
        const next = structuredClone(entrada) as TrayInput;
        next.conexiones.push({ conexion_id, a: [aInst, aPort], b: [instanciaId, puertoId] });
        (next as Record<string, unknown>)[UNIONS_KEY] = {
          ...unionsOf(next),
          [conexion_id]: unionRecord(documented ? (check.ok ? 'documentada' : 'manual') : 'excepcion', check, motivo),
        };
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
        // Una pieza de UNA boca (la DCPS: su cara de apoyo no es boca) se dibuja igual
        // desde su definición; antes se descartaba y el tramo continuado desde su boca
        // se veía suelto, sin junta con el flanco del tronco.
        if (!p1) return null;
        const p2 = (ports[1]?.posicion_mm as V3 | undefined) ?? (placedOf(entrada, piece) ? p1 : undefined);
        if (!p2) return null;

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
              entrada={entrada}
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
