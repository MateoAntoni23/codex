/**
 * Catálogo de cables para elegir en cascada: línea → tipo → formación (etapa 2,
 * 2026-11-13).
 *
 * Fuente: los datasets de `vendor/motor_bandejas/datos/cables/*.json` (los
 * empaqueta el catálogo estático; el servicio manda los mismos en
 * `datasets_cables`). El id de cada cable se arma con la MISMA regla que el motor
 * (`datos_cables.py`: prefijo del dataset, material, n.º de conductores ×
 * formación, sufijo -NI para neutro igual; `idDeCable`, la única copia de la regla
 * en el frontend) y se CONTRASTA con una lista de ids: si no coinciden uno a uno,
 * el catálogo no se ofrece y se dice por qué. Con el motor conectado, los ids del
 * catálogo empaquetado entran en la huella que se compara con la del motor
 * (`catalogFingerprint`): si difieren, el motor queda «incompatible». La
 * autoridad sigue siendo el motor; acá sólo se agrupa para elegir.
 *
 * "Tipo" incluye el material: dentro de una línea hay, por ejemplo, tripolares de
 * cobre y de aluminio.
 */

export interface CableCatalogo {
  readonly cable_id: string;
  readonly dataset_id: string;
  readonly linea: string;
  readonly tipo: string;
  readonly material: string;
  readonly n_conductores: number;
  /** Como la publica el fabricante (p. ej. "50", "25/16", "1,5"). */
  readonly formacion: string;
  readonly diametro_exterior_mm: number;
  readonly masa_kg_km: number;
}

/** Copia de `PREFIJOS_DATASET` y `_MATERIAL` de `datos_cables.py` (verificada contra `cable_ids`). */
const PREFIJOS_DATASET: Readonly<Record<string, string>> = {
  'PRY-SINTENAX-VALIO-ED2020': 'PRY-SVALIO',
  'PRY-SUPERASTIC-ED2026': 'PRY-SASTFLEX',
};
const MATERIAL: Readonly<Record<string, string>> = { cobre: 'CU', aluminio: 'AL' };

const TIPO_TEXTO: Readonly<Record<string, string>> = {
  unipolar: 'Unipolar',
  unipolar_sin_envoltura: 'Unipolar sin envoltura',
  bipolar: 'Bipolar',
  tripolar: 'Tripolar',
  tetrapolar: 'Tetrapolar',
  tetrapolar_neutro_igual: 'Tetrapolar, neutro igual a las fases',
};

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Id de un cable según la regla del motor; null si el dataset o el material no se conocen. */
export function idDeCable(datasetId: string, tabla: { material?: unknown; n_conductores?: unknown; tipo?: unknown }, formacion: string): string | null {
  const prefijo = PREFIJOS_DATASET[datasetId];
  const mat = typeof tabla.material === 'string' ? MATERIAL[tabla.material] : undefined;
  if (!prefijo || !mat) return null;
  const sufijo = tabla.tipo === 'tetrapolar_neutro_igual' ? '-NI' : '';
  return `${prefijo}-${mat}-${tabla.n_conductores}x${formacion.replace(',', '.')}${sufijo}`;
}

export type ResultadoCatalogoCables = { ok: true; cables: CableCatalogo[] } | { ok: false; motivo: string };

export function construirCatalogoCables(datasets: unknown, cableIdsMotor: readonly string[]): ResultadoCatalogoCables {
  if (!Array.isArray(datasets)) return { ok: false, motivo: 'el servicio no mandó los datasets de cables' };
  const cables: CableCatalogo[] = [];
  for (const ds of datasets) {
    if (!esObj(ds) || typeof ds.dataset_id !== 'string' || typeof ds.linea !== 'string' || !Array.isArray(ds.tablas)) {
      return { ok: false, motivo: 'dataset de cables con formato inesperado' };
    }
    const prefijo = PREFIJOS_DATASET[ds.dataset_id];
    if (!prefijo) return { ok: false, motivo: `dataset de cables sin prefijo de id conocido: ${ds.dataset_id}` };
    for (const t of ds.tablas) {
      if (!esObj(t) || typeof t.tipo !== 'string' || typeof t.material !== 'string' || typeof t.n_conductores !== 'number' || !Array.isArray(t.filas)) {
        return { ok: false, motivo: `tabla de cables con formato inesperado en ${ds.dataset_id}` };
      }
      if (!MATERIAL[t.material]) return { ok: false, motivo: `material de cable desconocido: ${t.material}` };
      for (const fila of t.filas) {
        if (!Array.isArray(fila) || typeof fila[0] !== 'string' || typeof fila[1] !== 'number' || typeof fila[2] !== 'number') {
          return { ok: false, motivo: `fila de cable con formato inesperado en ${ds.dataset_id}` };
        }
        const formacion = fila[0];
        cables.push({
          cable_id: idDeCable(ds.dataset_id, t, formacion)!,
          dataset_id: ds.dataset_id, linea: ds.linea, tipo: t.tipo, material: t.material, n_conductores: t.n_conductores,
          formacion, diametro_exterior_mm: fila[1], masa_kg_km: fila[2],
        });
      }
    }
  }
  // Contraste con el motor: los mismos ids, uno a uno.
  const motor = new Set(cableIdsMotor);
  const propios = new Set(cables.map((c) => c.cable_id));
  const sobran = [...propios].filter((id) => !motor.has(id));
  const faltan = [...motor].filter((id) => !propios.has(id));
  if (propios.size !== cables.length) return { ok: false, motivo: 'ids de cable repetidos al armar el catálogo' };
  if (sobran.length || faltan.length) {
    return { ok: false, motivo: `el catálogo de cables no coincide con el del motor (sobran ${sobran.length}, faltan ${faltan.length}${[...sobran, ...faltan].length ? `: ${[...sobran, ...faltan].slice(0, 3).join(', ')}` : ''})` };
  }
  return { ok: true, cables };
}

/** Texto del tipo para el operador, con el material: «Tripolar · cobre». */
export const textoTipo = (c: Pick<CableCatalogo, 'tipo' | 'material'>) => `${TIPO_TEXTO[c.tipo] ?? c.tipo} · ${c.material}`;
/** Formación para el operador: «3 × 50 mm²». */
export const textoFormacion = (c: Pick<CableCatalogo, 'n_conductores' | 'formacion'>) => `${c.n_conductores} × ${c.formacion} mm²`;
/** Cable completo para el operador: «Sintenax Valio · Tripolar · cobre · 3 × 50 mm²». */
export const textoCable = (c: CableCatalogo) => `${lineaCorta(c.linea)} · ${textoTipo(c)} · ${textoFormacion(c)}`;
/** La línea sin la norma ni la tensión: «Sintenax Valio». */
export const lineaCorta = (linea: string) => linea.split(/\s\d/)[0].trim();

/** Clave del tipo dentro de una línea (tipo + material). */
export const claveTipo = (c: Pick<CableCatalogo, 'tipo' | 'material'>) => `${c.tipo}|${c.material}`;

/** Opciones de la cascada, en el orden del catálogo (el del fabricante). */
export function lineas(cables: readonly CableCatalogo[]): string[] {
  return [...new Set(cables.map((c) => c.linea))];
}
export function tiposDe(cables: readonly CableCatalogo[], linea: string): Array<{ clave: string; texto: string }> {
  const vistos = new Map<string, string>();
  for (const c of cables) if (c.linea === linea && !vistos.has(claveTipo(c))) vistos.set(claveTipo(c), textoTipo(c));
  return [...vistos].map(([clave, texto]) => ({ clave, texto }));
}
export function formacionesDe(cables: readonly CableCatalogo[], linea: string, tipo: string): CableCatalogo[] {
  return cables.filter((c) => c.linea === linea && claveTipo(c) === tipo);
}
