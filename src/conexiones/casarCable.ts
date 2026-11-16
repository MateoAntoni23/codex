/**
 * Casar un tendido importado del Excel con un cable del catálogo del motor.
 *
 * Regla (encargo de conexiones importadas, etapa 2): por naturaleza, conductores y
 * sección, nada más. Un candidato → se propone; varios → elige el operador; ninguno →
 * el tendido queda sin cable de catálogo, con el motivo. Nunca un cable por defecto.
 *
 *   - CONDUCTOR_UNIPOLAR → tablas de 1 conductor.
 *   - CABLE_MULTIPOLAR   → tablas con `conductoresPorUnidad` conductores.
 *   - CABLE_DATOS, TUBO  → el catálogo del motor no tiene cables de ese tipo.
 *   - Sección: la formación del fabricante es «a» (todos los conductores iguales) o
 *     «a/b» (uno reducido). «a» tiene que ser `seccionMm2`. El conductor reducido sólo
 *     se puede comparar con lo que el Excel declara (`seccionPeMm2`, con el PE dentro
 *     del cable): «a/b» casa si b = seccionPeMm2; «a» con PE declarado, si a =
 *     seccionPeMm2. Sin la sección del PE declarada, una formación reducida NO casa:
 *     no se supone.
 *   - El material no entra (el Excel no lo trae como campo): cobre y aluminio de la
 *     misma formación son dos candidatos y elige el operador.
 */
import type { TendidoImportado } from '../import/types';
import type { CableCatalogo } from '../workspace/cables/catalogoCables';

export type CasamientoCable =
  | { readonly estado: 'unico'; readonly cable: CableCatalogo; readonly candidatos: readonly CableCatalogo[] }
  | { readonly estado: 'varios'; readonly candidatos: readonly CableCatalogo[] }
  | { readonly estado: 'ninguno'; readonly motivo: string };

/** Formación del fabricante → secciones [principal, reducida] (reducida = principal si no hay «/»). */
export function seccionesDeFormacion(formacion: string): [number, number] {
  const [a, b] = formacion.split('/').map((s) => Number(s.replace(',', '.')));
  return [a, Number.isFinite(b) ? b : a];
}

const mm2 = (n: number) => `${String(n).replace('.', ',')} mm²`;

export function casarTendido(
  t: Pick<TendidoImportado, 'naturaleza' | 'conductoresPorUnidad' | 'seccionMm2' | 'seccionPeMm2' | 'incluyePe'>,
  cables: readonly CableCatalogo[],
): CasamientoCable {
  if (t.naturaleza === 'CABLE_DATOS') return { estado: 'ninguno', motivo: 'cable de datos: el catálogo del motor no tiene cables de datos' };
  if (t.naturaleza === 'TUBO') return { estado: 'ninguno', motivo: 'tubo: no es un cable' };
  const n = t.naturaleza === 'CONDUCTOR_UNIPOLAR' ? 1 : t.conductoresPorUnidad;
  if (n === undefined) return { estado: 'ninguno', motivo: 'el Excel no trae los conductores por unidad' };
  if (t.seccionMm2 === undefined) return { estado: 'ninguno', motivo: 'el Excel no trae la sección' };
  const peDentro = t.naturaleza === 'CABLE_MULTIPOLAR' && t.incluyePe === 'SI' && t.seccionPeMm2 !== undefined ? t.seccionPeMm2 : undefined;
  const conN = cables.filter((c) => c.n_conductores === n);
  if (!conN.length) return { estado: 'ninguno', motivo: `el catálogo no tiene cables de ${n} conductores` };
  const candidatos = conN.filter((c) => {
    const [a, b] = seccionesDeFormacion(c.formacion);
    if (a !== t.seccionMm2) return false;
    if (b !== a) return peDentro !== undefined && b === peDentro;
    return peDentro === undefined || peDentro === a;
  });
  if (!candidatos.length) {
    const conSeccion = conN.some((c) => seccionesDeFormacion(c.formacion)[0] === t.seccionMm2);
    return {
      estado: 'ninguno',
      motivo: conSeccion
        ? `ningún cable de ${n} × ${mm2(t.seccionMm2)} del catálogo tiene el conductor reducido que declara el Excel (${peDentro !== undefined ? `PE ${mm2(peDentro)}` : 'PE sin sección declarada'})`
        : `el catálogo no tiene cables de ${n} × ${mm2(t.seccionMm2)}`,
    };
  }
  if (candidatos.length === 1) return { estado: 'unico', cable: candidatos[0], candidatos };
  return { estado: 'varios', candidatos };
}
