#!/usr/bin/env node
/**
 * Playwright por tandas (2026-11-13).
 *
 * Por qué: con un solo proceso, los 104 contextos de navegador (WebGL por software)
 * corren en serie y el pico de memoria llega pasada la mitad; en este equipo (8 GB)
 * Claude Code mata la corrida por falta de memoria. Cada tanda es un proceso
 * `playwright test` propio, que levanta sus servidores, arranca limpio y libera al
 * terminar: el techo de memoria queda acotado. No cambia qué se verifica.
 *
 * Uso:
 *   node scripts/e2e-tandas.mjs                 # 4 tandas, todas
 *   node scripts/e2e-tandas.mjs --tandas 5      # otra cantidad de tandas
 *   node scripts/e2e-tandas.mjs --solo 3        # solo la tanda 3 (1-based)
 *   node scripts/e2e-tandas.mjs --archivos a.spec.ts b.spec.ts   # tanda explícita
 *
 * Si una tanda se corta por memoria: partila en dos con --archivos (los archivos de
 * cada tanda quedan impresos al inicio) y seguí. No subir esperas ni desactivar el
 * control de memoria.
 *
 * Logs: e2e/output/tandas/tanda-N.log y tanda-N.json. Al final, resultado combinado.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const valor = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const nTandas = Number(valor('--tandas') ?? 4);
const solo = valor('--solo') ? Number(valor('--solo')) : undefined;
const iArch = args.indexOf('--archivos');
const archivosExplicitos = iArch >= 0 ? args.slice(iArch + 1).filter((a) => !a.startsWith('--')) : undefined;

const PW = join('node_modules', '@playwright', 'test', 'cli.js');
const outDir = join('e2e', 'output', 'tandas');
mkdirSync(outDir, { recursive: true });

function contarPorArchivo() {
  const r = spawnSync(process.execPath, [PW, 'test', '--list', '--reporter=json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`playwright --list falló:\n${r.stderr}`);
  const json = JSON.parse(r.stdout);
  const cuenta = new Map();
  const recorrer = (suite) => {
    for (const s of suite.suites ?? []) recorrer(s);
    for (const spec of suite.specs ?? []) {
      cuenta.set(spec.file, (cuenta.get(spec.file) ?? 0) + (spec.tests?.length ?? 1));
    }
  };
  for (const s of json.suites) recorrer(s);
  return cuenta;
}

function repartir(cuenta, n) {
  // Codicioso: el archivo más grande va a la tanda con menos pruebas.
  const tandas = Array.from({ length: n }, () => ({ archivos: [], pruebas: 0 }));
  const orden = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [archivo, k] of orden) {
    const t = tandas.reduce((min, x) => (x.pruebas < min.pruebas ? x : min));
    t.archivos.push(archivo);
    t.pruebas += k;
  }
  for (const t of tandas) t.archivos.sort();
  return tandas;
}

/** Playwright toma los argumentos como regex: '/' en vez de '\' y puntos escapados. */
const aRegex = (archivo) => `e2e/${archivo}`.replaceAll('\\', '/').replaceAll('.', '\\.') + '$';

let tandas;
if (archivosExplicitos?.length) {
  tandas = [{ archivos: archivosExplicitos, pruebas: NaN }];
} else {
  tandas = repartir(contarPorArchivo(), nTandas);
}

tandas.forEach((t, i) => console.log(`Tanda ${i + 1} (${t.pruebas} pruebas): ${t.archivos.join(' ')}`));

const total = { esperadas: 0, pasaron: 0, fallaron: 0, inestables: 0, omitidas: 0 };
const resumen = [];
for (let i = 0; i < tandas.length; i++) {
  if (solo && solo !== i + 1) continue;
  const n = archivosExplicitos?.length ? 'explicita' : String(i + 1);
  const log = join(outDir, `tanda-${n}.log`);
  const jsonOut = join(outDir, `tanda-${n}.json`);
  console.log(`\n=== Tanda ${n}: ${tandas[i].archivos.length} archivos — log ${log}`);
  const r = spawnSync(
    process.execPath,
    // Los argumentos son expresiones regulares: barras '/' (no '\' de Windows) y puntos escapados.
    [PW, 'test', ...tandas[i].archivos.map((a) => aRegex(a)), '--reporter=list,json'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut } },
  );
  writeFileSync(log, `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n--- salida: ${r.status} señal: ${r.signal}\n`);
  let st = null;
  if (existsSync(jsonOut)) {
    try {
      st = JSON.parse(readFileSync(jsonOut, 'utf8')).stats;
    } catch {
      st = null;
    }
  }
  if (!st) {
    console.log(`Tanda ${n}: SIN RESULTADO (salida ${r.status}, señal ${r.signal}). Ver ${log}`);
    resumen.push({ tanda: n, ok: false });
    total.fallaron += 1;
    continue;
  }
  const t = { esperadas: st.expected, fallaron: st.unexpected, inestables: st.flaky, omitidas: st.skipped };
  const corridasTanda = t.esperadas + t.fallaron + t.inestables + t.omitidas;
  // Una tanda que sale con error o corre menos pruebas que las listadas NO es limpia.
  if (r.status !== 0 && t.fallaron === 0) t.fallaron = 1;
  if (Number.isFinite(tandas[i].pruebas) && corridasTanda !== tandas[i].pruebas) {
    console.log(`Tanda ${n}: corrió ${corridasTanda} de ${tandas[i].pruebas} listadas. Ver ${log}`);
    if (t.fallaron === 0) t.fallaron = 1;
  }
  total.pasaron += t.esperadas;
  total.fallaron += t.fallaron;
  total.inestables += t.inestables;
  total.omitidas += t.omitidas;
  resumen.push({ tanda: n, ...t });
  console.log(`Tanda ${n}: ${t.esperadas} pasaron, ${t.fallaron} fallaron, ${t.inestables} inestables, ${t.omitidas} omitidas`);
}

const corridas = total.pasaron + total.fallaron + total.inestables + total.omitidas;
console.log(
  `\n=== COMBINADO: ${corridas} pruebas — ${total.pasaron} pasaron, ${total.fallaron} fallaron, ` +
    `${total.inestables} inestables, ${total.omitidas} omitidas`,
);
writeFileSync(join(outDir, 'resumen.json'), JSON.stringify({ resumen, total }, null, 2));
const listadas = tandas.reduce((a, t, i) => a + (solo && solo !== i + 1 ? 0 : t.pruebas), 0);
if (Number.isFinite(listadas) && corridas !== listadas) {
  console.log(`ERROR: se listaron ${listadas} pruebas y corrieron ${corridas}.`);
  process.exit(1);
}
process.exit(total.fallaron > 0 || corridas === 0 ? 1 : 0);
