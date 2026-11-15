/**
 * Recorrido del circuito seleccionado, resaltado en la escena (etapa 4): una línea que
 * sigue el recorrido guardado —bajada de origen, las bocas de cada pieza cruzada en orden,
 * bajada de destino— dibujada por encima de las bandejas. No toca el color de relleno de
 * ninguna pieza (el color de las piezas dice su tipo): es un trazo aparte.
 */
import { Line } from '@react-three/drei';
import type { TrayInput } from '../tray/model';
import { circuitosOf } from '../workspace/recorridos/circuitosGuardados';
import { bajadasOf } from '../workspace/equipos/bajada';
import { useUiStore } from '../workspace/stages/uiStore';

type V3 = [number, number, number];
const toViewer = (mm: readonly number[]): V3 => [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
export const COLOR_RECORRIDO = '#38d6ff';

/** Puntos (mm) del recorrido guardado de un circuito, en orden. */
export function puntosDelRecorrido(entrada: TrayInput, id: string): V3[] | null {
  const c = circuitosOf(entrada).find((x) => x.id === id);
  if (!c) return null;
  const bajadas = bajadasOf(entrada);
  const bo = bajadas.find((b) => b.id === c.bajadas.origen.id);
  const bd = bajadas.find((b) => b.id === c.bajadas.destino.id);
  const pts: V3[] = [];
  const push = (p: readonly number[] | undefined) => {
    if (!p) return;
    const q = [p[0], p[1], p[2]] as V3;
    const u = pts[pts.length - 1];
    if (!u || Math.hypot(u[0] - q[0], u[1] - q[1], u[2] - q[2]) > 1e-6) pts.push(q);
  };
  if (bo) { push(bo.punto_equipo_mm); push(bo.punto_salida_mm); }
  for (const cr of c.cruces) { push(cr.bocas[cr.entrada]?.posicion_mm); push(cr.bocas[cr.salida]?.posicion_mm); }
  if (bd) { push(bd.punto_salida_mm); push(bd.punto_equipo_mm); }
  return pts;
}

export function RecorridoResaltado({ entrada }: { entrada: TrayInput }) {
  const id = useUiStore((s) => s.circuitoResaltado);
  if (!id) return null;
  const c = circuitosOf(entrada).find((x) => x.id === id);
  const pts = puntosDelRecorrido(entrada, id);
  if (!c || !pts || pts.length < 2) return null;
  return (
    <group
      name="recorrido-resaltado"
      onUpdate={(g) => { g.userData.codex = { kind: 'recorrido-resaltado', circuito: id, piezas: c.cruces.map((x) => x.pieza), puntosMm: pts }; }}
    >
      <Line points={pts.map(toViewer)} color={COLOR_RECORRIDO} lineWidth={6} depthTest={false} renderOrder={10} transparent opacity={0.95} />
    </group>
  );
}
