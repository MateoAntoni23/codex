/**
 * E2E — etapa 3, parte A: los circuitos de potencia viajan al motor (2026-11-13).
 *
 * Con gestos reales:
 *   1. Dos equipos, un trazado entre ellos (recto → curva plana 90 → recto) y un enlace en cada punta.
 *   2. Un circuito de potencia con cable y cantidad (Sintenax tripolar 3 × 50 mm², × 2) y uno de
 *      maniobra (tetrapolar 4 × 2,5 mm²) entre los mismos equipos.
 *   3. Calcular con el motor real (reserva 20 %): el motor devuelve ocupación y reserva de cada pieza
 *      y se ven en pantalla, iguales a lo que devolvió. El PE viaja armado desde el trazado
 *      (D-20 16 mm², D-21 verde/amarillo) y el motor informa cobertura completa.
 *   4. El circuito de maniobra aparece con su longitud y con el motivo por el que no se calcula (D-11).
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');

type V3 = [number, number, number];
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string }> }; result: Record<string, unknown> | null; status: string } };
    workspaceStore: { getState: () => { elements: Array<{ id: string; name: string }> } };
  };
};
const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const elementos = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.workspaceStore.getState().elements);
const resultado = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().result);

async function abrir(page: Page) {
  await page.goto('/?etapa=equipos');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

async function crearEquipo(page: Page, nombre: string, pos: V3): Promise<string> {
  const antes = (await elementos(page)).length;
  await page.getByTestId('new-equipment').click();
  const form = page.getByTestId('new-equipment-form');
  await form.locator('#paf-cat').selectOption('electrical_panel');
  await form.locator('#paf-name').fill(nombre);
  await form.locator('input[value="placed"]').check();
  await form.locator('#paf-x').fill(String(pos[0]));
  await form.locator('#paf-y').fill(String(pos[1]));
  await form.locator('#paf-z').fill(String(pos[2]));
  await form.getByRole('button', { name: 'Crear' }).click();
  await expect.poll(async () => (await elementos(page)).length).toBe(antes + 1);
  return (await elementos(page)).find((e) => e.name === nombre)!.id;
}

async function continueFrom(page: Page, freeEnd: RegExp, productoId: string, opts: { side?: 'left' | 'right'; length?: number } = {}) {
  const before = (await piezas(page)).length;
  await page.getByTestId('free-end').filter({ hasText: freeEnd }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  if (opts.side) await page.locator(`[data-codex-routing-hand="${opts.side}"]`).click();
  if (opts.length) await page.locator('[data-codex-routing-length-input]').fill(String(opts.length));
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

async function enlazar(page: Page, equipoId: string, tronco: string, desde: 'P1' | 'P2', distancia: number, lado: 'izquierda' | 'derecha') {
  const form = page.getByTestId('baj-form');
  await form.getByTestId('baj-equipo').selectOption(equipoId);
  await form.getByTestId('baj-tronco').selectOption(tronco);
  await form.getByTestId('baj-desde').selectOption(desde);
  await form.getByTestId('baj-distancia').fill(String(distancia));
  await form.getByTestId('baj-lado').selectOption(lado);
  await form.getByTestId('baj-crear').click();
  await expect(page.getByTestId('baj-msg')).toContainText('creado');
}

async function guardarCircuito(page: Page, nombre: string, o: string, d: string, cable: { tipo: string; formacion: string; cantidad: number; funcion: string }) {
  await page.getByTestId('circuito-origen').selectOption(o);
  await page.getByTestId('circuito-destino').selectOption(d);
  await page.getByTestId('circuito-cable-linea').selectOption({ label: 'Sintenax Valio' });
  await page.getByTestId('circuito-cable-tipo').selectOption({ label: cable.tipo });
  await page.getByTestId('circuito-cable-formacion').selectOption(cable.formacion);
  await page.getByTestId('circuito-cable-cantidad').fill(String(cable.cantidad));
  await page.getByTestId('circuito-cable-funcion-select').selectOption(cable.funcion);
  await page.getByTestId('circuito-nombre-input').fill(nombre);
  await page.getByTestId('circuito-guardar').click();
  await expect(page.getByTestId('circuito-guardado-msg')).toContainText(`Circuito "${nombre}" guardado`);
}

test.describe('Etapa 3 A — cálculo del motor', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('potencia al motor: ocupación y reserva en pantalla; maniobra con su longitud y el motivo D-11', async ({ page }) => {
    await abrir(page);
    const tg = await crearEquipo(page, 'Tablero General A', [300, 1500, 1200]);
    const b3 = await crearEquipo(page, 'Bomba 3', [2600, 2800, 500]);
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continueFrom(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'left' });
    await continueFrom(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    const [r1, curva, r2] = await piezas(page);
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, tg, r1.instancia_id, 'P1', 200, 'izquierda');
    await enlazar(page, b3, r2.instancia_id, 'P2', 300, 'derecha');
    await guardarCircuito(page, 'Fuerza B3', tg, b3, { tipo: 'Tripolar · cobre', formacion: 'PRY-SVALIO-CU-3x50', cantidad: 2, funcion: 'potencia' });
    await guardarCircuito(page, 'Mando B3', b3, tg, { tipo: 'Tetrapolar · cobre', formacion: 'PRY-SVALIO-CU-4x2.5', cantidad: 1, funcion: 'maniobra' });

    // Antes de calcular: qué viaja y qué no, y por qué.
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('circuito-al-motor')).toHaveCount(1);
    await expect(page.getByTestId('circuito-al-motor')).toContainText('Fuerza B3 → motor: Sintenax Valio · Tripolar · cobre · 3 × 50 mm² × 2, 3 pieza(s)');
    const mando = page.getByTestId('circuito-no-motor');
    await expect(mando).toHaveCount(1);
    await expect(mando).toContainText('Mando B3');
    await expect(mando).toContainText(/longitud [\d.,]+ mm · no se calcula/);
    await expect(mando.getByTestId('circuito-no-motor-motivo')).toContainText('D-11 del motor: los circuitos de mando y señal no tienen reglas de disposición ni de ocupación acordadas');

    // Calcular con el motor real.
    await page.getByTestId('reserva-input').fill('20');
    await page.getByTestId('calculate-tray').click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().status), { timeout: 60_000 }).toBe('vigente');
    const res = (await resultado(page))!;
    const circs = res.circuitos as Record<string, unknown>;
    expect(Object.keys(circs)).toEqual(['CIR-1']); // sólo potencia
    const entradaMotor = res.entrada as { circuitos: Array<{ separado: boolean; funcion: string; cantidad: number; cable_id: string; recorrido: string[] }>; pe: { cable_id: string; seccion_requerida_mm2: number } };
    expect(entradaMotor.circuitos).toEqual([expect.objectContaining({ funcion: 'potencia', separado: false, cantidad: 2, cable_id: 'PRY-SVALIO-CU-3x50', recorrido: [r1.instancia_id, curva.instancia_id, r2.instancia_id] })]);
    expect(entradaMotor.pe).toMatchObject({ cable_id: 'PRY-SASTFLEX-CU-1x16', seccion_requerida_mm2: 16 });

    const calc = page.getByTestId('calculo-motor');
    await expect(calc.getByTestId('calculo-motor-procedencia')).toContainText('Calculado por el motor motor_bandejas');
    await expect(calc.getByTestId('motor-circuito')).toHaveCount(1);
    await expect(calc.getByTestId('motor-circuito')).toHaveAttribute('data-recorrido', 'CONTINUO');
    // Ocupación y reserva de cada pieza: lo que devolvió el motor, en pantalla.
    const ocup = res.ocupacion as Record<string, { secciones: Record<string, { estado: string; ancho_ocupado_mm?: number; reserva?: { reserva_libre_pct: number } }> }>;
    for (const p of [r1, r2]) {
      const s = ocup[p.instancia_id].secciones.pieza;
      expect(s.ancho_ocupado_mm).toBeGreaterThan(0);
      const fila = calc.locator(`[data-testid="motor-pieza"][data-pieza="${p.instancia_id}"] [data-testid="motor-ocupacion"]`);
      await expect(fila).toHaveAttribute('data-estado', s.estado);
      await expect(fila).toHaveAttribute('data-ocupado', String(s.ancho_ocupado_mm));
      await expect(fila).toHaveAttribute('data-reserva-libre', String(s.reserva!.reserva_libre_pct));
      await expect(fila).toContainText(`ocupa ${s.ancho_ocupado_mm!.toLocaleString('es-AR', { maximumFractionDigits: 1 })} mm de 300 mm`);
      await expect(fila).toContainText('reserva libre');
      await expect(fila).toContainText('M-RES-1');
    }
    // PE del trazado: cobertura completa según el motor.
    await expect(calc.getByTestId('motor-pe')).toHaveAttribute('data-cobertura', 'COMPLETA');
    await expect(calc.getByTestId('motor-pe')).toContainText('PRY-SASTFLEX-CU-1x16');
    // El resumen del motor, tal cual.
    const resumen = res.resumen as { estado_trazado: string; incumplimientos: string[] };
    await expect(calc.getByTestId('motor-resumen')).toHaveAttribute('data-estado', resumen.estado_trazado);
    await expect(calc.getByTestId('motor-incumplimiento')).toHaveCount(resumen.incumplimientos.length);
    expect(resumen.incumplimientos).not.toContain('cobertura del PE incompleta');
    expect(resumen.incumplimientos).not.toContain('PE sin conexión al sistema de protección');
    // La maniobra sigue con su motivo después de calcular.
    await expect(page.getByTestId('circuito-no-motor-motivo')).toContainText('D-11');
    await page.screenshot({ path: resolve(OUT_DIR, 'calculo-motor-01.png'), fullPage: true });
  });

  test('circuito por una derivación en tramo: el motor lo da discontinuo y el incumplimiento lo explica (sin modificar el resultado)', async ({ page }) => {
    await abrir(page);
    const tg = await crearEquipo(page, 'Tablero General A', [2800, -1200, 800]);
    const b3 = await crearEquipo(page, 'Bomba 3', [1200, 2600, 500]);
    // Tronco perforada 300, derivación de 100 a 1500 mm de P1 (DCPS-100), y un recto de 100 desde su boca.
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    const [tronco] = await piezas(page);
    await page.getByTestId('tool-bandejas-derivacion').click();
    await page.getByTestId('der-tronco').selectOption(tronco.instancia_id);
    await page.getByTestId('der-desde').selectOption('P1');
    await page.getByTestId('der-distancia').fill('1500');
    await page.getByTestId('der-lado').selectOption('izquierda');
    await page.getByTestId('der-ancho').selectOption('100');
    await page.getByTestId('der-crear').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(2);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.getByTestId('free-end').filter({ hasText: /DCPS-100-Z/ }).first().click();
    await page.locator('[data-codex-routing-product-select]').selectOption('SAM_TRPS-100-22-Z');
    await page.locator('[data-codex-routing-length-input]').fill('1000');
    await page.locator('text=Confirmar continuación').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(3);
    const [, dcps, ramal] = await piezas(page);

    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, tg, tronco.instancia_id, 'P2', 200, 'derecha');
    await enlazar(page, b3, ramal.instancia_id, 'P2', 100, 'derecha');
    await guardarCircuito(page, 'Fuerza por derivación', tg, b3, { tipo: 'Tripolar · cobre', formacion: 'PRY-SVALIO-CU-3x10', cantidad: 1, funcion: 'potencia' });

    await page.getByTestId('stage-tab-resultados').click();
    await page.getByTestId('reserva-input').fill('20');
    await page.getByTestId('calculate-tray').click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().status), { timeout: 60_000 }).toBe('vigente');
    const res = (await resultado(page))!;
    // Para el motor ES discontinuo: el resultado no se toca.
    const resumen = res.resumen as { incumplimientos: string[] };
    expect(resumen.incumplimientos).toContain('recorridos discontinuos');
    const rec = (res.circuitos as Record<string, { recorrido: { estado: string; saltos_sin_conexion: string[][] } }>)['CIR-1'].recorrido;
    expect(rec.estado).toBe('DISCONTINUO');
    expect(rec.saltos_sin_conexion).toEqual([[tronco.instancia_id, dcps.instancia_id]]);
    // En pantalla, el propio incumplimiento lo explica.
    const explicado = /^recorridos discontinuos: la discontinuidad corresponde a una derivación en tramo; el motor no la modela como conexión \(no afecta ocupación ni reserva/;
    await expect(page.getByTestId('result-issues').locator('li')).toHaveText([explicado]);
    await expect(page.getByTestId('motor-incumplimiento')).toContainText(['corresponde a una derivación en tramo']);
    // Ocupación y reserva del ramal: calculadas igual por el motor.
    await expect(page.locator(`[data-testid="motor-pieza"][data-pieza="${ramal.instancia_id}"] [data-testid="motor-ocupacion"]`)).toContainText('reserva libre');
    await page.screenshot({ path: resolve(OUT_DIR, 'calculo-motor-02-derivacion.png'), fullPage: true });
  });

  test('parte B: bandeja segregada con banda divisoria — reparto por cantidad de cables, ocupación de la app, banda en el cómputo', async ({ page }) => {
    await abrir(page);
    const tg = await crearEquipo(page, 'Tablero General A', [200, 1500, 1200]);
    const b3 = await crearEquipo(page, 'Bomba 3', [2700, 1500, 1200]);
    // Un tramo de escalera 300, ala 90, zincado: lleva la BDS090Z.
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRES-300-090-18-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    const [r1] = await piezas(page);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.evaluate((id) => {
      (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } } }).__codex.workspaceStore.getState().selectTray(id);
    }, r1.instancia_id);
    await expect(page.getByTestId('banda-producto')).toHaveValue('SAM_BDS090Z');
    await expect(page.getByTestId('banda-producto').locator('option')).toHaveText(['BDS090Z (espesor 0.71 mm)']);
    await page.getByTestId('banda-colocar').click();
    await expect(page.getByTestId('banda-actual')).toContainText('Con banda BDS090Z');

    // Un circuito de potencia (3×50 × 2) y uno de maniobra (4×2,5 × 1) por la bandeja.
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, tg, r1.instancia_id, 'P1', 200, 'izquierda');
    await enlazar(page, b3, r1.instancia_id, 'P2', 300, 'izquierda');
    await guardarCircuito(page, 'Fuerza B3', tg, b3, { tipo: 'Tripolar · cobre', formacion: 'PRY-SVALIO-CU-3x50', cantidad: 2, funcion: 'potencia' });
    await guardarCircuito(page, 'Mando B3', b3, tg, { tipo: 'Tetrapolar · cobre', formacion: 'PRY-SVALIO-CU-4x2.5', cantidad: 1, funcion: 'maniobra' });

    // Resultados: la app calcula la bandeja segregada con la regla del operador.
    await page.getByTestId('stage-tab-resultados').click();
    await page.getByTestId('reserva-input').fill('20');
    const D = await page.evaluate(() => {
      const k = (window as unknown as { __codex: { trayStore: { getState: () => { context: { catalogoCables: { cables: Array<{ cable_id: string; diametro_exterior_mm: number }> } } } } } }).__codex.trayStore.getState().context.catalogoCables.cables;
      return Object.fromEntries(k.map((c) => [c.cable_id, c.diametro_exterior_mm]));
    });
    const disponible = 300 - 0.71;
    const nPot = 2 + 1; // 2 cables + PE
    const nCtl = 1;
    const asigPot = (disponible * nPot) / (nPot + nCtl);
    const asigCtl = (disponible * nCtl) / (nPot + nCtl);
    const ocPot = 2 * D['PRY-SVALIO-CU-3x50'] + D['PRY-SASTFLEX-CU-1x16'];
    const librePot = ((asigPot - ocPot) / asigPot) * 100;
    const seg = page.getByTestId('segregadas');
    await expect(seg.getByTestId('segregadas-procedencia')).toContainText('Regla declarada por el operador');
    await expect(seg.getByTestId('segregadas-procedencia')).toContainText('el motor no sabe que la banda existe');
    const gPot = seg.locator('[data-testid="segregada-grupo"][data-grupo="potencia"]');
    const gCtl = seg.locator('[data-testid="segregada-grupo"][data-grupo="control"]');
    await expect(seg.getByTestId('segregada-ocupacion')).toHaveAttribute('data-origen', 'app');
    await expect(gPot).toHaveAttribute('data-n', '3');
    await expect(gCtl).toHaveAttribute('data-n', '1');
    expect(Number(await gPot.getAttribute('data-asignado'))).toBeCloseTo(asigPot, 2);
    expect(Number(await gCtl.getAttribute('data-asignado'))).toBeCloseTo(asigCtl, 2);
    // Control negativo: mitad y mitad no.
    expect(Number(await gPot.getAttribute('data-asignado'))).not.toBeCloseTo(disponible / 2, 0);
    expect(Number(await gPot.getAttribute('data-ocupado'))).toBeCloseTo(ocPot, 3);
    expect(Number(await gPot.getAttribute('data-reserva-libre'))).toBeCloseTo(librePot, 2);
    // La banda aparece en el cómputo (agregada por la app).
    const banda = seg.getByTestId('computo-banda');
    await expect(banda).toHaveAttribute('data-producto', 'SAM_BDS090Z');
    await expect(banda).toHaveAttribute('data-piezas', '1');
    await expect(banda).toContainText('[AGREGADA POR LA APP] BDS090Z: 1 banda(s)');

    // Con el motor: no sabe de la banda, y la ocupación de esa pieza que se muestra es la de la app.
    await page.getByTestId('calculate-tray').click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().status), { timeout: 60_000 }).toBe('vigente');
    const res = (await resultado(page))!;
    expect(JSON.stringify(res.entrada)).not.toContain('BDS');
    const motorR1 = (res.ocupacion as Record<string, { secciones: { pieza: { ancho_referencia_mm: number; reserva: { reserva_libre_pct: number } } } }>)[r1.instancia_id].secciones.pieza;
    expect(motorR1.ancho_referencia_mm).toBe(300); // el motor calculó con el ancho entero (sin banda)
    const piezaMotor = page.locator(`[data-testid="calculo-motor"] [data-testid="motor-pieza"][data-pieza="${r1.instancia_id}"]`);
    await expect(piezaMotor.getByTestId('motor-ocupacion')).toHaveCount(0); // control negativo: no sale del motor
    await expect(piezaMotor.getByTestId('motor-ocupacion-reemplazada')).toBeVisible();
    await expect(piezaMotor.getByTestId('segregada-ocupacion')).toHaveAttribute('data-origen', 'app');
    const librePantalla = Number(await piezaMotor.locator('[data-testid="segregada-grupo"][data-grupo="potencia"]').getAttribute('data-reserva-libre'));
    expect(librePantalla).toBeCloseTo(librePot, 2);
    expect(librePantalla).not.toBeCloseTo(motorR1.reserva.reserva_libre_pct, 0);
    // El inspector de la pieza tampoco muestra la ocupación del motor: muestra la de la app.
    await page.evaluate((id) => {
      (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } } }).__codex.workspaceStore.getState().selectTray(id);
    }, r1.instancia_id);
    await expect(page.getByTestId('piece-result-segregada')).toBeVisible();
    await expect(page.getByTestId('piece-result-segregada').getByTestId('segregada-ocupacion')).toHaveAttribute('data-origen', 'app');
    await expect(page.getByTestId('piece-result').locator('summary', { hasText: /^ocupacion$/ })).toHaveCount(0);
    await page.screenshot({ path: resolve(OUT_DIR, 'calculo-motor-03-segregada.png'), fullPage: true });
  });
});

