// Puente de catálogo importado (ELS-IMP-EQCX) → EquipmentElement del dominio.
//
// Reglas de identidad (clave para reimportación):
//   - element.id = equipo.equipoId. El libro es autoridad sobre el ID externo.
//   - importedRef.equipoId == element.id cuando el elemento nace de un import.
//     (Cuando el usuario *vincula* un elemento preexistente a un equipo importado,
//     element.id se conserva y sólo se setea importedRef — por eso ambos campos
//     existen por separado.)
//   - importedRef.libroId = LibroMeta.fileHash del libro origen; permite distinguir
//     equipoIds iguales nacidos de archivos distintos.
//
// Categorías: el contrato define 22 categorías de equipo; el dominio v2 maneja 13.
// El mapeo es explícito; cualquier valor desconocido cae en 'infrastructure' para
// ser visible y editable, nunca silenciado.

import type { Category, EquipmentElement, Geometry, Vec3 } from '../types/domain-v2';
import { IDENTITY_QUATERNION } from '../types/domain-v2';
import type { EquipoImportado } from './types';

// ─── Mapeo 22 → 13 ────────────────────────────────────────────────────────────

const CATEGORIA_TO_DOMAIN: Record<string, Category> = {
  TABLERO: 'electrical_panel',
  TABLERO_NEUMATICO: 'pneumatic_panel',
  TABLERO_HMI: 'electrical_panel',
  CAJA_DERIVACION: 'electrical_panel',
  RACK_RED: 'electrical_panel',
  MOTOR: 'motor',
  INSTRUMENTO_TRANSMISOR: 'sensor',
  SENSOR_DISCRETO: 'sensor',
  VALVULA_MODULANTE: 'process_valve',
  VALVULA_ONOFF: 'process_valve',
  VALVULA_SOLENOIDE: 'solenoid_valve',
  VALVULA_PROCESO_NEUMATICA: 'process_valve',
  SOLENOIDE_CAMPO: 'solenoid_valve',
  ACTUADOR: 'actuator',
  PARADA_EMERGENCIA: 'pushbutton',
  PROYECTOR: 'luminaire',
  LUMINARIA_EMERGENCIA: 'luminaire',
  CAMARA: 'sensor',
  BOTONERA: 'pushbutton',
  BALIZA: 'luminaire',
  EQUIPO_EXISTENTE_TERCEROS: 'infrastructure',
  OTRO: 'infrastructure',
};

export function mapImportCategoria(c: string): Category {
  return CATEGORIA_TO_DOMAIN[c] ?? 'infrastructure';
}

/** Altura vertical (mm) del centro a la base, para apoyar el elemento en el piso (z_domain=0). */
export function floorRestingHalfHeightMm(geom: Geometry): number {
  switch (geom.kind) {
    case 'box':      return geom.heightMm / 2;
    case 'cylinder': return geom.lengthMm / 2;
    case 'plane':    return 0;
    case 'asset':    return geom.boundsMm.z / 2;
  }
}

// ─── Geometría por defecto por categoría (mm) ────────────────────────────────
// Valores conservadores; el usuario los ajusta en el inspector después de colocar.

export const DEFAULT_GEOMETRY: Record<Category, Geometry> = {
  electrical_panel: { kind: 'box', widthMm: 600, depthMm: 400, heightMm: 2000 },
  pneumatic_panel:  { kind: 'box', widthMm: 600, depthMm: 400, heightMm: 1800 },
  motor:            { kind: 'cylinder', diameterMm: 300, lengthMm: 500 },
  pump:             { kind: 'cylinder', diameterMm: 300, lengthMm: 400 },
  sensor:           { kind: 'box', widthMm: 100, depthMm: 60,  heightMm: 120 },
  process_valve:    { kind: 'box', widthMm: 200, depthMm: 200, heightMm: 300 },
  solenoid_valve:   { kind: 'box', widthMm: 100, depthMm: 100, heightMm: 150 },
  actuator:         { kind: 'cylinder', diameterMm: 150, lengthMm: 300 },
  luminaire:        { kind: 'box', widthMm: 400, depthMm: 400, heightMm: 200 },
  pushbutton:       { kind: 'box', widthMm: 80,  depthMm: 80,  heightMm: 80 },
  terminal_block:   { kind: 'box', widthMm: 200, depthMm: 100, heightMm: 100 },
  manifold:         { kind: 'box', widthMm: 400, depthMm: 200, heightMm: 200 },
  infrastructure:   { kind: 'box', widthMm: 1000, depthMm: 1000, heightMm: 1000 },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unknownDatum<T>(): { value: T | null; status: 'unknown'; evidenceIds: string[] } {
  return { value: null, status: 'unknown', evidenceIds: [] };
}

type AnyTechnical = EquipmentElement['technical'];

function defaultTechnical(cat: Category): AnyTechnical {
  switch (cat) {
    case 'motor':
      return {
        power:        unknownDatum(),
        voltage:      unknownDatum(),
        phases:       unknownDatum(),
        plateCurrent: unknownDatum(),
        efficiency:   unknownDatum(),
        powerFactor:  unknownDatum(),
        start:        unknownDatum(),
      } as AnyTechnical;
    case 'sensor':
      return {
        measuredVariable: unknownDatum(),
        range:            unknownDatum(),
        supply:           unknownDatum(),
        signal:           unknownDatum(),
      } as AnyTechnical;
    case 'process_valve':
      return {
        function:    unknownDatum(),
        nominalSize: unknownDatum(),
        connection:  unknownDatum(),
        fluid:       unknownDatum(),
        pressure:    unknownDatum(),
        temperature: unknownDatum(),
      } as AnyTechnical;
    case 'solenoid_valve':
      return {
        configuration:     unknownDatum(),
        coilSupply:        unknownDatum(),
        operatingPressure: unknownDatum(),
        normalState:       unknownDatum(),
      } as AnyTechnical;
    case 'actuator':
      return {
        technology:      unknownDatum(),
        action:          unknownDatum(),
        motion:          unknownDatum(),
        stroke:          unknownDatum(),
        bore:            unknownDatum(),
        torque:          unknownDatum(),
        workingPressure: unknownDatum(),
      } as AnyTechnical;
    case 'electrical_panel':
      return {
        ipRating:     unknownDatum(),
        ratedCurrent: unknownDatum(),
      } as AnyTechnical;
    case 'pneumatic_panel':
      return {
        ipRating:      unknownDatum(),
        inletPressure: unknownDatum(),
      } as AnyTechnical;
    case 'pump':
      return {
        flow:  unknownDatum(),
        head:  unknownDatum(),
        fluid: unknownDatum(),
      } as AnyTechnical;
    case 'luminaire':
      return {
        power:    unknownDatum(),
        voltage:  unknownDatum(),
        ipRating: unknownDatum(),
      } as AnyTechnical;
    case 'pushbutton':
      return {
        function:     unknownDatum(),
        contacts:     unknownDatum(),
        illumination: unknownDatum(),
      } as AnyTechnical;
    case 'terminal_block':
      return { terminalCount: unknownDatum() } as AnyTechnical;
    case 'manifold':
      return {
        stationCount:    unknownDatum(),
        workingPressure: unknownDatum(),
      } as AnyTechnical;
    case 'infrastructure':
      return { role: unknownDatum() } as AnyTechnical;
  }
}

function conditionFromEstadoAlcance(estado: string): EquipmentElement['condition'] {
  switch (estado) {
    case 'NUEVO':      return 'new';
    case 'EXISTENTE':
    case 'REUBICADO':
    case 'MODIFICADO': return 'existing';
    case 'REEMPLAZO':  return 'replacement';
    default:           return 'unknown';
  }
}

function lifecycleFromEstadoAlcance(estado: string): EquipmentElement['lifecycle'] {
  return estado === 'RETIRADO' ? 'retired' : 'active';
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** fileHash del libro de origen — se almacena en importedRef.libroId. */
  libroId: string;
  /** Si se provee, el elemento nace 'placed' en esa posición; si no, 'unplaced'. */
  positionMm?: Vec3 | null;
}

/**
 * Construye un EquipmentElement a partir de un EquipoImportado.
 * - Usa equipoId como element.id (identidad externa estable).
 * - Setea importedRef{equipoId,libroId}.
 * - Asigna geometría por defecto para la categoría mapeada.
 * - Ficha técnica con todos los datums en 'unknown' (los atributos importados
 *   se leen del catálogo por separado hasta que el usuario decida transferir
 *   valores a la ficha).
 */
export function buildElementFromImported(
  equipo: EquipoImportado,
  options: BuildOptions,
): EquipmentElement {
  const category = mapImportCategoria(equipo.categoria);
  const geometry = DEFAULT_GEOMETRY[category];

  const placement = options.positionMm
    ? {
        placementStatus: 'placed' as const,
        transform: {
          positionMm: { ...options.positionMm },
          rotation: { ...IDENTITY_QUATERNION },
        },
      }
    : { placementStatus: 'unplaced' as const, transform: null };

  const element = {
    id: equipo.equipoId,
    tag: equipo.tag || null,
    aliases: [],
    name: equipo.descripcion?.trim() || equipo.tag || equipo.equipoId,
    physicalLocation: {
      kind: 'unassigned' as const,
      factoryId: null,
      subareaId: null,
      description: null,
    },
    condition: conditionFromEstadoAlcance(equipo.estadoAlcance),
    lifecycle: lifecycleFromEstadoAlcance(equipo.estadoAlcance),
    parentId: null,
    geometry,
    mounting: 'unknown' as const,
    manufacturer: unknownDatum<string>(),
    model: unknownDatum<string>(),
    version: 1,
    importedRef: { equipoId: equipo.equipoId, libroId: options.libroId },
    ...placement,
    category,
    technical: defaultTechnical(category),
  };

  return element as EquipmentElement;
}
