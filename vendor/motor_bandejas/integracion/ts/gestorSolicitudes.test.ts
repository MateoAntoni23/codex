/**
 * Pruebas del cliente TypeScript con los vectores generados por el motor Python (integracion/vectores).
 * Ejecutar: node --experimental-strip-types --test integracion/ts/gestorSolicitudes.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GestorSolicitudes } from "./gestorSolicitudes.ts";
import type { Solicitud } from "./contrato.ts";
import { presentarCandidato, presentarTrazado, seleccionPermitida } from "./presentacion.ts";

const vector = (n: string) =>
  JSON.parse(readFileSync(new URL(`../vectores/${n}.json`, import.meta.url), "utf8")) as {
    solicitud: Solicitud; respuesta: Record<string, unknown>;
  };

/** Transporte falso: responde con el vector, reescribiendo el eco con la solicitud real. */
function transporteEco(respuestaBase: Record<string, unknown>, demoraMs: number) {
  return (s: Solicitud) =>
    new Promise<unknown>((ok) =>
      setTimeout(() => ok({ ...respuestaBase, solicitud_id: s.solicitud_id, clave: s.clave, revision_entrada: s.revision_entrada }), demoraMs));
}

test("una respuesta vigente se aplica", async () => {
  const v = vector("sector_caso1");
  const g = new GestorSolicitudes(transporteEco(v.respuesta, 1));
  const d = await g.calcular("sector", "S1", v.solicitud.entrada);
  assert.equal(d.tipo, "aplicada");
});

test("la respuesta vieja que llega tarde se descarta", async () => {
  const v = vector("sector_caso1");
  let n = 0;
  // primera solicitud tarda 30 ms, la segunda 1 ms: llegan desordenadas
  const g = new GestorSolicitudes((s) => transporteEco(v.respuesta, n++ === 0 ? 30 : 1)(s));
  const p1 = g.calcular("sector", "S1", v.solicitud.entrada);
  const p2 = g.calcular("sector", "S1", v.solicitud.entrada);
  const [d1, d2] = await Promise.all([p1, p2]);
  assert.deepEqual(d1, { tipo: "descartada", motivo: "revision_antigua" });
  assert.equal(d2.tipo, "aplicada");
});

test("invalidar descarta lo que estaba en vuelo", async () => {
  const v = vector("trazado_ejemplo");
  const g = new GestorSolicitudes(transporteEco(v.respuesta, 10));
  const p = g.calcular("trazado", "T1", v.solicitud.entrada);
  g.invalidar("T1");
  assert.deepEqual(await p, { tipo: "descartada", motivo: "clave_invalidada" });
});

test("claves independientes no se pisan", async () => {
  const v = vector("sector_caso1");
  const g = new GestorSolicitudes(transporteEco(v.respuesta, 1));
  const [a, b] = await Promise.all([g.calcular("sector", "A", {}), g.calcular("sector", "B", {})]);
  assert.equal(a.tipo, "aplicada");
  assert.equal(b.tipo, "aplicada");
});

test("se rechaza otra versión de contrato y respuestas malformadas", async () => {
  const v = vector("sector_caso1");
  const g = new GestorSolicitudes(transporteEco({ ...v.respuesta, version_contrato: "2.0" }, 1));
  const d = await g.calcular("sector", "S1", {});
  assert.equal(d.tipo, "rechazada");
  assert.equal(new GestorSolicitudes(async () => 42).recibir(42).tipo, "rechazada");
});

test("los errores del motor llegan con código versionado", async () => {
  const v = vector("sector_error_cantidad");
  const g = new GestorSolicitudes(transporteEco(v.respuesta, 1));
  const d = await g.calcular("sector", "S1", v.solicitud.entrada);
  assert.equal(d.tipo, "aplicada");
  if (d.tipo === "aplicada" && d.respuesta.estado === "error") {
    assert.equal(d.respuesta.error.codigo, "ENTRADA_INVALIDA");
    assert.equal(d.respuesta.error.version_error, "1");
  } else assert.fail("se esperaba respuesta de error");
});

test("ningún estado se presenta como aprobación", () => {
  const v = vector("trazado_ejemplo");
  const res = (v.respuesta as { resultado: { resumen: { estado_trazado: "CON_BLOQUEOS"; decisiones_que_bloquean: string[] } } }).resultado;
  const p = presentarTrazado(res.resumen.estado_trazado, res.resumen.decisiones_que_bloquean);
  assert.equal(p.esAprobacion, false);
  assert.match(p.nota, /no aprueba/);
  for (const e of ["APTA_GEOMETRIA_Y_MECANICA", "PRESELECCION_CONDICIONADA", "NO_APTA_MECANICA"] as const) {
    const c = presentarCandidato(e, ["ANCHO_NOMINAL_NO_UTIL"]);
    assert.equal(c.esAprobacion, false);
    assert.doesNotMatch(c.etiqueta, /^Aprobad/i);
  }
  assert.equal(seleccionPermitida("DESACTUALIZADO", "PRESELECCION_CONDICIONADA"), false);
  assert.equal(seleccionPermitida("VIGENTE", "NO_APTA_GEOMETRIA"), false);
});
