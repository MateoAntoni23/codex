/**
 * PilotInspector — panel derecho: procedencia, cotas y controles de prueba.
 *
 * Muestra:
 *   - Catálogo (nominal) y cotas medidas derivadas del marco local.
 *   - Procedencia por campo: MEDIDO / NOMINAL (instalación) / PROVISIONAL.
 *   - Validaciones V1..V6.
 *   - Botones para girar 90° y trasladar 100 mm en cada eje.
 *
 * El inspector no muestra la curva como un radio verificado: su SKU indica el
 * radio declarado del fabricante y el estado dice PROVISIONAL.
 */

import { getPilotData } from './pilotAdapter';
import { usePilotStore } from './usePilotStore';
import type { Pieza, PiezaCurva, PiezaId, PiezaRecto, PiezaReduccion, PiezaTe } from './types';

const LABEL: Record<PiezaId, string> = {
  recto: 'Recto escalera',
  curva_90: 'Curva 90°',
  te: 'T',
  reduccion: 'Reducción',
};

function mm(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)} mm`;
}

function badge(proc: 'medido' | 'nominal_instalacion' | 'provisional') {
  const c = proc === 'medido' ? 'med' : proc === 'provisional' ? 'prov' : 'nom';
  const t = proc === 'medido' ? 'MEDIDO' : proc === 'provisional' ? 'PROVISIONAL' : 'NOMINAL';
  return <span className={`pilot-badge pilot-badge--${c}`}>{t}</span>;
}

function RectoDetails({ p }: { p: PiezaRecto }) {
  return (
    <div className="pilot-ins-section">
      <h4>Cotas derivadas (mm, local)</h4>
      <dl className="pilot-dl">
        <dt>Ancho nominal {badge('nominal_instalacion')}</dt>
        <dd>{mm(p.catalogo.ancho_nominal_mm, 0)}</dd>
        <dt>Altura perfil {badge('nominal_instalacion')}</dt>
        <dd>{mm(p.catalogo.altura_nominal_mm, 0)}</dd>
        <dt>Longitud comercial {badge('nominal_instalacion')}</dt>
        <dd>{mm(p.catalogo.longitud_comercial_mm, 0)}</dd>
        <dt>Longitud P1→P2 (axial X_local) {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.P1_a_P2_axial_X_local_mm)}</dd>
        <dt>Offset lateral Y_local (plegado Z) {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.lateral_offset_Y_local_mm)}</dd>
        <dt>Ancho P1 / P2 {badge('medido')}</dt>
        <dd>{mm(p.bocas.P1.ancho_medido_mm ?? NaN)} / {mm(p.bocas.P2.ancho_medido_mm ?? NaN)}</dd>
      </dl>
      <p className="pilot-note">
        La representación dibuja largueros + travesaños sin fondo. El desplazamiento
        lateral {mm(p.normalizacion_geometrica.desplazamiento_lateral_mm)} entre P1
        y P2 se conserva (tolerancia de plegado {mm(p.normalizacion_geometrica.tolerancia_plegado_mm, 0)}).
      </p>
    </div>
  );
}

function ReduccionDetails({ p }: { p: PiezaReduccion }) {
  return (
    <div className="pilot-ins-section">
      <h4>Cotas derivadas (mm, local)</h4>
      <dl className="pilot-dl">
        <dt>Ancho mayor / menor nominal {badge('nominal_instalacion')}</dt>
        <dd>{mm(p.catalogo.ancho_mayor_nominal_mm, 0)} → {mm(p.catalogo.ancho_menor_nominal_mm, 0)}</dd>
        <dt>Ancho medido P1 / P2 {badge('medido')}</dt>
        <dd>{mm(p.bocas.P1.ancho_medido_mm ?? NaN)} → {mm(p.bocas.P2.ancho_medido_mm ?? NaN)}</dd>
        <dt>Longitud P1→P2 (axial X_local) {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.P1_a_P2_axial_X_local_mm)}</dd>
        <dt>Transición total de ancho {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.transicion_ancho_mm)}</dd>
      </dl>
    </div>
  );
}

function TeDetails({ p }: { p: PiezaTe }) {
  return (
    <div className="pilot-ins-section">
      <h4>Cotas derivadas (mm, local)</h4>
      <dl className="pilot-dl">
        <dt>Ancho / altura perfil {badge('nominal_instalacion')}</dt>
        <dd>{mm(p.catalogo.ancho_nominal_mm, 0)} / {mm(p.catalogo.altura_nominal_mm, 0)}</dd>
        <dt>Tronco P1→P2 {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.P1_a_P2_tronco_mm)}</dd>
        <dt>Cruce→P1 / P2 / P3 (ramal) {badge('medido')}</dt>
        <dd>
          {mm(p.cotas_derivadas_local.cruce_a_P1_mm)} / {mm(p.cotas_derivadas_local.cruce_a_P2_mm)} /{' '}
          {mm(p.cotas_derivadas_local.cruce_a_P3_mm)}
        </dd>
        <dt>Asimetría tronco {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.asimetria_tronco_mm)}</dd>
      </dl>
    </div>
  );
}

function CurvaDetails({ p }: { p: PiezaCurva }) {
  const resT = p.geometria_curva_provisional.residuo_vs_contorno_facetado;
  return (
    <div className="pilot-ins-section">
      <h4>Cotas y procedencia</h4>
      <dl className="pilot-dl">
        <dt>Ancho / altura / radio declarado {badge('nominal_instalacion')}</dt>
        <dd>
          {mm(p.catalogo.ancho_nominal_mm, 0)} / {mm(p.catalogo.altura_nominal_mm, 0)} /{' '}
          {mm(p.catalogo.radio_declarado_mm, 0)} ({p.catalogo.referencia_radio_declarada})
        </dd>
        <dt>Ancho medido P1 / P2 {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.ancho_boca_outer_outer_P1_mm)} /{' '}
          {mm(p.cotas_derivadas_local.ancho_boca_outer_outer_P2_mm)}</dd>
        <dt>Distancia P1↔P2 en local {badge('medido')}</dt>
        <dd>{mm(p.cotas_derivadas_local.distancia_entre_centros_P1_P2_local_mm)}</dd>
        <dt>Inclinación bocas vs. perpendicular {badge('medido')}</dt>
        <dd>
          {p.cotas_derivadas_local.inclinacion_P1_vs_perpendicular_eje_deg.toFixed(2)}° /{' '}
          {p.cotas_derivadas_local.inclinacion_P2_vs_perpendicular_eje_deg.toFixed(2)}°
        </dd>
        <dt>Radio outer / inner (hipótesis) {badge('provisional')}</dt>
        <dd>
          {mm(p.geometria_curva_provisional.parametros_configurables.radio_outer_mm, 1)} /{' '}
          {mm(p.geometria_curva_provisional.parametros_configurables.radio_inner_mm, 1)}
        </dd>
      </dl>
      <div className="pilot-provisional-box">
        <strong>CURVA PROVISIONAL.</strong> Los arcos y el recorrido en L no deben usarse
        como metraje verificado. Residuo vs. contorno facetado (tight 5 mm): outer máx{' '}
        {mm(resT.outer_tight_5mm.max_mm, 2)} (n={resT.outer_tight_5mm.n_points}),
        inner máx {mm(resT.inner_tight_5mm.max_mm, 2)} (n={resT.inner_tight_5mm.n_points}).
        El contorno fuente se superpone en gris claro para comparación.
      </div>
    </div>
  );
}

function PieceDetails({ pieza }: { pieza: Pieza }) {
  if (pieza.tipo === 'recto') return <RectoDetails p={pieza} />;
  if (pieza.tipo === 'reduccion') return <ReduccionDetails p={pieza} />;
  if (pieza.tipo === 'te') return <TeDetails p={pieza} />;
  return <CurvaDetails p={pieza} />;
}

function BocaDetails({ pieza, bocaKey }: { pieza: Pieza; bocaKey: 'P1' | 'P2' | 'P3' }) {
  const bocas = pieza.bocas as Record<string, { center_local: readonly number[]; normal_saliente_local: readonly number[]; ancho_medido_mm?: number; ancho_outer_outer_mm?: number; nombre_catalogo?: string }>;
  const b = bocas[bocaKey];
  if (!b) return null;
  return (
    <div className="pilot-ins-section">
      <h4>Boca {bocaKey}{b.nombre_catalogo ? ` — ${b.nombre_catalogo}` : ''}</h4>
      <dl className="pilot-dl">
        <dt>Centro local (mm)</dt>
        <dd>({b.center_local.map((x) => x.toFixed(2)).join(', ')})</dd>
        <dt>Normal saliente local</dt>
        <dd>({b.normal_saliente_local.map((x) => x.toFixed(4)).join(', ')})</dd>
        {b.ancho_medido_mm != null && (
          <>
            <dt>Ancho medido</dt>
            <dd>{mm(b.ancho_medido_mm)}</dd>
          </>
        )}
        {b.ancho_outer_outer_mm != null && (
          <>
            <dt>Ancho outer-outer</dt>
            <dd>{mm(b.ancho_outer_outer_mm)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function PilotInspector() {
  const data = getPilotData();
  const selection = usePilotStore((s) => s.selection);
  const placement = usePilotStore((s) =>
    selection ? s.placements[selection.pieceId] : null,
  );
  const rotateStep = usePilotStore((s) => s.rotateStep);
  const translate = usePilotStore((s) => s.translate);
  const reset = usePilotStore((s) => s.resetPlacement);

  if (!selection) {
    return (
      <aside className="panel panel-right pilot-inspector">
        <div className="pilot-empty">Seleccioná una pieza en la lista o una boca en la escena.</div>
      </aside>
    );
  }

  const pieza = data.piezas[selection.pieceId];
  const yawDeg = placement ? Math.round((placement.yawRad * 180) / Math.PI) % 360 : 0;

  return (
    <aside className="panel panel-right pilot-inspector">
      <header className="pilot-ins-header">
        <div className="pilot-ins-title">{LABEL[selection.pieceId]}</div>
        <div className="pilot-ins-sku">{pieza.producto_id}</div>
        <div className="pilot-ins-state">{pieza.estado}</div>
      </header>

      <PieceDetails pieza={pieza} />

      {selection.boca && (
        <BocaDetails pieza={pieza} bocaKey={selection.boca} />
      )}

      <div className="pilot-ins-section">
        <h4>Controles de prueba</h4>
        <div className="pilot-controls">
          <button type="button" className="btn-secondary" onClick={() => rotateStep(selection.pieceId)}>
            Girar +90° (actual: {yawDeg}°)
          </button>
          <div className="pilot-controls-row">
            <button type="button" className="btn-secondary" onClick={() => translate(selection.pieceId, [100, 0, 0])}>
              +X 100
            </button>
            <button type="button" className="btn-secondary" onClick={() => translate(selection.pieceId, [-100, 0, 0])}>
              −X 100
            </button>
            <button type="button" className="btn-secondary" onClick={() => translate(selection.pieceId, [0, 100, 0])}>
              +Y 100
            </button>
            <button type="button" className="btn-secondary" onClick={() => translate(selection.pieceId, [0, -100, 0])}>
              −Y 100
            </button>
          </div>
          <button type="button" className="btn-secondary" onClick={() => reset(selection.pieceId)}>
            Restablecer posición
          </button>
        </div>
        <p className="pilot-note">
          Los puertos y el recorrido acompañan a la pieza: cada boca se recalcula desde el
          centro y la normal local al aplicar el giro/traslación.
        </p>
      </div>
    </aside>
  );
}
