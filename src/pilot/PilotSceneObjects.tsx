/**
 * PilotSceneObjects — renderizado 3D de las 4 piezas piloto en la vista de prueba.
 *
 * Convenciones:
 *   - Entrada: pilot-geometry-reconstruction.json (schema v4), consumido por
 *     pilotAdapter (validado).
 *   - Marco local por pieza (mm, Z-up). El store aplica una placement
 *     (translación + yaw alrededor de Z) en el mundo.
 *   - Salida a Three.js: m, Y-up vía worldMmToViewer.
 *
 * Reglas visuales:
 *   - Recto: largueros + travesaños, sin fondo.
 *   - T, reducción: envolvente wireframe + recorrido centerline.
 *   - Curva: PROVISIONAL. Dibuja arco hipotético + recorrido L + muestras del
 *     contorno fuente, para comparación visual. No se traza como geometría
 *     verificada.
 *   - Bocas: disco translúcido perpendicular a la normal + flecha de normal;
 *     SELECCIONABLES por click.
 *   - Ejes locales en el origen de cada pieza.
 *   - Cotas principales como Html labels.
 */

import { Fragment, useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { getPilotData } from './pilotAdapter';
import { usePilotStore, INITIAL_LAYOUT_MM } from './usePilotStore';
import {
  applyPlacement,
  rotateDirByPlacement,
  rungPositions,
  worldDirToViewer,
  worldMmToViewer,
} from './pilotGeometry';
import type { BocaKey } from './usePilotStore';
import type {
  Mat3,
  Pieza,
  PiezaCurva,
  PiezaId,
  PiezaRecto,
  PiezaReduccion,
  PiezaTe,
  Vec2,
  Vec3,
} from './types';
import type { Placement } from './pilotGeometry';

type V3 = readonly [number, number, number];

const COLORS = {
  piece: '#7799cc',
  pieceSel: '#aaccff',
  provisional: '#cc8833',
  rail: '#99aacc',
  rung: '#88aadd',
  boca: '#44ddaa',
  bocaSel: '#88ffdd',
  bocaNormal: '#44ddaa',
  bocaProv: '#eebb66',
  envelope: '#4a4a66',
  recorrido: '#dde6ff',
  recorridoProv: '#ffaa55',
  contour: '#aaaacc',
  axisX: '#ff5555',
  axisY: '#55ff77',
  axisZ: '#5588ff',
  origin: '#ffffff',
} as const;

const AXIS_LENGTH_M = 0.3;
const BOCA_RADIUS_M = 0.08;
const BOCA_ARROW_LENGTH_M = 0.25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Transforma un punto DXF al local de la pieza usando R y origen. */
function dxfToLocal(R: Mat3, origen: Vec2, pDxf: Vec2): Vec3 {
  const dx = pDxf[0] - origen[0];
  const dy = pDxf[1] - origen[1];
  const dz = 0;
  return [
    R[0][0] * dx + R[0][1] * dy + R[0][2] * dz,
    R[1][0] * dx + R[1][1] * dy + R[1][2] * dz,
    R[2][0] * dx + R[2][1] * dy + R[2][2] * dz,
  ];
}

/** Local mm → world mm (placement) → viewer m. Encadenado para legibilidad. */
function toViewer(pLocal: Vec3, pm: Placement): V3 {
  return worldMmToViewer(applyPlacement(pLocal, pm)) as V3;
}

function toViewerDir(dLocal: Vec3, pm: Placement): V3 {
  const dWorld = rotateDirByPlacement(dLocal, pm);
  return worldDirToViewer(dWorld) as V3;
}

function sumV(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleV(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

// ─── Primitivas ───────────────────────────────────────────────────────────────

function LocalAxes({ origin }: { origin: V3 }) {
  const ax: V3 = sumV(origin, [AXIS_LENGTH_M, 0, 0]);
  const ay: V3 = sumV(origin, [0, 0, -AXIS_LENGTH_M]); // Y_local en mm → -Z_viewer
  const az: V3 = sumV(origin, [0, AXIS_LENGTH_M, 0]); // Z_local en mm → +Y_viewer
  return (
    <group>
      <Line points={[origin, ax]} color={COLORS.axisX} lineWidth={2} />
      <Line points={[origin, ay]} color={COLORS.axisY} lineWidth={2} />
      <Line points={[origin, az]} color={COLORS.axisZ} lineWidth={2} />
      <mesh position={origin}>
        <sphereGeometry args={[0.025, 10, 10]} />
        <meshBasicMaterial color={COLORS.origin} />
      </mesh>
    </group>
  );
}

function DimLabel({ at, text }: { at: V3; text: string }) {
  return (
    <Html center distanceFactor={10} position={at} style={{ pointerEvents: 'none' }}>
      <div className="pilot-dim-label">{text}</div>
    </Html>
  );
}

interface BocaMarkerProps {
  centerViewer: V3;
  normalViewer: V3;
  pieceId: PiezaId;
  bocaKey: BocaKey;
  isSelected: boolean;
  provisional: boolean;
}

function BocaMarker({ centerViewer, normalViewer, pieceId, bocaKey, isSelected, provisional }: BocaMarkerProps) {
  const selectBoca = usePilotStore((s) => s.selectBoca);
  const tip = sumV(centerViewer, scaleV(normalViewer, BOCA_ARROW_LENGTH_M));
  const color = isSelected ? COLORS.bocaSel : provisional ? COLORS.bocaProv : COLORS.boca;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectBoca(pieceId, bocaKey);
  };

  // Disco perpendicular a la normal: un pequeño cilindro aplanado orientado hacia la normal.
  // Para evitar tener que calcular quaternions aquí, usamos una esfera pequeña + flecha.
  return (
    <group>
      <mesh position={centerViewer} onClick={handleClick}>
        <sphereGeometry args={[BOCA_RADIUS_M, 16, 16]} />
        <meshStandardMaterial color={color} emissive={isSelected ? '#004422' : '#000000'} emissiveIntensity={isSelected ? 1.5 : 0} />
      </mesh>
      <Line points={[centerViewer, tip]} color={color} lineWidth={2} />
      <Html center distanceFactor={12} position={sumV(tip, [0, 0.05, 0])} style={{ pointerEvents: 'none' }}>
        <div className={`pilot-boca-label${isSelected ? ' pilot-boca-label--sel' : ''}`}>{bocaKey}</div>
      </Html>
    </group>
  );
}

// ─── Recto (escalera) ─────────────────────────────────────────────────────────

/**
 * Dibuja los dos largueros a Y_local=±(ancho/2) y travesaños cada ~250mm.
 * Sin fondo: no se dibuja la cara base.
 */
function RectoPiece({ pz, placement, selected }: { pz: PiezaRecto; placement: Placement; selected: boolean }) {
  const anchoMm = pz.catalogo.ancho_nominal_mm;
  const alturaMm = pz.catalogo.altura_nominal_mm;
  const lengthMm = pz.cotas_derivadas_local.P1_a_P2_axial_X_local_mm;
  const lateralOffsetMm = pz.cotas_derivadas_local.lateral_offset_Y_local_mm;

  const half = anchoMm / 2;
  const alt = alturaMm;

  // Larguero izquierdo (Y_local = -half en P1, se desplaza lateralmente al llegar a P2).
  // Ambos largueros reciben el lateral_offset del plegado Z en P2 para conservar la medición.
  // Representamos cada larguero como un rectángulo vertical (ancho=18mm, alto=65mm)
  // mediante 4 líneas: top-left, top-right, bot-right, bot-left. Es ligero y claro.
  const lineColor = selected ? COLORS.pieceSel : COLORS.piece;
  const rail = (yAt0: number, yAtEnd: number) => {
    const bot0: Vec3 = [0, yAt0, 0];
    const botEnd: Vec3 = [lengthMm, yAtEnd, 0];
    const top0: Vec3 = [0, yAt0, alt];
    const topEnd: Vec3 = [lengthMm, yAtEnd, alt];
    const pts: V3[] = [
      toViewer(bot0, placement),
      toViewer(botEnd, placement),
      toViewer(topEnd, placement),
      toViewer(top0, placement),
      toViewer(bot0, placement),
    ];
    return <Line points={pts} color={lineColor} lineWidth={1.5} />;
  };

  // Travesaños cada ~250 mm. Van del larguero izq al der a la misma Y lineal
  // (interpolamos lateral offset). Altura media del perfil.
  const rungs = rungPositions(lengthMm, Math.max(0, Math.floor(lengthMm / 250) - 1), 50);
  const yAtX = (x: number) => -half + 0 + (x / lengthMm) * lateralOffsetMm; // izq
  const yAtXRight = (x: number) => half + (x / lengthMm) * lateralOffsetMm; // der

  return (
    <group>
      {rail(-half, -half + lateralOffsetMm)}
      {rail(half, half + lateralOffsetMm)}
      {rungs.map((x, i) => {
        const left: Vec3 = [x, yAtX(x), alt / 2];
        const right: Vec3 = [x, yAtXRight(x), alt / 2];
        return (
          <Line
            key={i}
            points={[toViewer(left, placement), toViewer(right, placement)]}
            color={COLORS.rung}
            lineWidth={1}
          />
        );
      })}
      <DimLabel
        at={toViewer([lengthMm / 2, 0, alt + 100], placement)}
        text={`Recto · L=${lengthMm.toFixed(0)} mm · A=${anchoMm} mm (medido)`}
      />
    </group>
  );
}

// ─── Reducción ────────────────────────────────────────────────────────────────

function ReduccionPiece({ pz, placement, selected }: { pz: PiezaReduccion; placement: Placement; selected: boolean }) {
  const anchoMayorMm = pz.catalogo.ancho_mayor_nominal_mm;
  const anchoMenorMm = pz.catalogo.ancho_menor_nominal_mm;
  const alturaMm = pz.catalogo.altura_nominal_mm;
  const lengthMm = pz.cotas_derivadas_local.P1_a_P2_axial_X_local_mm;
  const lateralOffsetMm = pz.cotas_derivadas_local.lateral_offset_Y_local_mm;

  const halfP1 = anchoMayorMm / 2;
  const halfP2 = anchoMenorMm / 2;
  const alt = alturaMm;
  const lineColor = selected ? COLORS.pieceSel : COLORS.piece;

  // Dos largueros trapezoidales: izq va de (0,-halfP1) a (L, -halfP2 + offset);
  // der va de (0, +halfP1) a (L, +halfP2 + offset). Cada uno como rectángulo
  // deformado (quad) con alto=altura.
  const rail = (yA: number, yB: number) => {
    const a: Vec3 = [0, yA, 0];
    const b: Vec3 = [lengthMm, yB, 0];
    const c: Vec3 = [lengthMm, yB, alt];
    const d: Vec3 = [0, yA, alt];
    const pts: V3[] = [
      toViewer(a, placement),
      toViewer(b, placement),
      toViewer(c, placement),
      toViewer(d, placement),
      toViewer(a, placement),
    ];
    return <Line points={pts} color={lineColor} lineWidth={1.5} />;
  };

  return (
    <group>
      {rail(-halfP1, -halfP2 + lateralOffsetMm)}
      {rail(halfP1, halfP2 + lateralOffsetMm)}
      <DimLabel
        at={toViewer([lengthMm / 2, 0, alt + 100], placement)}
        text={`Reducción · L=${lengthMm.toFixed(0)} mm · ${anchoMayorMm}→${anchoMenorMm} mm (medido)`}
      />
    </group>
  );
}

// ─── T ────────────────────────────────────────────────────────────────────────

function TePiece({ pz, placement, selected }: { pz: PiezaTe; placement: Placement; selected: boolean }) {
  const alt = pz.catalogo.altura_nominal_mm;
  const lineColor = selected ? COLORS.pieceSel : COLORS.piece;

  // Envolvente a partir de los centros de las tres bocas (en local).
  const p1 = pz.bocas.P1.center_local as Vec3;
  const p2 = pz.bocas.P2.center_local as Vec3;
  const p3 = pz.bocas.P3.center_local as Vec3;

  // Recorrido centerline tronco y ramal.
  const tronco: V3[] = (pz.recorrido_central_local.tronco as readonly Vec3[]).map((p) =>
    toViewer(p, placement),
  );
  const ramal: V3[] = (pz.recorrido_central_local.ramal as readonly Vec3[]).map((p) =>
    toViewer(p, placement),
  );

  // Bounding box del envelope en local: tronco [0, dy_local], ramal se extiende en +Y hasta P3
  const xmin = Math.min(p1[0], p2[0]);
  const xmax = Math.max(p1[0], p2[0], p3[0]);
  const ymin = Math.min(p1[1], p2[1], 0);
  const ymax = Math.max(p1[1], p2[1], p3[1]);

  const boxEdges = (z: number) => {
    const c1: Vec3 = [xmin, ymin, z];
    const c2: Vec3 = [xmax, ymin, z];
    const c3: Vec3 = [xmax, ymax, z];
    const c4: Vec3 = [xmin, ymax, z];
    return [
      toViewer(c1, placement),
      toViewer(c2, placement),
      toViewer(c3, placement),
      toViewer(c4, placement),
      toViewer(c1, placement),
    ] as V3[];
  };
  const bottomEdges = boxEdges(0);
  const topEdges = boxEdges(alt);
  // Aristas verticales
  const vert = (x: number, y: number) =>
    [toViewer([x, y, 0], placement), toViewer([x, y, alt], placement)] as [V3, V3];

  return (
    <group>
      <Line points={bottomEdges} color={COLORS.envelope} lineWidth={1} />
      <Line points={topEdges} color={lineColor} lineWidth={1.5} />
      <Line points={vert(xmin, ymin)} color={COLORS.envelope} lineWidth={1} />
      <Line points={vert(xmax, ymin)} color={COLORS.envelope} lineWidth={1} />
      <Line points={vert(xmax, ymax)} color={COLORS.envelope} lineWidth={1} />
      <Line points={vert(xmin, ymax)} color={COLORS.envelope} lineWidth={1} />
      <Line points={tronco} color={COLORS.recorrido} lineWidth={2} />
      <Line points={ramal} color={COLORS.recorrido} lineWidth={2} />
      <DimLabel
        at={toViewer([(xmin + xmax) / 2, (ymin + ymax) / 2, alt + 100], placement)}
        text={`T · tronco=${pz.cotas_derivadas_local.P1_a_P2_tronco_mm.toFixed(0)} mm`}
      />
    </group>
  );
}

// ─── Curva (PROVISIONAL) ──────────────────────────────────────────────────────

function CurvaPiece({ pz, placement, selected }: { pz: PiezaCurva; placement: Placement; selected: boolean }) {
  const alt = pz.catalogo.altura_nominal_mm;
  const lineColor = selected ? COLORS.pieceSel : COLORS.provisional;

  const recorrido: V3[] = (pz.recorrido_central_local.puntos as readonly Vec3[]).map((p) =>
    toViewer(p, placement),
  );

  // Arco provisional outer e inner — reconstruidos a partir de centros/radios DXF.
  const R = pz.marco_local.R_3x3;
  const origen = pz.marco_local.origen_dxf as Vec2;
  const prov = pz.geometria_curva_provisional.parametros_configurables;

  const sampleArc = (centerDxf: Vec2, radius: number): V3[] => {
    // Centro en local
    const centerLocal = dxfToLocal(R, origen, centerDxf);
    // Ángulo de P1 y P2 vistos desde el centro, en local
    const p1 = pz.bocas.P1.center_local as Vec3;
    const p2 = pz.bocas.P2.center_local as Vec3;
    const a1 = Math.atan2(p1[1] - centerLocal[1], p1[0] - centerLocal[0]);
    const a2 = Math.atan2(p2[1] - centerLocal[1], p2[0] - centerLocal[0]);
    // Barre el ángulo más corto
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const N = 48;
    const pts: V3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = a1 + (da * i) / N;
      const x = centerLocal[0] + radius * Math.cos(a);
      const y = centerLocal[1] + radius * Math.sin(a);
      pts.push(toViewer([x, y, alt / 2], placement));
    }
    return pts;
  };

  const outerArc = sampleArc(prov.centro_outer_dxf as Vec2, prov.radio_outer_mm);
  const innerArc = sampleArc(prov.centro_inner_dxf as Vec2, prov.radio_inner_mm);

  // Muestras del contorno fuente del DXF: transforma a local vía (R, origen).
  const samples = pz.contorno_facetado_dxf_evidencia.segmentos_muestra_primeras_5;
  const contourSegments: Array<[V3, V3]> = samples.map((seg) => {
    const a = dxfToLocal(R, origen, seg[0]);
    const b = dxfToLocal(R, origen, seg[1]);
    return [toViewer([a[0], a[1], alt / 2], placement), toViewer([b[0], b[1], alt / 2], placement)];
  });

  // Marca el kink como esfera
  const kink = pz.recorrido_central_local.kink_local as Vec3;
  const kinkViewer = toViewer(kink, placement);

  const originLocal: Vec3 = [0, 0, 0];
  const originViewer = toViewer(originLocal, placement);

  return (
    <group>
      {/* Arcos provisionales outer / inner */}
      <Line points={outerArc} color={lineColor} lineWidth={2} dashed dashSize={0.15} gapSize={0.08} />
      <Line points={innerArc} color={lineColor} lineWidth={2} dashed dashSize={0.15} gapSize={0.08} />
      {/* Recorrido L-path (provisional) */}
      <Line points={recorrido} color={COLORS.recorridoProv} lineWidth={2} dashed dashSize={0.2} gapSize={0.1} />
      {/* Muestras del contorno fuente */}
      {contourSegments.map((seg, i) => (
        <Line key={i} points={seg as unknown as V3[]} color={COLORS.contour} lineWidth={1} />
      ))}
      {/* Marca del kink */}
      <mesh position={kinkViewer}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshBasicMaterial color={COLORS.provisional} />
      </mesh>
      <Html center distanceFactor={10} position={sumV(originViewer, [0, 0.5, 0])} style={{ pointerEvents: 'none' }}>
        <div className="pilot-provisional-chip">CURVA PROVISIONAL</div>
      </Html>
      <DimLabel
        at={sumV(originViewer, [0, 0.9, 0])}
        text={`Curva · radio declarado ${pz.catalogo.radio_declarado_mm} mm (${pz.catalogo.referencia_radio_declarada}) · ${pz.catalogo.angulo_declarado_deg}°`}
      />
      <DimLabel
        at={sumV(originViewer, [0, 0.72, 0])}
        text={`Residuo outer tight max ${pz.geometria_curva_provisional.residuo_vs_contorno_facetado.outer_tight_5mm.max_mm.toFixed(2)} mm`}
      />
    </group>
  );
}

// ─── Pieza individual ─────────────────────────────────────────────────────────

function PieceBocas({ pz, placement, pieceId, selectedBoca }: {
  pz: Pieza;
  placement: Placement;
  pieceId: PiezaId;
  selectedBoca: BocaKey | null;
}) {
  const bocas = pz.bocas as Record<string, { center_local: readonly number[]; normal_saliente_local: readonly number[] }>;
  const provisional = pieceId === 'curva_90';
  const keys = Object.keys(bocas) as BocaKey[];
  return (
    <>
      {keys.map((k) => {
        const b = bocas[k];
        const center = b.center_local as Vec3;
        const normal = b.normal_saliente_local as Vec3;
        const centerViewer = toViewer(center, placement);
        const normalViewer = toViewerDir(normal, placement);
        return (
          <BocaMarker
            key={k}
            centerViewer={centerViewer}
            normalViewer={normalViewer}
            pieceId={pieceId}
            bocaKey={k}
            isSelected={selectedBoca === k}
            provisional={provisional}
          />
        );
      })}
    </>
  );
}

function PieceRenderer({ pieceId }: { pieceId: PiezaId }) {
  const pz = getPilotData().piezas[pieceId];
  const placement = usePilotStore((s) => s.placements[pieceId]);
  const selection = usePilotStore((s) => s.selection);
  const isSelected = selection?.pieceId === pieceId;

  const originLocal: Vec3 = [0, 0, 0];
  const originViewer: V3 = useMemo(() => toViewer(originLocal, placement), [placement]);

  const selectPiece = usePilotStore((s) => s.selectPiece);
  const handleGroupClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectPiece(pieceId);
  };

  return (
    <group onClick={handleGroupClick}>
      <LocalAxes origin={originViewer} />
      {pieceId === 'recto' && (
        <RectoPiece pz={pz as PiezaRecto} placement={placement} selected={!!isSelected} />
      )}
      {pieceId === 'curva_90' && (
        <CurvaPiece pz={pz as PiezaCurva} placement={placement} selected={!!isSelected} />
      )}
      {pieceId === 'te' && <TePiece pz={pz as PiezaTe} placement={placement} selected={!!isSelected} />}
      {pieceId === 'reduccion' && (
        <ReduccionPiece pz={pz as PiezaReduccion} placement={placement} selected={!!isSelected} />
      )}
      <PieceBocas
        pz={pz}
        placement={placement}
        pieceId={pieceId}
        selectedBoca={isSelected ? selection?.boca ?? null : null}
      />
    </group>
  );
}

// ─── Escena completa ──────────────────────────────────────────────────────────

export function PilotSceneObjects() {
  const pieces: PiezaId[] = ['recto', 'curva_90', 'te', 'reduccion'];
  return (
    <>
      {pieces.map((id) => (
        <Fragment key={id}>
          <PieceRenderer pieceId={id} />
        </Fragment>
      ))}
    </>
  );
}

/** Exportado para tests — construye coordenadas visor sin tocar Three.js. */
export const __testing = { dxfToLocal, toViewer, toViewerDir };
/** Exportado para evitar warning de import no usado en entornos sin layout. */
export { INITIAL_LAYOUT_MM };
