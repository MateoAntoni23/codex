/**
 * catalogPortMapping — asociación explícita boca-receta ↔ puerto-catálogo.
 *
 * Problema que resuelve: las recetas paramétricas de accesorios usan nombres
 * semánticos para las bocas (`tronco_P1`, `tronco_P2`, `boca_derivacion` para
 * un TPS; `P1_horizontal`, `P2_vertical` para CUPS; `P1_x_neg`...`P4_z_pos`
 * para XPS). El catálogo SAMET (`catalogo_bandejas_snapshot.json`), en
 * cambio, identifica los puertos con nombres anónimos P1/P2/P3/P4 (el
 * `puerto_a_id` y `puerto_b_id` de compatibilidades usan la forma
 * `${producto_id}-${nombre_catalogo}`, p.ej. `SAM_TPS-300-Z-P3`).
 *
 * Como `routingRules.getCompatibleProductIds` arma el `portId` concatenando
 * `${producto_id}-${nombre_boca_de_la_pieza}`, sin traducción la búsqueda
 * `SAM_TPS-300-Z-tronco_P2` NO coincide con ninguna entrada del catálogo
 * (que tiene `SAM_TPS-300-Z-P2`). Resultado: la TPS continuar-por-cada-salida
 * no encontraba candidatos compat aunque el catálogo sí los listara.
 *
 * Diseño:
 *  - Para productos de 2 bocas (tramos rectos, curvas horizontales) el default
 *    es IDENTIDAD — las recetas ya usan `P1`/`P2`, así que no se necesita
 *    mapping.
 *  - Para productos de 3+ bocas se declara un mapping explícito con su
 *    justificación geométrica/física.
 *  - El Configurador de biblioteca permitirá overridear este mapping por
 *    producto, con motivo y trazabilidad (gancho `applyOverrides` abajo).
 *    Hasta que exista override, se usa el default declarado aquí.
 *
 * Fuente de autoridad del default TPS (único accesorio 3-boca con compat
 * publicada hoy): instrucción explícita del usuario — tronco_P1→P1,
 * tronco_P2→P2, boca_derivacion→P3. El catálogo SAMET no publica
 * `puerto_descripcion` por lo que no hay otra fuente para contrastar.
 *
 * Diseño de IDs:
 *  - `recipePortName`: nombre tal como aparece en `piece.puertos` y en las
 *    recetas paramétricas (`outlines.ts`). Es el que se escribe en
 *    `conexiones.a[1]`/`conexiones.b[1]` del TrayInput.
 *  - `catalogPortName`: sufijo detrás del `-` en `puerto_a_id`/`puerto_b_id`
 *    del catálogo SAMET.
 *
 * Importante: este módulo NO redefine compatibilidades. Sólo traduce el
 * nombre del puerto de la pieza al nombre que usa el catálogo. Si el
 * catálogo no lista una compat para `P3`, no se inventa aunque el usuario
 * "sepa" que debería haberla — se devuelve la ausencia en forma honesta.
 */

export interface PortMappingEntry {
  readonly recipePortName: string;
  readonly catalogPortName: string;
  readonly physicalLabel: string;
  readonly justification: string;
}

export interface ProductPortMapping {
  readonly productId: string;
  readonly entries: readonly PortMappingEntry[];
  readonly source: 'default' | 'override';
  /** Motivo del override cuando source === 'override'. */
  readonly overrideReason?: string;
  readonly overrideAt?: string;
}

/**
 * Defaults por producto. Sólo se declaran mappings NO triviales (recetas
 * con nombres semánticos). Las recetas 2-boca (TRPS, CPS-45, CPS-90) usan
 * P1/P2 y caen en el fallback identidad implícito.
 */
const DEFAULT_MAPPINGS: Readonly<Record<string, readonly PortMappingEntry[]>> = {
  // ─── TPS-300-Z (tee simétrica) ────────────────────────────────────────────
  'SAM_TPS-300-Z': [
    {
      recipePortName: 'tronco_P1',
      catalogPortName: 'P1',
      physicalLabel: 'Tronco (entrada)',
      justification:
        'Catálogo SAMET publica tres puertos P1/P2/P3 para TPS; sin descripción textual del fabricante, se adopta la asociación declarada por el usuario: tronco_P1 ≡ P1.',
    },
    {
      recipePortName: 'tronco_P2',
      catalogPortName: 'P2',
      physicalLabel: 'Tronco (salida)',
      justification:
        'Adoptado por decisión del usuario: tronco_P2 ≡ P2 del catálogo SAMET.',
    },
    {
      recipePortName: 'boca_derivacion',
      catalogPortName: 'P3',
      physicalLabel: 'Boca de derivación (lateral)',
      justification:
        'Adoptado por decisión del usuario: boca_derivacion ≡ P3 del catálogo SAMET.',
    },
  ],
  // ─── XPS-300-Z (cruz) ────────────────────────────────────────────────────
  // No hay compat publicada con nombres específicos para los 4 brazos — el
  // catálogo lista P1/P2/P3/P4 sin descripción. Adoptamos el orden del
  // polígono medido: P1≡x_neg, P2≡x_pos, P3≡z_neg, P4≡z_pos.
  'SAM_XPS-300-Z': [
    { recipePortName: 'P1_x_neg', catalogPortName: 'P1', physicalLabel: 'Brazo X−', justification: 'Orden de bocas del polígono medido.' },
    { recipePortName: 'P2_x_pos', catalogPortName: 'P2', physicalLabel: 'Brazo X+', justification: 'Orden de bocas del polígono medido.' },
    { recipePortName: 'P3_z_neg', catalogPortName: 'P3', physicalLabel: 'Brazo Z−', justification: 'Orden de bocas del polígono medido.' },
    { recipePortName: 'P4_z_pos', catalogPortName: 'P4', physicalLabel: 'Brazo Z+', justification: 'Orden de bocas del polígono medido.' },
  ],
  // ─── CUPS-300-A-Z (curva vertical interior) ──────────────────────────────
  'SAM_CUPS-300-A-Z': [
    {
      recipePortName: 'P1_horizontal',
      catalogPortName: 'P1',
      physicalLabel: 'Boca horizontal (bandeja)',
      justification: 'Orden declarado en la receta paramétrica: P1 es la cara horizontal.',
    },
    {
      recipePortName: 'P2_vertical',
      catalogPortName: 'P2',
      physicalLabel: 'Boca vertical (tramo ascendente/descendente)',
      justification: 'Orden declarado en la receta paramétrica: P2 es la cara vertical.',
    },
  ],
};

// ─── Store de overrides (in-memory, serializable) ───────────────────────────
//
// El store real vive en workspace/catalogConfigStore (Zustand) para poder ser
// observado desde React. Este módulo expone sólo la API funcional pura que
// consume ese store. El store llama a `setOverrides()` al cargar o editar
// la configuración; los lookups leen `_overrides`.

let _overrides: Readonly<Record<string, ProductPortMapping>> = {};

export function setPortMappingOverrides(overrides: Record<string, ProductPortMapping>): void {
  _overrides = { ...overrides };
}

export function clearPortMappingOverrides(): void {
  _overrides = {};
}

export function getEffectiveMapping(productId: string): ProductPortMapping | null {
  const ov = _overrides[productId];
  if (ov) return ov;
  const def = DEFAULT_MAPPINGS[productId];
  if (!def) return null;
  return { productId, entries: def, source: 'default' };
}

/**
 * Devuelve TODAS las entradas del mapping efectivo (default + overrides)
 * para exposición en el configurador. Pensado para listados.
 */
export function listEffectiveMappings(): readonly ProductPortMapping[] {
  const ids = new Set<string>([...Object.keys(DEFAULT_MAPPINGS), ...Object.keys(_overrides)]);
  const result: ProductPortMapping[] = [];
  for (const id of ids) {
    const m = getEffectiveMapping(id);
    if (m) result.push(m);
  }
  return result;
}

/**
 * Traduce un nombre de boca (como aparece en `piece.puertos`) al nombre
 * del puerto en el catálogo SAMET. Si no hay mapping declarado (default
 * ni override) para el producto, devuelve el nombre sin cambios — esto es
 * seguro para productos 2-boca donde recipe y catálogo usan P1/P2.
 *
 * Side-effect free: no toca el store ni emite telemetría.
 */
export function recipePortToCatalogPort(
  productId: string,
  recipePortName: string,
): string {
  const mapping = getEffectiveMapping(productId);
  if (!mapping) return recipePortName;
  const hit = mapping.entries.find((e) => e.recipePortName === recipePortName);
  return hit?.catalogPortName ?? recipePortName;
}

/**
 * Inverso: dado un nombre de catálogo, devuelve el nombre de boca de la
 * receta. Útil para desde-catálogo-al-UI. Si no hay mapping o el nombre no
 * aparece, devuelve el original (identidad).
 */
export function catalogPortToRecipePort(
  productId: string,
  catalogPortName: string,
): string {
  const mapping = getEffectiveMapping(productId);
  if (!mapping) return catalogPortName;
  const hit = mapping.entries.find((e) => e.catalogPortName === catalogPortName);
  return hit?.recipePortName ?? catalogPortName;
}

/**
 * Lista el default declarado (sin overrides) para un producto. Útil para
 * mostrar "valor del fabricante" vs "override de proyecto" en el inspector.
 */
export function getDefaultMapping(productId: string): readonly PortMappingEntry[] | null {
  return DEFAULT_MAPPINGS[productId] ?? null;
}

/**
 * Lista productos cuyo mapping actual proviene de override (no default).
 */
export function listOverriddenProductIds(): readonly string[] {
  return Object.keys(_overrides);
}
