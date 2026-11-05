/**
 * Presentación de estados para la UI. Regla: ningún estado del motor se muestra como "aprobado".
 * `esAprobacion` es siempre false: el motor no aprueba instalaciones.
 */
import type { EstadoCandidato, EstadoTrazado } from "./contrato.ts";

export type Severidad = "info" | "condicionado" | "bloqueo" | "incumplimiento";

export interface Presentacion {
  etiqueta: string;
  severidad: Severidad;
  esAprobacion: false;
  nota: string;
}

const NOTA_GENERAL =
  "Resultado de preselección: no aprueba la instalación ni verifica eléctricamente. Revisar condiciones y pendientes.";

const CANDIDATO: Record<EstadoCandidato, Omit<Presentacion, "esAprobacion" | "nota">> = {
  APTA_GEOMETRIA_Y_MECANICA: { etiqueta: "Geometría y carga verificadas con datos acreditados (sin aprobación)", severidad: "info" },
  PRESELECCION_CONDICIONADA: { etiqueta: "Preselección condicionada", severidad: "condicionado" },
  NO_APTA_MECANICA: { etiqueta: "No apta por carga", severidad: "incumplimiento" },
  NO_VERIFICABLE_GEOMETRIA: { etiqueta: "Geometría no verificable", severidad: "bloqueo" },
  NO_APTA_GEOMETRIA: { etiqueta: "No apta por geometría", severidad: "incumplimiento" },
};

const TRAZADO: Record<EstadoTrazado, Omit<Presentacion, "esAprobacion" | "nota">> = {
  PRESELECCION_CONDICIONADA: { etiqueta: "Trazado en preselección condicionada", severidad: "condicionado" },
  CON_BLOQUEOS: { etiqueta: "Trazado con decisiones pendientes", severidad: "bloqueo" },
  CON_INCUMPLIMIENTOS: { etiqueta: "Trazado con incumplimientos", severidad: "incumplimiento" },
};

export function presentarCandidato(estado: EstadoCandidato, condiciones: readonly string[]): Presentacion {
  const p = CANDIDATO[estado];
  const cond = condiciones.length ? ` Condiciones: ${condiciones.join(", ")}.` : "";
  return { ...p, esAprobacion: false, nota: NOTA_GENERAL + cond };
}

export function presentarTrazado(estado: EstadoTrazado, pendientes: readonly string[]): Presentacion {
  const p = TRAZADO[estado];
  const pend = pendientes.length ? ` Pendientes: ${pendientes.join(", ")}.` : "";
  return { ...p, esAprobacion: false, nota: NOTA_GENERAL + pend };
}

/** Un resultado con vigencia ≠ VIGENTE no debe permitir selección ni mostrarse como actual. */
export function seleccionPermitida(vigencia: string, estado: EstadoCandidato): boolean {
  return vigencia === "VIGENTE" && (estado === "APTA_GEOMETRIA_Y_MECANICA" || estado === "PRESELECCION_CONDICIONADA");
}
