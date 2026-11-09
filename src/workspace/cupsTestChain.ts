/**
 * cupsTestChain — escenario aditivo de prueba para cerrar CUPS (#224).
 *
 * Construye dos cadenas CUPS canónicas y las fusiona con un `TrayInput`
 * existente SIN alterar nada preexistente:
 *
 *   - Cadena base     : TRPS-300-22-Z  →  CUPS-300-A-Z  →  TRPS-300-22-Z
 *   - Cadena variante : TRPS-450-20-Z  →  CUPS-450-A-Z  →  TRPS-450-20-Z
 *
 * Reglas de operación (acompañan los criterios del encargo):
 *
 *   (a) Aditividad   — las piezas y conexiones nuevas se APPENDEAN. Ninguna
 *       pieza, conexión, soporte, circuito o campo PE del input entrante se
 *       altera. Es seguro invocar sobre un proyecto en curso.
 *   (b) Idempotencia — si cualquiera de los IDs del escenario ya existe en
 *       `input.piezas`, la función devuelve el input tal cual (no-op). Esto
 *       garantiza que pulsar el botón dos veces no duplica trazos.
 *   (c) Separación espacial — las dos cadenas se desplazan 2 m en Y entre sí
 *       para que ambas sean visibles sin maniobras de cámara.
 *   (d) orientacion_seccion_ws persistido — cada boca lleva el v_dir mundial
 *       coherente con la boca fuente (depth-only para la variante), de modo
 *       que `assertInput` acepta el resultado y `getFreePorts` consume el
 *       campo directamente (sin heurística).
 *
 * El escenario NO llama al motor: produce entrada válida que preview, confirmed
 * y recovery consumen por igual. La demostración completa requiere colocar
 * continuaciones desde las bocas P2_vertical libres (ruta usual del workspace).
 */
import { planAddAccessory } from './workspaceOperation';
import { placeRecipe, resolveRecipe } from './parametricBridge';
import type { TrayInput, Product, Piece } from '../tray/model';
import type { StartPort, DirectCompatResult } from './routingRules';

export const CUPS_SCENARIO_IDS = {
  base: {
    trps1: 'cups-scenario:base-trps-1',
    cups: 'cups-scenario:base-cups',
    trps2: 'cups-scenario:base-trps-2',
    conn1: 'cups-scenario:base-conn-1',
    conn2: 'cups-scenario:base-conn-2',
  },
  variant: {
    trps1: 'cups-scenario:var-trps-1',
    cups: 'cups-scenario:var-cups',
    trps2: 'cups-scenario:var-trps-2',
    conn1: 'cups-scenario:var-conn-1',
    conn2: 'cups-scenario:var-conn-2',
  },
} as const;

const BASE_TRPS: Product = {
  producto_id: 'SAM_TRPS-300-22-Z',
  descripcion_original: 'TRPS-300-22-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  sku: 'TRPS-300-22-Z',
  ala_nominal_mm: 50,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const BASE_CUPS: Product = {
  producto_id: 'SAM_CUPS-300-A-Z',
  descripcion_original: 'CUPS-300-A-Z',
  tipo_pieza: 'curva vertical interior',
  ancho_nominal_mm: 300,
  sku: 'CUPS-300-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const VARIANT_TRPS: Product = {
  producto_id: 'SAM_TRPS-450-20-Z',
  descripcion_original: 'TRPS-450-20-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 450,
  sku: 'TRPS-450-20-Z',
  ala_nominal_mm: 50,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const VARIANT_CUPS: Product = {
  producto_id: 'SAM_CUPS-450-A-Z',
  descripcion_original: 'CUPS-450-A-Z',
  tipo_pieza: 'curva vertical interior',
  ancho_nominal_mm: 450,
  sku: 'CUPS-450-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

function compatOk(portName: string): DirectCompatResult {
  return {
    ok: true,
    needsReduction: false,
    reason: 'cups-test-chain',
    compatibilidadId: null,
    requiredUnion: [],
    evidence: '',
    newPiecePort: portName,
  };
}

/**
 * Construye una cadena TRPS→CUPS→TRPS a partir de productos y offset en Y,
 * usando IDs estables. La cadena arranca en el eje X y entra a la CUPS por
 * P1_horizontal; sale por P2_vertical, donde se pega el segundo recto
 * (horizontal también, pero en la cara opuesta de la CUPS tras la curvatura).
 *
 * Nota técnica: para mantener el escenario simple y la cadena 100% persistida,
 * el tercer tramo (TRPS2) se coloca al vuelo apuntando con la boca P2_vertical
 * de la CUPS como `startPort`. El resultado es un árbol operativo sin cálculo
 * del motor — basta para demostrar preview/confirmed/recovery.
 */
function buildChain(
  trps: Product,
  cups: Product,
  ids: {
    trps1: string;
    cups: string;
    trps2: string;
    conn1: string;
    conn2: string;
  },
  yOffsetMm: number,
): { piezas: Piece[]; conexiones: TrayInput['conexiones'] } {
  const trpsRecipe = resolveRecipe(trps)!;
  const cupsRecipe = resolveRecipe(cups)!;

  // Primer recto entrante.
  const trps1Placed = placeRecipe(trps, trpsRecipe, [0, yOffsetMm, 25], [1, 0, 0], 'native');
  const trps1: Piece = {
    instancia_id: ids.trps1,
    producto_id: trps.producto_id,
    longitud_mm: 3000,
    puertos: {
      P1: {
        posicion_mm: trps1Placed.p1.pos as [number, number, number],
        direccion: trps1Placed.p1.outwardNormal as [number, number, number],
        orientacion_seccion_ws: trps1Placed.p1.vDir as [number, number, number],
      },
      P2: {
        posicion_mm: trps1Placed.p2.pos as [number, number, number],
        direccion: trps1Placed.p2.outwardNormal as [number, number, number],
        orientacion_seccion_ws: trps1Placed.p2.vDir as [number, number, number],
      },
    },
  };

  // CUPS entrando por P1_horizontal.
  const startFromTrps1P2: StartPort = {
    pieceId: ids.trps1,
    portName: 'P2',
    pos: trps1Placed.p2.pos as [number, number, number],
    dir: trps1Placed.p2.outwardNormal as [number, number, number],
    sectionUp: trps1Placed.p2.vDir as [number, number, number],
  };
  const initialInput: TrayInput = {
    version_contrato: 'trazado/1',
    piezas: [trps1],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  };
  const planCups = planAddAccessory(
    initialInput,
    startFromTrps1P2,
    cups,
    compatOk('P1_horizontal'),
    'P1_horizontal',
    'right',
  );
  const cupsPieceWithScenarioId: Piece = {
    ...planCups.newPiece,
    instancia_id: ids.cups,
  };
  const conn1 = {
    ...planCups.newConnection,
    conexion_id: ids.conn1,
    a: [ids.trps1, 'P2'] as [string, string],
    b: [ids.cups, planCups.newConnection.b[1]] as [string, string],
  };

  // Segundo recto desde P2_vertical de la CUPS. Usamos placeRecipe directamente
  // con la boca P2_vertical como startPort — así el tercer tramo hereda el v_dir
  // de la salida CUPS y queda alineado 100%.
  const cupsP2v = cupsPieceWithScenarioId.puertos.P2_vertical;
  const trps2Placed = placeRecipe(
    trps,
    trpsRecipe,
    cupsP2v.posicion_mm as [number, number, number],
    cupsP2v.direccion as [number, number, number],
    'native',
    undefined,
    { sectionUp: cupsP2v.orientacion_seccion_ws as [number, number, number] | undefined },
  );
  const trps2: Piece = {
    instancia_id: ids.trps2,
    producto_id: trps.producto_id,
    longitud_mm: 3000,
    puertos: {
      P1: {
        posicion_mm: trps2Placed.p1.pos as [number, number, number],
        direccion: trps2Placed.p1.outwardNormal as [number, number, number],
        orientacion_seccion_ws: trps2Placed.p1.vDir as [number, number, number],
      },
      P2: {
        posicion_mm: trps2Placed.p2.pos as [number, number, number],
        direccion: trps2Placed.p2.outwardNormal as [number, number, number],
        orientacion_seccion_ws: trps2Placed.p2.vDir as [number, number, number],
      },
    },
  };
  const conn2 = {
    conexion_id: ids.conn2,
    a: [ids.cups, 'P2_vertical'] as [string, string],
    b: [ids.trps2, 'P1'] as [string, string],
  };

  // Nota: referenciamos cupsRecipe para evitar advertencias de variable unused
  // en caso de que la receta de CUPS incluya overrides futuros.
  void cupsRecipe;

  return {
    piezas: [trps1, cupsPieceWithScenarioId, trps2],
    conexiones: [conn1, conn2],
  };
}

/** True si el escenario ya está presente en el input (cualquiera de las dos cadenas). */
export function hasCupsScenario(input: TrayInput): boolean {
  const ids = new Set(input.piezas.map((p) => p.instancia_id));
  return (
    ids.has(CUPS_SCENARIO_IDS.base.trps1) ||
    ids.has(CUPS_SCENARIO_IDS.variant.trps1)
  );
}

/**
 * Devuelve un TrayInput con las cadenas de prueba agregadas al input existente.
 * Idempotente: si el escenario ya existe, retorna el input tal cual. NO muta
 * la entrada original.
 */
export function addCupsTestChains(input: TrayInput): TrayInput {
  if (hasCupsScenario(input)) return input;

  const baseChain = buildChain(BASE_TRPS, BASE_CUPS, CUPS_SCENARIO_IDS.base, 0);
  const variantChain = buildChain(
    VARIANT_TRPS,
    VARIANT_CUPS,
    CUPS_SCENARIO_IDS.variant,
    2000,
  );

  return {
    ...input,
    piezas: [...input.piezas, ...baseChain.piezas, ...variantChain.piezas],
    conexiones: [...input.conexiones, ...baseChain.conexiones, ...variantChain.conexiones],
  };
}
