/**
 * Regresiones de la auditoría de v0.2.1, hallazgo 7 (cliente TypeScript).
 * Ejecutar: node --experimental-strip-types --test integracion/ts/auditoria_v021.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GestorSolicitudes } from "./gestorSolicitudes.ts";
import type { Solicitud } from "./contrato.ts";

const vector = (n: string) =>
  JSON.parse(readFileSync(new URL(`../vectores/${n}.json`, import.meta.url), "utf8")) as {
    solicitud: Solicitud; respuesta: Record<string, unknown>;
  };

/** Responde con `base` modificada por `cambio`, con el eco de la solicitud real (salvo que `cambio` lo pise). */
function transporte(base: Record<string, unknown>, cambio: (r: Record<string, unknown>) => void) {
  return async (s: Solicitud) => {
    const r: Record<string, unknown> = { ...base, tipo: s.tipo, solicitud_id: s.solicitud_id, clave: s.clave,
                                         revision_entrada: s.revision_entrada };
    cambio(r);
    return r;
  };
}

const sector = vector("sector_caso1");
const trazado = vector("trazado_ejemplo");

test("H7a: estado desconocido se rechaza", async () => {
  const g = new GestorSolicitudes(transporte(sector.respuesta, (r) => { r.estado = "inventado"; }));
  const d = await g.calcular("sector", "S1", sector.solicitud.entrada);
  assert.equal(d.tipo, "rechazada");
  assert.equal(d.tipo === "rechazada" && d.motivo, "respuesta_malformada");
});

test("H7b: respuesta ok sin resultado se rechaza sin lanzar excepción", async () => {
  const g = new GestorSolicitudes(transporte(sector.respuesta, (r) => { delete r.resultado; }));
  const d = await g.calcular("sector", "S1", sector.solicitud.entrada);
  assert.equal(d.tipo, "rechazada");
  assert.equal(d.tipo === "rechazada" && d.motivo, "respuesta_malformada");
});

test("H7b': resultado no objeto, huella ausente o error sin objeto error se rechazan", async () => {
  const casos: Array<(r: Record<string, unknown>) => void> = [
    (r) => { r.resultado = null; },
    (r) => { r.resultado = "x"; },
    (r) => { delete r.huella; },
    (r) => { r.estado = "error"; delete r.resultado; },
    (r) => { r.estado = "error"; r.error = { codigo: 3 }; },
  ];
  for (const c of casos) {
    const g = new GestorSolicitudes(transporte(sector.respuesta, c));
    const d = await g.calcular("sector", "S1", sector.solicitud.entrada);
    assert.equal(d.tipo, "rechazada", String(c));
  }
});

test("H7c: una respuesta tipo 'sector' no se aplica a una solicitud 'trazado'", async () => {
  const g = new GestorSolicitudes(transporte(sector.respuesta, (r) => { r.tipo = "sector"; }));
  const d = await g.calcular("trazado", "T1", trazado.solicitud.entrada);
  assert.equal(d.tipo, "rechazada");
  assert.equal(d.tipo === "rechazada" && d.motivo, "eco_inconsistente");
});

test("H7c': eco sin tipo se rechaza", async () => {
  const g = new GestorSolicitudes(transporte(trazado.respuesta, (r) => { delete r.tipo; }));
  const d = await g.calcular("trazado", "T1", trazado.solicitud.entrada);
  assert.equal(d.tipo, "rechazada");
});

test("control: respuestas correctas de ambos tipos se aplican", async () => {
  const g = new GestorSolicitudes(transporte(trazado.respuesta, () => {}));
  assert.equal((await g.calcular("trazado", "T1", trazado.solicitud.entrada)).tipo, "aplicada");
  const h = new GestorSolicitudes(transporte(sector.respuesta, () => {}));
  assert.equal((await h.calcular("sector", "S1", sector.solicitud.entrada)).tipo, "aplicada");
  const e = vector("sector_error_cantidad");
  const k = new GestorSolicitudes(transporte(e.respuesta, () => {}));
  assert.equal((await k.calcular("sector", "S2", e.solicitud.entrada)).tipo, "aplicada");
});
