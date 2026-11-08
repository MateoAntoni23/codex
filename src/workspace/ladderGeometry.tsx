/**
 * ladderGeometry — representación de "escalera Z" (SAM-STE-Z) en la escena R3F.
 *
 * Detecta SKUs de la familia escalera (SAM-STE-Z / prefijos TRES, TS, CS) y
 * renderiza largueros + travesaños a partir de los puertos almacenados y las
 * medidas del catálogo (ala, ancho, espesor, radio, ángulo).
 *
 * Convenciones:
 *   - Dominio mm Z-up, visor m Y-up: (x,y,z) → (x/1000, z/1000, -y/1000).
 *   - NO se mueven puertos. Centro de arco y ramal se derivan de P1/P2/P3.
 *   - Donde falte un dato de catálogo, se renderiza una malla conceptual
 *     explícita (wireframe + marca "pendiente") en lugar de inventar medidas.
 *   - Tag `userData.codex` en cada mesh/group para introspección e2e.
 *
 * No se mapean SKUs de escalera a recetas paramétricas de la perforada (STP-Z).
 */
import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Piece, Product } from '../tray/model';

type V3 = [number, number, number];

const DEFAULT_RUNG_PITCH_MM = 250;
const DEFAULT_RUNG_MARGIN_MM = 60;
const DEFAULT_RAIL_THICKNESS_MM = 1.24;
const DEFAULT_RUNG_THICKNESS_MM = 2;
const DEFAULT_RUNG_WIDTH_MM = 25;
const ARC_SAMPLES_PER_90 = 24;
const COLOR_RAIL = '#4f9bd1';
const COLOR_RUNG = '#9fc6e6';
const COLOR_SEL = '#ffcf33';
const COLOR_PENDING = '#ff9955';

// ─── Marco de pieza y utilidades geométricas ─────────────────────────────────

function toViewer(mm: V3): V3 {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: V3, k: number): V3 { return [a[0] * k, a[1] * k, a[2] * k]; }
function len(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }
function norm(a: V3): V3 { const L = len(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Perpendicular horizontal (plano XY, mm Z-up) a un vector unitario. */
function perpXY(dir: V3): V3 {
  // Rotar 90° en el plano XY alrededor de Z: (x,y,z)→(-y,x,z). Devuelve el que esté más pegado al plano horizontal.
  const flat: V3 = [-dir[1], dir[0], 0];
  const L = len(flat);
  if (L < 1e-6) {
    // Dirección puramente vertical: elegir eje X como lateral.
    return [1, 0, 0];
  }
  return [flat[0] / L, flat[1] / L, 0];
}

// ─── Detección de familia escalera ───────────────────────────────────────────

export function isLadderFamily(product: Product | undefined): boolean {
  if (!product) return false;
  const fam = (product as Record<string, unknown>).familia_id;
  if (typeof fam === 'string' && /^SAM-STE/i.test(fam)) return true;
  const idSources = [product.producto_id, product.sku].filter(Boolean) as string[];
  return idSources.some((s) => /^(SAM_)?(TRES|TS|CS)-/i.test(s));
}

function getProductDim(product: Product, key: string): number | null {
  const v = (product as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// ─── Primitivas de render ────────────────────────────────────────────────────

/** Caja orientada entre dos puntos mm (Z-up). Sección sectY_mm × sectZ_mm. */
function OrientedBox({
  aMm, bMm, sectYMm, sectZMm, color, selected, codex, onClick, offsetZMm,
}: {
  aMm: V3; bMm: V3; sectYMm: number; sectZMm: number;
  color: string; selected: boolean;
  codex: Record<string, unknown>;
  onClick?: () => void;
  offsetZMm?: number;
}) {
  const quat = useMemo(() => {
    const dirMm = sub(bMm, aMm);
    const vec = new THREE.Vector3(dirMm[0], dirMm[2], -dirMm[1]).normalize();
    if (vec.lengthSq() < 1e-8) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vec);
  }, [aMm[0], aMm[1], aMm[2], bMm[0], bMm[1], bMm[2]]);

  const centerMm: V3 = [
    (aMm[0] + bMm[0]) / 2,
    (aMm[1] + bMm[1]) / 2,
    (aMm[2] + bMm[2]) / 2 + (offsetZMm ?? 0),
  ];
  const lenMm = len(sub(bMm, aMm));
  const lx = lenMm / 1000;
  const ly = sectZMm / 1000; // en viewer, Y_viewer = Z_mm (altura vertical)
  const lz = sectYMm / 1000; // en viewer, Z_viewer = -Y_mm (ancho transversal al eje)

  return (
    <mesh
      position={toViewer(centerMm)}
      quaternion={quat}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onUpdate={(m) => { m.userData.codex = codex; }}
    >
      <boxGeometry args={[lx, ly, lz]} />
      <meshStandardMaterial color={selected ? COLOR_SEL : color} transparent opacity={0.85} />
    </mesh>
  );
}

/** Cadena de cajas a lo largo de una polilínea mm. Usado para rails curvos. */
function PolylineRails({
  samples, sectYMm, sectZMm, color, selected, codex,
}: {
  samples: V3[]; sectYMm: number; sectZMm: number;
  color: string; selected: boolean; codex: Record<string, unknown>;
}) {
  if (samples.length < 2) return null;
  const segments: JSX.Element[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    segments.push(
      <OrientedBox
        key={i}
        aMm={samples[i]}
        bMm={samples[i + 1]}
        sectYMm={sectYMm}
        sectZMm={sectZMm}
        color={color}
        selected={selected}
        codex={{ ...codex, segment: i }}
      />,
    );
  }
  return <>{segments}</>;
}

// ─── Recto ───────────────────────────────────────────────────────────────────

function LadderStraight({
  piece, product, selected, onClick,
}: { piece: Piece; product: Product; selected: boolean; onClick: () => void }) {
  const p1 = piece.puertos.P1;
  const p2 = piece.puertos.P2;
  if (!p1 || !p2) return null;

  const P1 = p1.posicion_mm as V3;
  const P2 = p2.posicion_mm as V3;
  const axis = sub(P2, P1);
  const lenMm = len(axis);
  if (lenMm < 1e-6) return null;
  const dir = norm(axis);

  const anchoMm = getProductDim(product, 'ancho_nominal_mm');
  const alaMm = getProductDim(product, 'ala_nominal_mm');
  const espMm = getProductDim(product, 'espesor_chapa_mm') ?? DEFAULT_RAIL_THICKNESS_MM;

  // Si falta alguna medida crítica → representación conceptual.
  if (anchoMm == null || alaMm == null) {
    return (
      <ConceptualMissing
        piece={piece} product={product}
        portsMm={[P1, P2]}
        reason="dimensiones de ala o ancho ausentes en catálogo"
      />
    );
  }

  const lateral = perpXY(dir);
  const halfW = anchoMm / 2;
  const railOffset = scale(lateral, halfW);
  const railLeftA = sub(P1, railOffset);
  const railLeftB = sub(P2, railOffset);
  const railRightA = add(P1, railOffset);
  const railRightB = add(P2, railOffset);

  // Travesaños cada ~pitch, con margen.
  const nInterior = Math.max(0, Math.floor((lenMm - 2 * DEFAULT_RUNG_MARGIN_MM) / DEFAULT_RUNG_PITCH_MM));
  const positions: number[] = [];
  const spanUsable = lenMm - 2 * DEFAULT_RUNG_MARGIN_MM;
  positions.push(DEFAULT_RUNG_MARGIN_MM);
  if (nInterior > 0) {
    const step = spanUsable / nInterior;
    for (let i = 1; i < nInterior; i++) positions.push(DEFAULT_RUNG_MARGIN_MM + i * step);
  }
  positions.push(lenMm - DEFAULT_RUNG_MARGIN_MM);

  const codexBase = {
    instanciaId: piece.instancia_id,
    sku: product.sku ?? product.producto_id,
    kind: 'ladder-straight',
    widthMm: anchoMm, alaMm, espMm,
    lenMm,
    ports: { P1, P2 } as Record<string, V3>,
  };

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onUpdate={(g) => { g.userData.codex = codexBase; }}
    >
      {/* Larguero izquierdo */}
      <OrientedBox
        aMm={railLeftA} bMm={railLeftB}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'rail-left' }}
      />
      {/* Larguero derecho */}
      <OrientedBox
        aMm={railRightA} bMm={railRightB}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'rail-right' }}
      />
      {/* Travesaños — barras planas a altura media del perfil */}
      {positions.map((t, i) => {
        const centerOnAxis = add(P1, scale(dir, t));
        const rungA = sub(centerOnAxis, railOffset);
        const rungB = add(centerOnAxis, railOffset);
        const offsetZ = -alaMm / 2 + DEFAULT_RUNG_THICKNESS_MM / 2;
        return (
          <OrientedBox
            key={`rung-${i}`}
            aMm={rungA} bMm={rungB}
            sectYMm={DEFAULT_RUNG_WIDTH_MM}
            sectZMm={DEFAULT_RUNG_THICKNESS_MM}
            color={COLOR_RUNG} selected={selected}
            codex={{ ...codexBase, part: `rung-${i}` }}
            offsetZMm={offsetZ}
          />
        );
      })}
    </group>
  );
}

// ─── Curva horizontal ────────────────────────────────────────────────────────

/**
 * Calcula el centro del arco horizontal a partir de P1, P2 y las direcciones
 * de los puertos. Asume el arco plano (misma Z) y que las direcciones de los
 * puertos son tangentes salientes de la pieza.
 */
function computeArcCenter(P1: V3, P2: V3, dir1Out: V3, dir2Out: V3): {
  center: V3; radius: number; chirality: 1 | -1; thetaStart: number; thetaEnd: number;
} | null {
  // Vectores de entrada hacia la pieza: -dir1Out en P1; vector saliente de P2: +dir2Out.
  // Perpendiculares (en XY) a cada tangente: la línea del centro es perpendicular a
  // la tangente en cada extremo del arco.
  const tan1: V3 = norm([-dir1Out[0], -dir1Out[1], 0]);
  const tan2: V3 = norm([dir2Out[0], dir2Out[1], 0]);
  // Dos candidatos normales ortogonales a tan1: rotar ±90° en XY.
  const n1a: V3 = [-tan1[1], tan1[0], 0];
  const n1b: V3 = [tan1[1], -tan1[0], 0];
  // Centro = P1 + r·n1  satisface (center - P2)·tan2 = 0 y ||center - P2|| = r.
  // Para cada candidato n1, resuelvo r: ((P1 - P2) + r·n1) · tan2 = 0 → r = (P2 - P1)·tan2 / (n1·tan2)
  const dP = sub(P2, P1);
  const candidates = [n1a, n1b].map((n1) => {
    const denom = dot(n1, tan2);
    if (Math.abs(denom) < 1e-9) return null;
    const r = dot(dP, tan2) / denom;
    if (r <= 0) return null;
    const center = add(P1, scale(n1, r));
    const r2 = len(sub(center, P2));
    if (Math.abs(r2 - r) > Math.max(1, r * 1e-3)) return null;
    return { center, radius: r, n1 };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (candidates.length === 0) return null;
  const c = candidates[0];
  const u1 = sub(P1, c.center);
  const u2 = sub(P2, c.center);
  const thetaStart = Math.atan2(u1[1], u1[0]);
  const thetaEnd = Math.atan2(u2[1], u2[0]);
  // Determinar quiralidad por signo del cruce con la tangente en P1.
  const crossZ = u1[0] * tan1[1] - u1[1] * tan1[0];
  const chirality: 1 | -1 = crossZ > 0 ? 1 : -1;
  return { center: c.center, radius: c.radius, chirality, thetaStart, thetaEnd };
}

function sweepTheta(start: number, end: number, chirality: 1 | -1): { start: number; end: number } {
  // Normaliza el barrido para ir de `start` a `end` en el sentido dado por chirality.
  const twoPi = 2 * Math.PI;
  let d = end - start;
  if (chirality > 0) {
    while (d < 0) d += twoPi;
    while (d > twoPi) d -= twoPi;
  } else {
    while (d > 0) d -= twoPi;
    while (d < -twoPi) d += twoPi;
  }
  return { start, end: start + d };
}

function LadderCurve({
  piece, product, selected, onClick,
}: { piece: Piece; product: Product; selected: boolean; onClick: () => void }) {
  const p1 = piece.puertos.P1;
  const p2 = piece.puertos.P2;
  if (!p1 || !p2) return null;

  const P1 = p1.posicion_mm as V3;
  const P2 = p2.posicion_mm as V3;
  const d1 = p1.direccion as V3;
  const d2 = p2.direccion as V3;

  const anchoMm = getProductDim(product, 'ancho_nominal_mm');
  const alaMm = getProductDim(product, 'ala_nominal_mm');
  const espMm = getProductDim(product, 'espesor_chapa_mm') ?? DEFAULT_RAIL_THICKNESS_MM;

  const arc = useMemo(() => computeArcCenter(P1, P2, d1, d2), [
    P1[0], P1[1], P1[2], P2[0], P2[1], P2[2],
    d1[0], d1[1], d1[2], d2[0], d2[1], d2[2],
  ]);

  if (anchoMm == null || alaMm == null || !arc) {
    return (
      <ConceptualMissing
        piece={piece} product={product}
        portsMm={[P1, P2]}
        reason={arc ? 'ala o ancho ausentes en catálogo' : 'no se pudo derivar el centro del arco desde los puertos almacenados'}
      />
    );
  }

  const { center, radius, chirality } = arc;
  const { start: tStart, end: tEnd } = sweepTheta(arc.thetaStart, arc.thetaEnd, chirality);
  const angularSpan = Math.abs(tEnd - tStart);
  const nSamples = Math.max(12, Math.ceil(ARC_SAMPLES_PER_90 * (angularSpan / (Math.PI / 2))));
  const z = (P1[2] + P2[2]) / 2;

  const buildArc = (r: number): V3[] => {
    const pts: V3[] = [];
    for (let i = 0; i <= nSamples; i++) {
      const t = tStart + ((tEnd - tStart) * i) / nSamples;
      pts.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t), z]);
    }
    return pts;
  };
  const innerR = radius - anchoMm / 2;
  const outerR = radius + anchoMm / 2;
  const innerArc = buildArc(innerR);
  const outerArc = buildArc(outerR);

  const codexBase = {
    instanciaId: piece.instancia_id,
    sku: product.sku ?? product.producto_id,
    kind: 'ladder-curve',
    widthMm: anchoMm, alaMm, espMm, radiusMm: radius, chirality,
    arcCenterMm: center, radiansSwept: angularSpan,
    ports: { P1, P2 } as Record<string, V3>,
  };

  // Travesaños radiales uniformemente a lo largo del arco centerline.
  const arcLenMm = radius * angularSpan;
  const nInterior = Math.max(0, Math.floor((arcLenMm - 2 * DEFAULT_RUNG_MARGIN_MM) / DEFAULT_RUNG_PITCH_MM));
  const totalRungs = nInterior + 2;
  const rungs: JSX.Element[] = [];
  for (let i = 0; i < totalRungs; i++) {
    const f = totalRungs > 1 ? i / (totalRungs - 1) : 0.5;
    const t = tStart + (tEnd - tStart) * f;
    const inner: V3 = [center[0] + innerR * Math.cos(t), center[1] + innerR * Math.sin(t), z];
    const outer: V3 = [center[0] + outerR * Math.cos(t), center[1] + outerR * Math.sin(t), z];
    const offsetZ = -alaMm / 2 + DEFAULT_RUNG_THICKNESS_MM / 2;
    rungs.push(
      <OrientedBox
        key={`rung-${i}`}
        aMm={inner} bMm={outer}
        sectYMm={DEFAULT_RUNG_WIDTH_MM}
        sectZMm={DEFAULT_RUNG_THICKNESS_MM}
        color={COLOR_RUNG}
        selected={selected}
        codex={{ ...codexBase, part: `rung-${i}` }}
        offsetZMm={offsetZ}
      />,
    );
  }

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onUpdate={(g) => { g.userData.codex = codexBase; }}
    >
      <PolylineRails
        samples={innerArc}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'rail-inner' }}
      />
      <PolylineRails
        samples={outerArc}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'rail-outer' }}
      />
      {rungs}
    </group>
  );
}

// ─── Tee ─────────────────────────────────────────────────────────────────────

function LadderTee({
  piece, product, selected, onClick,
}: { piece: Piece; product: Product; selected: boolean; onClick: () => void }) {
  const p1 = piece.puertos.P1;
  const p2 = piece.puertos.P2;
  const p3 = piece.puertos.P3;
  if (!p1 || !p2 || !p3) {
    return (
      <ConceptualMissing
        piece={piece} product={product}
        portsMm={Object.values(piece.puertos).map((p) => p.posicion_mm as V3)}
        reason="Tee incompleta — se esperan tres puertos (P1, P2, P3)"
      />
    );
  }

  const P1 = p1.posicion_mm as V3;
  const P2 = p2.posicion_mm as V3;
  const P3 = p3.posicion_mm as V3;

  const anchoMm = getProductDim(product, 'ancho_nominal_mm');
  const alaMm = getProductDim(product, 'ala_nominal_mm');
  const espMm = getProductDim(product, 'espesor_chapa_mm') ?? DEFAULT_RAIL_THICKNESS_MM;

  if (anchoMm == null || alaMm == null) {
    return (
      <ConceptualMissing
        piece={piece} product={product}
        portsMm={[P1, P2, P3]}
        reason="ala o ancho ausentes en catálogo"
      />
    );
  }

  const troncoAxis = sub(P2, P1);
  const troncoLen = len(troncoAxis);
  if (troncoLen < 1e-6) {
    return (
      <ConceptualMissing
        piece={piece} product={product}
        portsMm={[P1, P2, P3]}
        reason="P1 y P2 del tronco coinciden"
      />
    );
  }
  const troncoDir = norm(troncoAxis);
  const troncoLat = perpXY(troncoDir);
  const halfW = anchoMm / 2;
  const railOffset = scale(troncoLat, halfW);

  // Rama: dirección saliente desde P3 — invertimos para apuntar hacia el tronco.
  const ramalDirOut = norm(p3.direccion as V3);
  const ramalDirIn: V3 = [-ramalDirOut[0], -ramalDirOut[1], -ramalDirOut[2]];
  // Punto donde el eje del ramal cruza el eje del tronco:
  const toP3 = sub(P3, P1);
  const tTronco = dot(toP3, troncoDir);
  const tronco_cross: V3 = add(P1, scale(troncoDir, tTronco));
  const ramalLen = len(sub(P3, tronco_cross));

  // Extremos de los largueros del tronco (continuos de P1 a P2).
  const troncoLeftA = sub(P1, railOffset);
  const troncoLeftB = sub(P2, railOffset);
  const troncoRightA = add(P1, railOffset);
  const troncoRightB = add(P2, railOffset);

  // El lado del tronco por donde sale el ramal.
  const branchSideSign = dot(sub(P3, tronco_cross), troncoLat) >= 0 ? 1 : -1;

  // Largueros del ramal: desde P3 hasta la altura del borde interior del tronco.
  const ramalLat = perpXY(ramalDirIn);
  const ramalHalf = anchoMm / 2;
  const ramalOffset = scale(ramalLat, ramalHalf);
  const ramalP3Left = sub(P3, ramalOffset);
  const ramalP3Right = add(P3, ramalOffset);
  // Llegan al borde del tronco (desplazado halfW desde el eje).
  const ramalLenEff = Math.max(0, ramalLen - halfW);
  const alongRamal = scale(ramalDirIn, ramalLenEff);
  const ramalEndLeft = add(ramalP3Left, alongRamal);
  const ramalEndRight = add(ramalP3Right, alongRamal);

  const codexBase = {
    instanciaId: piece.instancia_id,
    sku: product.sku ?? product.producto_id,
    kind: 'ladder-tee',
    widthMm: anchoMm, alaMm, espMm,
    troncoLenMm: troncoLen, ramalLenMm: ramalLen,
    branchSideSign,
    ports: { P1, P2, P3 } as Record<string, V3>,
  };

  // Travesaños del tronco (saltando la abertura de la rama).
  const branchHalfSpanMm = anchoMm / 2;
  const nTronco = Math.max(0, Math.floor((troncoLen - 2 * DEFAULT_RUNG_MARGIN_MM) / DEFAULT_RUNG_PITCH_MM));
  const troncoRungs: JSX.Element[] = [];
  for (let i = 0; i <= nTronco; i++) {
    const t = DEFAULT_RUNG_MARGIN_MM + ((troncoLen - 2 * DEFAULT_RUNG_MARGIN_MM) * (nTronco === 0 ? 0.5 : i / nTronco));
    // Saltar si cae dentro de la abertura de la rama.
    if (Math.abs(t - tTronco) < branchHalfSpanMm) continue;
    const centerOnAxis = add(P1, scale(troncoDir, t));
    const rungA = sub(centerOnAxis, railOffset);
    const rungB = add(centerOnAxis, railOffset);
    const offsetZ = -alaMm / 2 + DEFAULT_RUNG_THICKNESS_MM / 2;
    troncoRungs.push(
      <OrientedBox
        key={`tronco-rung-${i}`}
        aMm={rungA} bMm={rungB}
        sectYMm={DEFAULT_RUNG_WIDTH_MM}
        sectZMm={DEFAULT_RUNG_THICKNESS_MM}
        color={COLOR_RUNG}
        selected={selected}
        codex={{ ...codexBase, part: `tronco-rung-${i}` }}
        offsetZMm={offsetZ}
      />,
    );
  }

  // Travesaños del ramal.
  const ramalRungs: JSX.Element[] = [];
  if (ramalLenEff > DEFAULT_RUNG_MARGIN_MM) {
    const nRamal = Math.max(0, Math.floor((ramalLenEff - DEFAULT_RUNG_MARGIN_MM) / DEFAULT_RUNG_PITCH_MM));
    for (let i = 0; i <= nRamal; i++) {
      const f = nRamal === 0 ? 0.5 : i / nRamal;
      const t = DEFAULT_RUNG_MARGIN_MM / 2 + f * (ramalLenEff - DEFAULT_RUNG_MARGIN_MM);
      const centerOnAxis = add(P3, scale(ramalDirIn, t));
      const rungA = sub(centerOnAxis, ramalOffset);
      const rungB = add(centerOnAxis, ramalOffset);
      const offsetZ = -alaMm / 2 + DEFAULT_RUNG_THICKNESS_MM / 2;
      ramalRungs.push(
        <OrientedBox
          key={`ramal-rung-${i}`}
          aMm={rungA} bMm={rungB}
          sectYMm={DEFAULT_RUNG_WIDTH_MM}
          sectZMm={DEFAULT_RUNG_THICKNESS_MM}
          color={COLOR_RUNG}
          selected={selected}
          codex={{ ...codexBase, part: `ramal-rung-${i}` }}
          offsetZMm={offsetZ}
        />,
      );
    }
  }

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onUpdate={(g) => { g.userData.codex = codexBase; }}
    >
      {/* Tronco: ambos largueros son continuos de P1 a P2. El de sotavento se interrumpe en la rama (se representa como dos tramos). */}
      <OrientedBox
        aMm={troncoLeftA} bMm={troncoLeftB}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'tronco-rail-left' }}
      />
      <OrientedBox
        aMm={troncoRightA} bMm={troncoRightB}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'tronco-rail-right' }}
      />
      {/* Ramal: dos largueros desde el tronco hasta P3. */}
      <OrientedBox
        aMm={ramalP3Left} bMm={ramalEndLeft}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'ramal-rail-left' }}
      />
      <OrientedBox
        aMm={ramalP3Right} bMm={ramalEndRight}
        sectYMm={espMm} sectZMm={alaMm}
        color={COLOR_RAIL} selected={selected}
        codex={{ ...codexBase, part: 'ramal-rail-right' }}
      />
      {troncoRungs}
      {ramalRungs}
    </group>
  );
}

// ─── Representación conceptual cuando faltan datos ──────────────────────────

function ConceptualMissing({
  piece, product, portsMm, reason,
}: { piece: Piece; product: Product; portsMm: V3[]; reason: string }) {
  if (portsMm.length < 1) return null;
  const pts = portsMm.map((p) => toViewer(p));
  const center = pts[0];
  const codex = {
    instanciaId: piece.instancia_id,
    sku: product.sku ?? product.producto_id ?? null,
    kind: 'ladder-conceptual-missing',
    reason,
    portsMm,
  };
  // Dibuja polilínea entre todos los puertos + etiqueta explícita.
  const lines: JSX.Element[] = [];
  for (let i = 1; i < pts.length; i++) {
    lines.push(
      <Line
        key={i}
        points={[pts[0], pts[i]]}
        color={COLOR_PENDING}
        lineWidth={2}
        dashed
        dashSize={0.15}
        gapSize={0.08}
      />,
    );
  }
  return (
    <group onUpdate={(g) => { g.userData.codex = codex; }}>
      {lines}
      <Html position={center} style={{ pointerEvents: 'none' }}>
        <div style={{
          background: 'rgba(0,0,0,0.85)', color: COLOR_PENDING, fontSize: 10,
          padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
        }}>
          {piece.instancia_id} · pendiente · {reason}
        </div>
      </Html>
    </group>
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function LadderPiece({
  piece, product, selected, onClick,
}: { piece: Piece; product: Product; selected: boolean; onClick: () => void }) {
  const tipo = product.tipo_pieza;
  if (tipo === 'recta') return <LadderStraight piece={piece} product={product} selected={selected} onClick={onClick} />;
  if (tipo === 'T') return <LadderTee piece={piece} product={product} selected={selected} onClick={onClick} />;
  if (tipo === 'curva horizontal') return <LadderCurve piece={piece} product={product} selected={selected} onClick={onClick} />;
  // Tipos no soportados aún (curva vertical escalera, cruz, etc.) → representación conceptual.
  return (
    <ConceptualMissing
      piece={piece} product={product}
      portsMm={Object.values(piece.puertos).map((p) => p.posicion_mm as V3)}
      reason={`tipo_pieza "${tipo}" aún no implementado en el generador de escalera`}
    />
  );
}
