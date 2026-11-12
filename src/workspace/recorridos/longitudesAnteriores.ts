/**
 * Acción explícita para proyectos guardados antes de que las piezas guardaran su
 * longitud de eje al colocarse: aplica las reglas vigentes (`longitudesEje.ts`)
 * a la DEFINICIÓN GUARDADA de cada pieza (la geometría con la que quedó
 * colocada) y persiste el resultado como si se hubiera colocado hoy.
 *
 * Candidatas: piezas que no tienen de dónde sacar su longitud — sin
 * `colocacion.longitudes_eje` y, o bien con 3 o más bocas (T, X), o bien de dos
 * bocas sin `longitud_mm` ni `longitud_eje_mm` (curva vertical). Rectos y
 * curvas horizontales ya guardaban la suya y no se tocan.
 */
import type { Piece, TrayInput } from '../../tray/model';
import { placedOf } from '../placement/definitions';
import { conLongitudesEje, longitudesDeEje } from '../placement/longitudesEje';
import type { Colocacion } from '../placement/placementCore';

export function necesitaLongitudes(p: Piece): boolean {
  const c = p.colocacion as Colocacion | undefined;
  if (c?.estado === 'resuelta' && c.longitudes_eje) return false;
  const n = Object.keys(p.puertos).length;
  return n >= 3 || (n === 2 && typeof p.longitud_mm !== 'number' && typeof p.longitud_eje_mm !== 'number');
}

export function guardarLongitudesAnteriores(entrada: TrayInput): {
  entrada: TrayInput;
  actualizadas: string[];
  noPudo: Array<{ pieza: string; motivo: string }>;
} {
  const actualizadas: string[] = [];
  const noPudo: Array<{ pieza: string; motivo: string }> = [];
  const piezas = entrada.piezas.map((p) => {
    if (!necesitaLongitudes(p)) return p;
    const c = p.colocacion as Colocacion | undefined;
    if (!c) { noPudo.push({ pieza: p.instancia_id, motivo: 'sin colocación: la pieza no se migró' }); return p; }
    if (c.estado !== 'resuelta') { noPudo.push({ pieza: p.instancia_id, motivo: `sin colocación resuelta: ${c.motivo}` }); return p; }
    const placed = placedOf(entrada, p);
    if (!placed) { noPudo.push({ pieza: p.instancia_id, motivo: 'falta la definición guardada de la pieza' }); return p; }
    const l = longitudesDeEje(placed.def);
    if (!l.ok) { noPudo.push({ pieza: p.instancia_id, motivo: l.motivo }); return p; }
    actualizadas.push(p.instancia_id);
    return conLongitudesEje(p, placed.def);
  });
  return { entrada: actualizadas.length ? { ...entrada, piezas } : entrada, actualizadas, noPudo };
}
