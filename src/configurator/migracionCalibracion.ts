/**
 * migracionCalibracion — biblioteca por SKU (codex:catalogConfig/1, bloque
 * codex:library/1) → calibración por patrón (codex:calibracion/2). B-2.6.
 *
 * Por cada override por SKU con geometría (modelFrame y/o bocas):
 *   1. Se reproduce la resolución anterior de ESE producto con la función de
 *      entonces (`resolveRecipeWith`: modelFrame + override directo).
 *   2. Cada boca resuelta se lleva al marco crudo del cuerpo (inversa del
 *      modelFrame) y se expresa como corrección respecto de su boca nominal,
 *      en los ejes de la boca. Así el modelFrame rígido desaparece (con marco
 *      completo no cambia la pieza colocada) y queda lo que importa: dónde está
 *      cada boca respecto del cuerpo.
 *   3. Por patrón: si las correcciones de todos sus SKU coinciden, quedan como
 *      calibración del patrón; si no, NO se elige: cada SKU queda como
 *      excepción de su variante, y se informa.
 *
 * Nada se pierde:
 *   - los nombres de boca de cada override se conservan (override sólo de
 *     nombres, sin geometría);
 *   - un override que no se puede ubicar en un patrón (sin maestro, sin receta)
 *     queda en `pendientes` con el original, sin aplicarse, y se informa;
 *   - el original completo se conserva aparte (lo hace quien llama).
 *
 * Igualdad de correcciones: ≤ 1e-6 mm y 1e-6°. Las correcciones salen de
 * transformar en doble precisión valores de mm/° de magnitud ≤ 10³ (ruido
 * ~1e-12); los valores del configurador se ingresan con ≤ 3 decimales, así que
 * dos calibraciones realmente distintas difieren en ≥ 1e-3.
 */
import type { Product } from '../tray/model';
import { findMasterForProduct } from './masterModels';
import { buildRecipeFromProduct, resolveParametricEntry } from '../workspace/parametricBridge';
import { resolveRecipeForProduct, resolveRecipeWith } from '../workspace/resolvedPortGeometry';
import {
  getAllOverrides,
  setPortMappingOverrides,
  isIdentityModelFrame,
  isIdentityPortGeometry,
  type ProductPortMapping,
  type PortGeometryOverride,
} from '../workspace/catalogPortMapping';
import {
  BIBLIOTECA_CALIBRACION_VERSION,
  clearBibliotecaCalibracion,
  correccionEntre,
  getBibliotecaCalibracion,
  setBibliotecaCalibracion,
  diferenciaCorrecciones,
  esCorreccionNula,
  marcoDeBoca,
  type BibliotecaCalibracion,
  type CalibracionPatron,
  type CorreccionBoca,
  type ExcepcionVariante,
  type V3,
} from '../workspace/calibracionPatron';
import { esVarianteMedida } from '../workspace/placement/calibrarReceta';
import { buildDefinition } from '../workspace/placement/definitions';
import { definitionFromRecipe, placeDefinition, worldPorts } from '../workspace/placement/placementCore';
import * as THREE from 'three';

export const TOL_IGUALDAD = 1e-6;

/** Override por SKU que no se pudo ubicar en un patrón: se conserva sin aplicar. */
export interface CalibracionPendiente {
  readonly productoId: string;
  readonly motivo: string;
  readonly original: ProductPortMapping;
}

export interface BibliotecaMigrada extends BibliotecaCalibracion {
  readonly pendientes: Readonly<Record<string, CalibracionPendiente>>;
}

export interface InformeMigracion {
  /** Patrones que quedaron con una sola calibración (todas sus fuentes coincidían). */
  readonly patrones: ReadonlyArray<{ patron: string; desde: readonly string[] }>;
  /** Patrones con calibraciones distintas por SKU: cada una quedó como excepción. */
  readonly conflictos: ReadonlyArray<{ patron: string; productos: readonly string[] }>;
  /** modelFrame descartados (rígidos): el producto y el valor original. */
  readonly modelFramesDescartados: ReadonlyArray<{ productoId: string; modelFrame: ProductPortMapping['modelFrame'] }>;
  readonly pendientes: readonly CalibracionPendiente[];
  /** Overrides que sólo cambiaban nombres de boca: quedan igual. */
  readonly soloNombres: readonly string[];
}

export interface ResultadoMigracion {
  readonly biblioteca: BibliotecaMigrada;
  /** Overrides por SKU sin geometría (sólo nombres de boca). */
  readonly overridesNombres: Record<string, ProductPortMapping>;
  readonly informe: InformeMigracion;
}

function tieneGeometria(ov: ProductPortMapping): boolean {
  if (ov.modelFrame && !isIdentityModelFrame(ov.modelFrame)) return true;
  return ov.entries.some((e) => e.geometry && !isIdentityPortGeometry(e.geometry));
}

function sinGeometria(ov: ProductPortMapping): ProductPortMapping {
  const { modelFrame: _mf, ...rest } = ov;
  return { ...rest, entries: ov.entries.map(({ geometry: _g, ...e }) => e) };
}

/** Correcciones por boca que reproducen la calibración por SKU de un producto. */
export function correccionesDeOverride(product: Product, ov: ProductPortMapping): Record<string, CorreccionBoca> | { motivo: string } {
  const entry = resolveParametricEntry(product);
  if (!entry) return { motivo: 'el producto no tiene modelo paramétrico' };
  let raw;
  try {
    raw = buildRecipeFromProduct(product, entry);
  } catch (e) {
    return { motivo: `no se pudo construir la receta: ${e instanceof Error ? e.message : String(e)}` };
  }
  const porBoca: Record<string, PortGeometryOverride | null> = {};
  for (const e of ov.entries) porBoca[e.recipePortName] = e.geometry ?? null;
  const legacy = resolveRecipeWith(raw, ov.modelFrame ?? null, porBoca);
  const inv = legacy.preTransform.clone().invert();
  const out: Record<string, CorreccionBoca> = {};
  raw.ports.forEach((p, i) => {
    const r = legacy.recipe.ports[i];
    const c = new THREE.Vector3(...r.center).applyMatrix4(inv);
    const n = new THREE.Vector3(...r.normal).transformDirection(inv);
    const v = new THREE.Vector3(...r.v_dir).transformDirection(inv);
    const nominal = marcoDeBoca(p.center as V3, p.normal as V3, p.v_dir as V3);
    const calibrado = marcoDeBoca([c.x, c.y, c.z], [n.x, n.y, n.z], [v.x, v.y, v.z]);
    const corr = correccionEntre(nominal, calibrado);
    if (!esCorreccionNula(corr, TOL_IGUALDAD)) out[p.name] = corr;
  });
  return out;
}

function mismasCorrecciones(a: Record<string, CorreccionBoca>, b: Record<string, CorreccionBoca>): boolean {
  const nombres = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of nombres) {
    const ca = a[n];
    const cb = b[n];
    if (!ca || !cb) {
      if (!esCorreccionNula(ca ?? cb, TOL_IGUALDAD)) return false;
      continue;
    }
    const d = diferenciaCorrecciones(ca, cb);
    if (d.mm > TOL_IGUALDAD || d.deg > TOL_IGUALDAD) return false;
  }
  return true;
}

export function migrarBibliotecaPorSku(
  overrides: Readonly<Record<string, ProductPortMapping>>,
  productos: readonly Product[],
  fecha = new Date().toISOString(),
): ResultadoMigracion {
  const porId = new Map(productos.map((p) => [p.producto_id, p]));
  const overridesNombres: Record<string, ProductPortMapping> = {};
  const pendientes: Record<string, CalibracionPendiente> = {};
  const soloNombres: string[] = [];
  const modelFramesDescartados: Array<{ productoId: string; modelFrame: ProductPortMapping['modelFrame'] }> = [];
  const porPatron = new Map<string, Array<{ productoId: string; bocas: Record<string, CorreccionBoca>; medida: boolean }>>();

  for (const id of Object.keys(overrides).sort()) {
    const ov = overrides[id];
    if (!tieneGeometria(ov)) {
      overridesNombres[id] = ov;
      soloNombres.push(id);
      continue;
    }
    overridesNombres[id] = sinGeometria(ov);
    const product = porId.get(id);
    const master = product ? findMasterForProduct(product as Record<string, unknown>) : null;
    if (!product || !master) {
      pendientes[id] = { productoId: id, original: ov, motivo: !product ? 'el producto no está en el catálogo' : 'el producto no corresponde a ningún patrón' };
      continue;
    }
    const corr = correccionesDeOverride(product, ov);
    if ('motivo' in corr) {
      pendientes[id] = { productoId: id, original: ov, motivo: corr.motivo as string };
      continue;
    }
    if (ov.modelFrame && !isIdentityModelFrame(ov.modelFrame)) modelFramesDescartados.push({ productoId: id, modelFrame: ov.modelFrame });
    const lista = porPatron.get(master.id) ?? [];
    lista.push({ productoId: id, bocas: corr as Record<string, CorreccionBoca>, medida: esVarianteMedida(product, master) });
    porPatron.set(master.id, lista);
  }

  const patrones: Record<string, CalibracionPatron> = {};
  const excepciones: Record<string, ExcepcionVariante> = {};
  const informePatrones: Array<{ patron: string; desde: string[] }> = [];
  const conflictos: Array<{ patron: string; productos: string[] }> = [];
  for (const [patron, lista] of porPatron) {
    const conCorreccion = lista.filter((x) => Object.keys(x.bocas).length > 0);
    if (!conCorreccion.length) continue; // sólo modelFrame rígido: no queda corrección
    if (conCorreccion.every((x) => mismasCorrecciones(x.bocas, conCorreccion[0].bocas))
      && lista.every((x) => mismasCorrecciones(x.bocas, conCorreccion[0].bocas))) {
      patrones[patron] = {
        patron,
        bocas: conCorreccion[0].bocas,
        motivo: `migrada de la calibración por SKU de ${lista.map((x) => x.productoId).join(', ')}`,
        fecha,
      };
      informePatrones.push({ patron, desde: lista.map((x) => x.productoId) });
    } else {
      for (const x of lista) {
        excepciones[x.productoId] = {
          productoId: x.productoId,
          patron,
          bocas: x.bocas,
          motivo: 'migrada: las calibraciones por SKU de este patrón no coincidían; no se eligió una',
          fecha,
        };
      }
      conflictos.push({ patron, productos: lista.map((x) => x.productoId) });
    }
  }

  return {
    biblioteca: { version: BIBLIOTECA_CALIBRACION_VERSION, patrones, excepciones, pendientes },
    overridesNombres,
    informe: { patrones: informePatrones, conflictos, modelFramesDescartados, pendientes: Object.values(pendientes), soloNombres },
  };
}

// ─── PB5: bocas antes y después de migrar, pieza por pieza ────────────────────

export interface DiferenciaBocas {
  readonly productoId: string;
  readonly patron: string;
  /** Mayor distancia entre la misma boca colocada antes y después (mm). */
  readonly maxMm: number;
  /** Mayor ángulo entre normales u orientaciones de la misma boca (°). */
  readonly maxDeg: number;
  /** null si coinciden; si no, por qué difieren. */
  readonly nota: string | null;
}

/**
 * Coloca cada producto de los patrones afectados con la biblioteca VIEJA (por
 * SKU, con su herencia por búsqueda) y con la MIGRADA, desde la misma boca y el
 * mismo punto, y compara todas sus bocas. Restaura el estado de calibración al
 * terminar. Tolerancia de "iguales": 1e-6 mm / 1e-6° (ver TOL_IGUALDAD).
 */
export function diferenciasDeBocas(
  overridesViejos: Readonly<Record<string, ProductPortMapping>>,
  migrado: ResultadoMigracion,
  productos: readonly Product[],
): DiferenciaBocas[] {
  const afectados = new Set<string>();
  for (const id of Object.keys(overridesViejos)) {
    const p = productos.find((x) => x.producto_id === id);
    const m = p ? findMasterForProduct(p as Record<string, unknown>) : null;
    if (m) afectados.add(m.id);
  }
  const prevOverrides = getAllOverrides();
  const prevBib = getBibliotecaCalibracion();
  const out: DiferenciaBocas[] = [];
  try {
    for (const p of productos) {
      const master = findMasterForProduct(p as Record<string, unknown>);
      if (!master || !afectados.has(master.id)) continue;
      // Antes: overrides por SKU (con herencia), definición con la resolución de entonces.
      setPortMappingOverrides({ ...overridesViejos });
      clearBibliotecaCalibracion();
      const entry = resolveParametricEntry(p);
      if (!entry) continue;
      let raw;
      try { raw = buildRecipeFromProduct(p, entry); } catch { continue; }
      const viejo = resolveRecipeForProduct(raw, p.producto_id);
      const defViejo = definitionFromRecipe({ patron: master.id, revision: 'migracion', params: {}, raw, resolved: viejo.recipe, preTransform: viejo.preTransform });
      // Después: biblioteca migrada.
      setPortMappingOverrides({ ...migrado.overridesNombres });
      setBibliotecaCalibracion(migrado.biblioteca);
      const nuevo = buildDefinition(p);
      if (!nuevo.ok) continue;
      const entrada = defViejo.ports[0]?.name;
      if (!entrada || !nuevo.def.ports.some((q) => q.name === entrada)) continue;
      const colocar = (def: typeof defViejo) => {
        const pl = placeDefinition({ def, huella: 'x', mano: 'nativa', entryPortName: entrada, startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
        return worldPorts(def, 'nativa', pl.colocacion.pose);
      };
      let a, b;
      try { a = colocar(defViejo); b = colocar(nuevo.def); } catch { continue; }
      let maxMm = 0;
      let maxDeg = 0;
      for (const pa of a) {
        const pb = b.find((q) => q.name === pa.name);
        if (!pb) continue;
        maxMm = Math.max(maxMm, Math.hypot(pa.pos[0] - pb.pos[0], pa.pos[1] - pb.pos[1], pa.pos[2] - pb.pos[2]));
        for (const k of ['normal', 'vDir'] as const) {
          // atan2(|a×b|, a·b): bien condicionado cerca de 0 (acos o √(1−d²) dan
          // 1,2e-6° con vectores iguales cuando a·b queda a un ULP de 1).
          const [x, y, z] = pa[k];
          const [u, v, w] = pb[k];
          const cr = Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u);
          maxDeg = Math.max(maxDeg, (Math.atan2(cr, x * u + y * v + z * w) * 180) / Math.PI);
        }
      }
      const iguales = maxMm <= TOL_IGUALDAD && maxDeg <= TOL_IGUALDAD;
      const tieneOverride = !!overridesViejos[p.producto_id];
      out.push({
        productoId: p.producto_id,
        patron: master.id,
        maxMm,
        maxDeg,
        nota: iguales
          ? null
          : tieneOverride
            ? 'la calibración propia de este producto no se reproduce'
            : nuevo.def.calibracion
              ? 'antes heredaba por búsqueda la calibración de otro SKU (sin su centro absoluto); ahora aplica la corrección del patrón'
              : 'antes heredaba por búsqueda la calibración de otro SKU; ahora queda sin calibración (el patrón no tiene una: sus SKU no coincidían y quedaron como excepciones)',
      });
    }
  } finally {
    setPortMappingOverrides(prevOverrides);
    setBibliotecaCalibracion(prevBib);
  }
  return out;
}
