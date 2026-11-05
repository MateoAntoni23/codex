/**
 * Tipos del contrato `motor_bandejas/1.0` (ver motor_bandejas/contrato.py y docs/esquemas/).
 *
 * Este archivo NO reimplementa fórmulas: el cálculo vive en el motor Python. Si alguna vez se porta el
 * motor a TypeScript, debe pasar los vectores de integracion/vectores/ con resultados idénticos.
 */

export const VERSION_CONTRATO = "1.0" as const;

export type TipoCalculo = "sector" | "trazado";

export interface Solicitud<E = Record<string, unknown>> {
  version_contrato: typeof VERSION_CONTRATO;
  tipo: TipoCalculo;
  solicitud_id: string;
  /** Identificador estable del sector o trazado en el CAD. */
  clave: string;
  /** Contador monotónico de revisiones de entrada de esa clave. */
  revision_entrada: number;
  entrada: E;
}

export interface ErrorMotor {
  codigo: string;
  mensaje: string;
  campo: string | null;
  decision_id?: string | null;
  problemas?: unknown[];
  version_error: string;
}

interface Eco {
  version_contrato: string;
  version_motor: string;
  tipo: TipoCalculo | null;
  solicitud_id: string | null;
  clave: string | null;
  revision_entrada: number | null;
}

export interface RespuestaOk<R = ResultadoGenerico> extends Eco {
  estado: "ok";
  huella: string;
  resultado: R;
}

export interface RespuestaError extends Eco {
  estado: "error";
  error: ErrorMotor;
}

export type Respuesta<R = ResultadoGenerico> = RespuestaOk<R> | RespuestaError;

/** Campos que la UI necesita sin depender del resto del resultado. */
export interface ResultadoGenerico {
  huella: string;
  vigencia: "VIGENTE" | "DESACTUALIZADO";
  verificacion_electrica: { estado: "NO_REALIZADA"; aviso: string };
  [k: string]: unknown;
}

export type EstadoCandidato =
  | "APTA_GEOMETRIA_Y_MECANICA"
  | "PRESELECCION_CONDICIONADA"
  | "NO_APTA_MECANICA"
  | "NO_VERIFICABLE_GEOMETRIA"
  | "NO_APTA_GEOMETRIA";

export type EstadoTrazado = "PRESELECCION_CONDICIONADA" | "CON_BLOQUEOS" | "CON_INCUMPLIMIENTOS";
