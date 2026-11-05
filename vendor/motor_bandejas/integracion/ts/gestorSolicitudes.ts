/**
 * Gestor de solicitudes al motor: una revisión vigente por clave (sector/trazado).
 *
 * - Cada cambio de entrada en el CAD incrementa la revisión de su clave y dispara una solicitud.
 * - Una respuesta se APLICA solo si coincide con la última solicitud emitida para esa clave
 *   (misma solicitud_id y misma revisión). Si llega una respuesta vieja, se DESCARTA.
 * - Al invalidar una clave (cambio de entrada todavía no recalculado) la UI debe mostrar el resultado
 *   previo como desactualizado y borrar la selección asociada.
 * - Respuestas con otra versión de contrato se rechazan.
 *
 * Integración prevista con Zustand (no verificada: el editor no estuvo disponible): el store guarda
 * `revision` y `resultado` por clave; el gestor llama a `aplicar` solo con respuestas vigentes.
 */
import { VERSION_CONTRATO } from "./contrato.ts";
import type { Respuesta, Solicitud, TipoCalculo } from "./contrato.ts";

export type Transporte = (s: Solicitud) => Promise<unknown>;

export type Desenlace =
  | { tipo: "aplicada"; respuesta: Respuesta }
  | { tipo: "descartada"; motivo: "revision_antigua" | "solicitud_reemplazada" | "clave_invalidada" }
  | { tipo: "rechazada"; motivo: "version_contrato" | "eco_inconsistente" | "respuesta_malformada"; detalle: string }
  | { tipo: "fallo_transporte"; detalle: string };

interface Pendiente {
  solicitud_id: string;
  revision: number;
  tipo: TipoCalculo;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const esTexto = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/**
 * Validación en tiempo de ejecución del sobre de respuesta (v0.2.2, auditoría H7). Los tipos de TypeScript no
 * existen en tiempo de ejecución: una respuesta del transporte es `unknown` hasta pasar este control.
 * Devuelve null si el sobre es válido o el motivo del rechazo.
 */
export function validarSobre(c: unknown): string | null {
  if (!esObjeto(c)) return "la respuesta no es un objeto";
  if (c.estado !== "ok" && c.estado !== "error") return `estado desconocido: ${String(c.estado)}`;
  if (c.tipo !== "sector" && c.tipo !== "trazado") return `tipo de eco inválido: ${String(c.tipo)}`;
  if (!esTexto(c.clave) || !esTexto(c.solicitud_id)) return "eco sin clave o solicitud_id";
  if (typeof c.revision_entrada !== "number" || !Number.isInteger(c.revision_entrada) || c.revision_entrada < 0) {
    return "revision_entrada inválida";
  }
  if (c.estado === "ok") {
    if (!esTexto(c.huella)) return "respuesta ok sin huella";
    if (!esObjeto(c.resultado)) return "respuesta ok sin resultado";
  } else {
    const e = c.error;
    if (!esObjeto(e) || !esTexto(e.codigo) || typeof e.mensaje !== "string" || !esTexto(e.version_error)) {
      return "respuesta de error sin objeto error válido";
    }
  }
  return null;
}

export class GestorSolicitudes {
  private readonly ultima = new Map<string, Pendiente>();
  private readonly revisiones = new Map<string, number>();
  private secuencia = 0;
  private readonly transporte: Transporte;
  private readonly prefijo: string;

  constructor(transporte: Transporte, prefijo = "cad") {
    this.transporte = transporte;
    this.prefijo = prefijo;
  }

  /** Revisión actual conocida de una clave (−1 si nunca se pidió). */
  revision(clave: string): number {
    return this.revisiones.get(clave) ?? -1;
  }

  /** Marca la clave como modificada sin recalcular: toda respuesta en vuelo queda obsoleta. */
  invalidar(clave: string): number {
    const r = this.revision(clave) + 1;
    this.revisiones.set(clave, r);
    this.ultima.delete(clave);
    return r;
  }

  async calcular(tipo: TipoCalculo, clave: string, entrada: Record<string, unknown>): Promise<Desenlace> {
    const revision = this.revision(clave) + 1;
    this.revisiones.set(clave, revision);
    const solicitud_id = `${this.prefijo}-${++this.secuencia}`;
    this.ultima.set(clave, { solicitud_id, revision, tipo });
    const sol: Solicitud = { version_contrato: VERSION_CONTRATO, tipo, solicitud_id, clave, revision_entrada: revision, entrada };
    let crudo: unknown;
    try {
      crudo = await this.transporte(sol);
    } catch (e) {
      return { tipo: "fallo_transporte", detalle: String(e) };
    }
    return this.recibir(crudo);
  }

  /** Decide si una respuesta (posiblemente tardía o desordenada) se aplica. */
  recibir(crudo: unknown): Desenlace {
    if (!esObjeto(crudo)) {
      return { tipo: "rechazada", motivo: "respuesta_malformada", detalle: "la respuesta no es un objeto" };
    }
    if (crudo.version_contrato !== VERSION_CONTRATO) {
      return { tipo: "rechazada", motivo: "version_contrato", detalle: String(crudo.version_contrato) };
    }
    const problema = validarSobre(crudo);
    if (problema !== null) {
      return { tipo: "rechazada", motivo: "respuesta_malformada", detalle: problema };
    }
    const r = crudo as unknown as Respuesta;
    const clave = r.clave as string;
    const revision_entrada = r.revision_entrada as number;
    const vigente = this.ultima.get(clave);
    if (vigente === undefined) {
      return { tipo: "descartada", motivo: "clave_invalidada" };
    }
    if (revision_entrada < vigente.revision) {
      return { tipo: "descartada", motivo: "revision_antigua" };
    }
    if (r.solicitud_id !== vigente.solicitud_id || revision_entrada !== vigente.revision) {
      return { tipo: "descartada", motivo: "solicitud_reemplazada" };
    }
    if (r.tipo !== vigente.tipo) {
      return { tipo: "rechazada", motivo: "eco_inconsistente", detalle: `tipo ${String(r.tipo)} ≠ solicitado ${vigente.tipo}` };
    }
    if (r.estado === "ok" && r.huella !== (r.resultado as { huella?: unknown }).huella) {
      return { tipo: "rechazada", motivo: "eco_inconsistente", detalle: "huella del sobre ≠ huella del resultado" };
    }
    return { tipo: "aplicada", respuesta: r };
  }
}

/** Transporte HTTP hacia motor_bandejas.servicio. */
export function transporteHttp(base: string, f: typeof fetch = fetch): Transporte {
  return async (s) => {
    const resp = await f(`${base}/v1/calcular`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json();
  };
}
