/**
 * staticCatalog — catálogo de productos como recurso estático del frontend.
 *
 * Hasta el hito 1 el catálogo (productos, puertos, compatibilidades, familias,
 * cables) sólo llegaba si el motor Python respondía. Ahora se lee de los mismos
 * archivos que usa el motor (`vendor/motor_bandejas/datos`), empaquetados con la
 * aplicación, de modo que se puede diseñar con el motor apagado. El motor queda
 * para calcular y para informar su estado.
 *
 * Carga diferida: el snapshot pesa ~3,9 MB. Se importa con `import()` dinámico
 * (`?raw`), de modo que Vite lo emite como un chunk aparte y no bloquea la carga
 * inicial. `loadStaticCatalog()` memoiza la promesa; `seedStaticCatalog()` además
 * siembra el índice de productos y el resolvedor de maestros (que antes sólo se
 * sembraban cuando respondía el motor).
 *
 * Identificadores de cable: el motor los construye al leer los datasets
 * (`datos_cables.py`: PREFIJO-MATERIAL-NxFORMACION[-NI]). `deriveCableIds`
 * reproduce esa regla; la prueba `staticCatalog.test.ts` la compara contra la
 * lista que publica el motor (fixture `cable_ids.motor.json`).
 */
import type {
  CatalogCompatibility,
  CatalogFamily,
  CatalogPort,
  CatalogUnionComponent,
  Context,
  Product,
} from '../tray/model';
import { setCatalogPortIndex, setMasterResolver, setProductCatalogIndex } from '../workspace/catalogPortMapping';
import { findMasterForProduct } from '../configurator/masterModels';
import { construirCatalogoCables, idDeCable, type ResultadoCatalogoCables } from '../workspace/cables/catalogoCables';

export interface StaticCatalog {
  readonly productos: Product[];
  readonly puertos: CatalogPort[];
  readonly compatibilidades: CatalogCompatibility[];
  readonly componentesUnion: CatalogUnionComponent[];
  readonly familias: CatalogFamily[];
  readonly cables: string[];
  /** Cables agrupados para elegir en cascada (etapa 2). */
  readonly catalogoCables: ResultadoCatalogoCables;
  readonly ejemplos: Context['ejemplos'];
  /** Huella estructural del catálogo + cables; comparable con la del motor. */
  readonly fingerprint: string;
  /** SHA-256 de decisiones_producto.json (build-time). */
  readonly decisionesSha256: string;
}

type RawCatalog = Record<string, unknown>;

/** Reproduce la regla de ids de `motor_bandejas/datos_cables.py` (`idDeCable`, una sola copia). */
export function deriveCableIds(datasets: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const ds of datasets) {
    const d = ds as { dataset_id?: string; tablas?: unknown[] };
    if (!d.dataset_id || !Array.isArray(d.tablas)) continue;
    for (const t of d.tablas) {
      const tabla = t as { material?: string; n_conductores?: number; tipo?: string; filas?: unknown[] };
      if (!Array.isArray(tabla.filas)) continue;
      for (const fila of tabla.filas) {
        const id = idDeCable(d.dataset_id, tabla, String((fila as unknown[])[0]));
        if (id) ids.add(id);
      }
    }
  }
  return [...ids].sort();
}

/** Hash no criptográfico de 53 bits (cyrb53); suficiente para comparar huellas. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const idList = (rows: unknown, key: string): string[] =>
  Array.isArray(rows)
    ? rows
        .map((r) => (r && typeof r === 'object' ? String((r as Record<string, unknown>)[key] ?? '') : ''))
        .sort()
    : [];

/**
 * Huella del contenido relevante para el diseño: ids de productos, puertos,
 * compatibilidades, componentes de unión (id+requerido+cantidad), familias y cables.
 * Se aplica igual al catálogo empaquetado y al que devuelve el motor.
 */
export function catalogFingerprint(catalogo: RawCatalog, cableIds: readonly string[]): string {
  const union = Array.isArray(catalogo.COMPONENTES_UNION)
    ? (catalogo.COMPONENTES_UNION as Array<Record<string, unknown>>)
        .map((u) => `${u.compatibilidad_id}|${u.producto_requerido_id}|${u.cantidad}`)
        .sort()
    : [];
  const payload = JSON.stringify([
    idList(catalogo.PRODUCTOS, 'producto_id'),
    idList(catalogo.PUERTOS_PRODUCTO, 'puerto_id'),
    idList(catalogo.COMPATIBILIDADES, 'compatibilidad_id'),
    union,
    idList(catalogo.FAMILIAS, 'familia_id'),
    [...cableIds].sort(),
  ]);
  return cyrb53(payload);
}

function typedList<T>(raw: unknown, key: string): T[] {
  return Array.isArray(raw)
    ? (raw as unknown[]).filter((x): x is T => !!x && typeof (x as Record<string, unknown>)[key] === 'string')
    : [];
}

/** Arma el catálogo estático a partir de los textos JSON crudos (sin I/O). */
export function buildStaticCatalog(input: {
  catalogoJson: string;
  cablesJson: readonly string[];
  ejemplosJson: Record<string, string>;
  decisionesSha256: string;
}): StaticCatalog {
  const raw = JSON.parse(input.catalogoJson) as RawCatalog;
  const productos = raw.PRODUCTOS;
  if (
    !Array.isArray(productos) ||
    productos.some(
      (p) =>
        !p ||
        typeof (p as Product).producto_id !== 'string' ||
        typeof (p as Product).tipo_pieza !== 'string',
    )
  ) {
    throw new Error('CATALOGO_ESTATICO_INVALIDO: PRODUCTOS');
  }
  const datasetsCables = input.cablesJson.map((t) => JSON.parse(t));
  const cables = deriveCableIds(datasetsCables);
  const ejemplos: Context['ejemplos'] = {};
  for (const [name, text] of Object.entries(input.ejemplosJson)) {
    ejemplos[name] = JSON.parse(text) as Record<string, unknown>;
  }
  return {
    productos: productos as Product[],
    puertos: typedList<CatalogPort>(raw.PUERTOS_PRODUCTO, 'puerto_id'),
    compatibilidades: typedList<CatalogCompatibility>(raw.COMPATIBILIDADES, 'compatibilidad_id'),
    componentesUnion: typedList<CatalogUnionComponent>(raw.COMPONENTES_UNION, 'compatibilidad_id'),
    familias: typedList<CatalogFamily>(raw.FAMILIAS, 'familia_id'),
    cables,
    catalogoCables: construirCatalogoCables(datasetsCables, cables),
    ejemplos,
    fingerprint: catalogFingerprint(raw, cables),
    decisionesSha256: input.decisionesSha256,
  };
}

let cached: Promise<StaticCatalog> | null = null;

/** Carga (una vez) el catálogo empaquetado. El snapshot va en un chunk diferido. */
export function loadStaticCatalog(): Promise<StaticCatalog> {
  if (!cached) {
    cached = (async () => {
      const [catalogo, sintenax, superastic, caso1, caso2, caso3, deriv] = await Promise.all([
        import('../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json?raw'),
        import('../../vendor/motor_bandejas/datos/cables/prysmian_sintenax_valio_2020.json?raw'),
        import('../../vendor/motor_bandejas/datos/cables/prysmian_superastic_flex_2026.json?raw'),
        import('../../vendor/motor_bandejas/ejemplos/caso1_4_separados.json?raw'),
        import('../../vendor/motor_bandejas/ejemplos/caso2_8_separados.json?raw'),
        import('../../vendor/motor_bandejas/ejemplos/caso3_8_contacto.json?raw'),
        import('../../vendor/motor_bandejas/ejemplos/trazado_derivacion_pe.json?raw'),
      ]);
      return buildStaticCatalog({
        catalogoJson: catalogo.default,
        cablesJson: [sintenax.default, superastic.default],
        ejemplosJson: {
          caso1_4_separados: caso1.default,
          caso2_8_separados: caso2.default,
          caso3_8_contacto: caso3.default,
          trazado_derivacion_pe: deriv.default,
        },
        decisionesSha256: __DECISIONES_SHA256__,
      });
    })();
    // Si falla (p. ej. chunk no disponible) permitir reintentar.
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** Contexto de catálogo en la forma que consume el resto de la aplicación. */
export function staticContext(c: StaticCatalog): Context {
  return {
    productos: c.productos,
    cables: c.cables,
    catalogoCables: c.catalogoCables,
    puertos: c.puertos,
    compatibilidades: c.compatibilidades,
    componentesUnion: c.componentesUnion,
    familias: c.familias,
    ejemplos: c.ejemplos,
    versions: `static:${c.decisionesSha256}:${c.fingerprint}`,
  };
}

/** Carga el catálogo y siembra índice de productos, resolvedor de maestros e índice de puertos. */
export async function seedStaticCatalog(): Promise<StaticCatalog> {
  const c = await loadStaticCatalog();
  setProductCatalogIndex(c.productos);
  setMasterResolver((p) => findMasterForProduct(p as Record<string, unknown>));
  // Puertos publicados: permite verificar identidades P1/P2… y mappings derivados.
  setCatalogPortIndex(c.puertos);
  return c;
}
