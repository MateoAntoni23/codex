/**
 * A5 — hasta dónde la escena se mueve fluida con la parte civil, en ESTE equipo.
 *
 * Uso:  node tools/civil_fixture/medir_peso.mjs [url]   (por defecto http://localhost:5173)
 *       con la app levantada (npm run dev:trays).
 *
 * Chromium sin ventana con la GPU real (ANGLE D3D11): sin esas opciones usaría
 * SwiftShader (render por software) y los números no representarían al operador.
 *
 * Naves sintéticas de tamaño creciente: prismas (12 triángulos cada uno) repartidos
 * en una planta de 120 m × 60 m, en un solo archivo civil. Para cada tamaño la
 * cámara gira alrededor de la nave durante 4 s (después de 1 s de calentamiento) y
 * se miden los tiempos de cuadro.
 *
 * Criterio de «fluida»: mediana ≥ 30 cuadros por segundo Y percentil 95 del tiempo de
 * cuadro ≤ 50 ms.
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5173';
// Trazado real (7 bandejas) para medir el autoguardado al mover una bandeja.
const TRAZADO = JSON.parse(readFileSync(new globalThis.URL('../../e2e/fixtures/user-report-20261107.workspace.json', import.meta.url), 'utf-8')).trayInput;
const TAMANOS = (process.argv[3] ?? '50000,100000,250000,500000,1000000,2000000,3000000,5000000,8000000').split(',').map(Number);

function malla(triangulos) {
  const n = Math.ceil(triangulos / 12);
  const pos = new Float32Array(n * 8 * 3);
  const idx = new Uint32Array(n * 12 * 3);
  const caras = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const lado = Math.ceil(Math.sqrt(n * 2));
  for (let b = 0; b < n; b++) {
    const x0 = (b % lado) * (120000 / lado);
    const y0 = Math.floor(b / lado) * (60000 / (lado / 2));
    const w = 200;
    const h = 2000 + (b % 7) * 600;
    const v = [[x0, y0, 0], [x0 + w, y0, 0], [x0 + w, y0 + w, 0], [x0, y0 + w, 0], [x0, y0, h], [x0 + w, y0, h], [x0 + w, y0 + w, h], [x0, y0 + w, h]];
    v.forEach((p, i) => pos.set(p, (b * 8 + i) * 3));
    caras.forEach((c, i) => { idx[b * 36 + i] = b * 8 + c; });
  }
  return {
    version: 'codex:civilMalla/1', unidades: { codigo: 'mm', texto: 'milímetro (sintético)' }, solidos: n, vertices: n * 8,
    triangulos: n * 12, tolerancia_mm: 2, caja_mm: { min: [0, 0, 0], max: [120000, 60000, 5600] },
    posiciones: Buffer.from(pos.buffer).toString('base64'), indices: Buffer.from(idx.buffer).toString('base64'),
  };
}

const navegador = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
// Una página nueva por tamaño: cada medición arranca limpia (sin mallas anteriores en memoria).
async function abrir() {
  const p = await navegador.newPage({ viewport: { width: 1366, height: 768 } });
  await p.goto(`${URL}/?etapa=planta`);
  await p.waitForFunction(() => Boolean(window.__codex?.parteCivilStore && window.__codex?.camera), undefined, { timeout: 60_000 });
  return p;
}
let pagina = await abrir();
const gpu = await pagina.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const e = gl?.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'desconocida';
});
console.log(`GPU: ${gpu}`);
console.log('triángulos | mediana fps | p95 cuadro (ms) | fluida | carga (ms) | malla en el archivo (MB) | autoguardado al girar la nave (ms) | autoguardado al mover una bandeja (ms) | registro current (KB)');
const filas = [];
for (const t of TAMANOS) {
  await pagina.close();
  pagina = await abrir();
  const m = { triangulos: Math.ceil(t / 12) * 12, posiciones: { length: Math.ceil(Math.ceil(t / 12) * 96 / 3) * 4 }, indices: { length: Math.ceil(Math.ceil(t / 12) * 144 / 3) * 4 } };
  let caida = false;
  pagina.on('crash', () => { caida = true; });
  await pagina.evaluate((tr) => window.__codex.trayStore.getState().importEdit(tr), TRAZADO);
  let tCarga;
  try {
  tCarga = await pagina.evaluate(async (t) => {
    // La malla se arma DENTRO de la página (no por el protocolo de depuración, que con
    // ~100 MB de texto tira la pestaña y no representa el uso real: fetch o IndexedDB).
    const n = Math.ceil(t / 12);
    const pos = new Float32Array(n * 24);
    const idx = new Uint32Array(n * 36);
    const caras = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
    const lado = Math.ceil(Math.sqrt(n * 2));
    for (let b = 0; b < n; b++) {
      const x0 = (b % lado) * (120000 / lado);
      const y0 = Math.floor(b / lado) * (60000 / (lado / 2));
      const w = 200;
      const h = 2000 + (b % 7) * 600;
      const v = [x0, y0, 0, x0 + w, y0, 0, x0 + w, y0 + w, 0, x0, y0 + w, 0, x0, y0, h, x0 + w, y0, h, x0 + w, y0 + w, h, x0, y0 + w, h];
      pos.set(v, b * 24);
      for (let i = 0; i < 36; i++) idx[b * 36 + i] = b * 8 + caras[i];
    }
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const malla = {
      version: 'codex:civilMalla/1', unidades: { codigo: 'mm', texto: 'milímetro (sintético)' }, solidos: n, vertices: n * 8,
      triangulos: n * 12, tolerancia_mm: 2, caja_mm: { min: [0, 0, 0], max: [120000, 60000, 5600] },
      posiciones: b64(new Uint8Array(pos.buffer)), indices: b64(new Uint8Array(idx.buffer)),
    };
    const t0 = performance.now();
    window.__codex.parteCivilStore.getState().cargar([{
      id: 'medicion', nombre: 'medicion.stp', tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Z',
      desplazamientoMm: [0, 0, 0], giroDeg: 0, malla, importadoEn: '', version: 1,
    }]);
    // Hasta que la malla está en la escena (primer cuadro después de cargar).
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    return performance.now() - t0;
  }, t);
  } catch (e) {
    console.log(`${m.triangulos.toLocaleString('es-AR').padStart(10)} | la pestaña se cayó al cargar (${caida ? 'crash del renderizador' : String(e.message).split(String.fromCharCode(10))[0]})`);
    filas.push({ triangulos: m.triangulos, fps: 0, p95: Infinity, fluida: false, caida: true });
    break;
  }
  const mb = (m.posiciones.length + m.indices.length) / 1048576;
  const r = await pagina.evaluate(() => new Promise((ok) => {
    const cam = window.__codex.camera;
    const ctl = window.__codex.controls;
    const centro = [60, 0, -30];
    ctl?.target.set(...centro);
    const tiempos = [];
    const t0 = performance.now();
    let ant = t0;
    const paso = (ahora) => {
      const a = ((ahora - t0) / 4000) * Math.PI * 2;
      cam.position.set(centro[0] + 110 * Math.cos(a), 45, centro[2] + 110 * Math.sin(a));
      cam.lookAt(...centro);
      ctl?.update();
      if (ahora - t0 > 1000) tiempos.push(ahora - ant);
      ant = ahora;
      if (ahora - t0 < 5000) requestAnimationFrame(paso);
      else {
        tiempos.sort((x, y) => x - y);
        const med = tiempos[Math.floor(tiempos.length / 2)];
        ok({ fps: 1000 / med, p95: tiempos[Math.floor(tiempos.length * 0.95)] });
      }
    };
    requestAnimationFrame(paso);
  }));
  // Autoguardado: un cambio cualquiera del proyecto con esta parte civil cargada → hasta «Guardado».
  const tGuardado = await pagina.evaluate(async () => {
    const leer = () => document.querySelector('[data-testid="project-save-status"]')?.getAttribute('data-phase');
    const t0 = performance.now();
    window.__codex.parteCivilStore.getState().actualizar('medicion', { giroDeg: Math.random() });
    while (leer() !== 'saving' && performance.now() - t0 < 2000) await new Promise((ok) => setTimeout(ok, 20));
    while (leer() !== 'saved' && performance.now() - t0 < 120000) await new Promise((ok) => setTimeout(ok, 20));
    return leer() === 'saved' ? performance.now() - t0 - 500 : NaN; // menos el retardo de 500 ms del autoguardado
  });
  // Mover una bandeja (R1, 100 mm en X): el caso de todos los días. No debe depender de la nave.
  const tBandeja = [];
  for (let k = 0; k < 5; k++) {
    tBandeja.push(await pagina.evaluate(async (k) => {
      const leer = () => document.querySelector('[data-testid="project-save-status"]')?.getAttribute('data-phase');
      while (leer() !== 'saved') await new Promise((ok) => setTimeout(ok, 20));
      const ts = window.__codex.trayStore.getState();
      const e = structuredClone(ts.entrada);
      const r1 = e.piezas.find((p) => p.instancia_id === 'R1');
      for (const port of Object.values(r1.puertos)) port.posicion_mm[0] += k % 2 ? -100 : 100;
      const t0 = performance.now();
      ts.edit(e);
      while (leer() !== 'saving' && performance.now() - t0 < 2000) await new Promise((ok) => setTimeout(ok, 5));
      while (leer() !== 'saved' && performance.now() - t0 < 120000) await new Promise((ok) => setTimeout(ok, 5));
      return leer() === 'saved' ? performance.now() - t0 - 500 : NaN;
    }, k));
  }
  tBandeja.sort((a, b) => a - b);
  const medBandeja = tBandeja[2];
  const kbCurrent = await pagina.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('codex-workspace-v1');
    r.onsuccess = () => {
      const g = r.result.transaction('project').objectStore('project').get('current');
      g.onsuccess = () => { ok(JSON.stringify(g.result).length / 1024); r.result.close(); };
    };
  }));
  const fluida = r.fps >= 30 && r.p95 <= 50;
  filas.push({ triangulos: m.triangulos, ...r, fluida });
  console.log(`${m.triangulos.toLocaleString('es-AR').padStart(10)} | ${r.fps.toFixed(1).padStart(11)} | ${r.p95.toFixed(1).padStart(15)} | ${(fluida ? 'sí' : 'no').padStart(6)} | ${tCarga.toFixed(0).padStart(10)} | ${mb.toFixed(1).padStart(24)} | ${Number.isNaN(tGuardado) ? 'no terminó en 2 min' : tGuardado.toFixed(0)} | ${medBandeja.toFixed(0)} | ${kbCurrent.toFixed(0)}`);
}
await navegador.close();
const ultimo = filas.filter((f) => f.fluida).pop();
console.log(`Mayor tamaño fluido medido: ${ultimo ? ultimo.triangulos.toLocaleString('es-AR') : 'ninguno'} triángulos`);
