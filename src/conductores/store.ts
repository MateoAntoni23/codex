/**
 * Cables declarados por el operador: autoridad en localStorage, como la biblioteca de
 * modelos. Un fallo de escritura no cambia el estado en memoria y se informa: el
 * operador nunca cree que guardó algo que no quedó guardado.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { esCableDeclarado, type CableDeclarado } from './biblioteca';

export const CLAVE_CONDUCTORES = 'codex:conductoresDeclarados:v1';
export const PREFIJO_RESPALDO_CONDUCTORES = 'codex:conductoresDeclarados:v1:backup:';
export const VERSION_CONDUCTORES = 'codex:conductores/1';

interface Guardado { version: typeof VERSION_CONDUCTORES; cables: CableDeclarado[] }

export type LecturaConductores = { ok: true; cables: CableDeclarado[] } | { ok: false; motivo: string };

/** Lee la biblioteca local. Ausente: vacía. Ilegible: se informa y no se pisa. */
export function leerConductoresLocales(): LecturaConductores {
  let raw: string | null;
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CLAVE_CONDUCTORES);
  } catch (e) {
    return { ok: false, motivo: `no se pudo leer la biblioteca de conductores de este navegador: ${String(e)}` };
  }
  if (raw === null) return { ok: true, cables: [] };
  try {
    const g = JSON.parse(raw) as Partial<Guardado>;
    if (g.version !== VERSION_CONDUCTORES || !Array.isArray(g.cables)) return { ok: false, motivo: `formato desconocido en ${CLAVE_CONDUCTORES}` };
    const malos = g.cables.filter((c) => !esCableDeclarado(c)).length;
    if (malos) return { ok: false, motivo: `${malos} cable(s) ilegibles en ${CLAVE_CONDUCTORES}` };
    return { ok: true, cables: g.cables as CableDeclarado[] };
  } catch {
    return { ok: false, motivo: `${CLAVE_CONDUCTORES} no es JSON válido` };
  }
}

function escribir(cables: readonly CableDeclarado[]): string | null {
  try {
    const g: Guardado = { version: VERSION_CONDUCTORES, cables: [...cables] };
    localStorage.setItem(CLAVE_CONDUCTORES, JSON.stringify(g));
    return null;
  } catch (e) {
    return `no se pudo guardar en este navegador: ${String(e)}`;
  }
}

/** Copia de la biblioteca local bajo otra clave, antes de adoptar la de un archivo. */
export function respaldarConductores(cables: readonly CableDeclarado[]): string | null {
  try {
    const clave = `${PREFIJO_RESPALDO_CONDUCTORES}${new Date().toISOString()}`;
    localStorage.setItem(clave, JSON.stringify({ version: VERSION_CONDUCTORES, cables }));
    return clave;
  } catch {
    return null;
  }
}

interface ConductoresState {
  cables: CableDeclarado[];
  /** Motivo si la biblioteca local no se pudo leer: entonces no se escribe encima. */
  errorLectura: string | null;
  hidratado: boolean;
  hidratar: () => void;
  /** null si quedó guardado; si no, el motivo (y el estado no cambia). */
  agregar: (c: CableDeclarado) => string | null;
  actualizar: (c: CableDeclarado) => string | null;
  borrar: (cableId: string) => string | null;
  /** Agrega los del archivo y reemplaza los de igual id. Nunca borra. */
  fusionar: (desdeArchivo: readonly CableDeclarado[]) => string | null;
}

export const useConductoresStore = create<ConductoresState>((set, get) => {
  const guardar = (cables: CableDeclarado[]): string | null => {
    if (get().errorLectura) return `la biblioteca local no se pudo leer (${get().errorLectura}); no se escribe encima`;
    const err = escribir(cables);
    if (!err) set({ cables });
    return err;
  };
  return {
    cables: [],
    errorLectura: null,
    hidratado: false,
    hidratar: () => {
      const r = leerConductoresLocales();
      set(r.ok ? { cables: r.cables, errorLectura: null, hidratado: true } : { cables: [], errorLectura: r.motivo, hidratado: true });
    },
    agregar: (c) => {
      if (get().cables.some((x) => x.cable_id === c.cable_id)) return `ya existe un cable con id ${c.cable_id}`;
      return guardar([...get().cables, c]);
    },
    actualizar: (c) => {
      if (!get().cables.some((x) => x.cable_id === c.cable_id)) return `no existe el cable ${c.cable_id}`;
      return guardar(get().cables.map((x) => (x.cable_id === c.cable_id ? c : x)));
    },
    borrar: (id) => guardar(get().cables.filter((x) => x.cable_id !== id)),
    fusionar: (desde) => {
      const porId = new Map(get().cables.map((c) => [c.cable_id, c] as const));
      for (const c of desde) porId.set(c.cable_id, c);
      return guardar([...porId.values()]);
    },
  };
});

/**
 * Otra pestaña (la biblioteca de conductores) cambió la biblioteca local: se vuelve a
 * leer, para que el cálculo de esta pestaña use los mismos declarados (p. ej. un
 * diámetro recién completado).
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE_CONDUCTORES && useConductoresStore.getState().hidratado) useConductoresStore.getState().hidratar();
  });
}

/**
 * Los declarados de este equipo, leyendo la biblioteca local si todavía no se leyó.
 * El cálculo (qué viaja al motor, ocupación de la app) siempre parte de acá: con la
 * biblioteca sin leer, un tendido que casa con un declarado y un cable de catálogo
 * podría viajar al motor con el de catálogo.
 */
export function declaradosHidratados(): readonly CableDeclarado[] {
  const s = useConductoresStore.getState();
  if (!s.hidratado) s.hidratar();
  return useConductoresStore.getState().cables;
}

/** Hook: los declarados de este equipo (lee la biblioteca local la primera vez). */
export function useDeclarados(): readonly CableDeclarado[] {
  const hidratado = useConductoresStore((s) => s.hidratado);
  const cables = useConductoresStore((s) => s.cables);
  useEffect(() => { if (!hidratado) useConductoresStore.getState().hidratar(); }, [hidratado]);
  if (hidratado) return cables;
  // Primer render: se lee sin escribir el store (el efecto lo hidrata enseguida).
  const r = leerConductoresLocales();
  return r.ok ? r.cables : [];
}
