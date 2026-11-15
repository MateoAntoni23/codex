/**
 * Color de representación por TIPO de bandeja (interfaz B1/B2, 2026-11-14).
 *
 * El tipo sale del `tipo_constructivo` de la familia en el catálogo (perforada,
 * escalera, alambre), nunca del acabado: una perforada zincada (SAM-STP-Z) y una
 * perforada color (SAM-STP-ZN) son del mismo tipo y del mismo color. Herrajes,
 * soportes y accesorios de unión van en gris neutro.
 *
 * Es preferencia de pantalla, como el tema: se guarda por navegador en
 * localStorage y nunca viaja en el archivo de proyecto.
 *
 * Valores por defecto (pedido del operador: perforada celeste, escalera rojo,
 * alambre ámbar), ajustados por distinción medida (`distincion.ts`) contra el
 * fondo de la escena, también con protanopía y deuteranopía.
 */
import { create } from 'zustand';
import type { CatalogFamily, Product } from '../../tray/model';

export type TipoColor = 'perforada' | 'escalera' | 'alambre' | 'herraje';
export const TIPOS_COLOR: readonly TipoColor[] = ['perforada', 'escalera', 'alambre', 'herraje'];

export const NOMBRE_TIPO: Record<TipoColor, string> = {
  perforada: 'Perforada',
  escalera: 'Escalera',
  alambre: 'Alambre',
  herraje: 'Herrajes y soportes',
};

export const COLORES_POR_DEFECTO: Readonly<Record<TipoColor, string>> = {
  perforada: '#4cb4f0',
  escalera: '#ee4638',
  alambre: '#ffd84f',
  herraje: '#6e737c',
};

/** Fondo de la escena (`.unified-workspace-body`, igual en los dos temas). */
export const FONDO_ESCENA = '#111120';

/**
 * Cómo se dibuja el color (medido en la E2E B6 sobre píxeles, 1366×768). Con los
 * materiales anteriores el color dibujado se apartaba del elegido: opacidad 0,75–0,85
 * (el fondo oscuro se mezclaba), la luz de la escena (≈0,7 del tono) y el tone mapping
 * ACES de la escena, que lava los colores claros (el ámbar #ffd54f se veía #c6b55d).
 * Las piezas confirmadas se dibujan opacas, sin tone mapping y con una base emisiva de
 * su propio color, para que lo que se ve sea lo que se eligió; la luz sigue dando
 * volumen. La vista previa sigue translúcida (0,35). Equipos y resto de la escena, sin
 * cambios.
 */
export const OPACIDAD_PIEZA = 1;
export const EMISIVO_BASE = 0.3;
export const EMISIVO_SELECCION = 0.6;

/** Contorno de la pieza seleccionada: no cambia el relleno, la rodea. */
export const COLOR_CONTORNO_SELECCION = '#ffffff';

export const COLORES_STORAGE_KEY = 'codex:ui:colores-tipo';
export const LEYENDA_STORAGE_KEY = 'codex:ui:leyenda-colores';

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Piezas que forman el recorrido de bandeja (lo demás de la familia es herraje o unión). */
const PIEZA_DE_BANDEJA = /^(recta|curva|t$|x$|reduccion|final de tramo|piso|tapa|adaptador)/;

function tipoDeFamilia(familiaId: string, familias: readonly CatalogFamily[] | undefined): TipoColor | null {
  const f = familias?.find((x) => x.familia_id === familiaId);
  const t = typeof f?.tipo_constructivo === 'string' ? sinTildes(f.tipo_constructivo) : null;
  if (t === 'perforada' || t === 'escalera' || t === 'alambre') return t;
  if (t) return null; // «otro»: ferretería, accesorios, perfilería
  // Sin la tabla de familias (no debería pasar): por el código de familia publicado.
  if (/^SAM-(STE|ESC)/i.test(familiaId)) return 'escalera';
  if (/^SAM-STP/i.test(familiaId)) return 'perforada';
  if (/ALAMBRE/i.test(familiaId)) return 'alambre';
  return null;
}

/** Tipo de color de un producto del catálogo. Sin producto: herraje (gris neutro). */
export function tipoColorDe(product: Product | undefined, familias: readonly CatalogFamily[] | undefined): TipoColor {
  if (!product) return 'herraje';
  const fam = (product as Record<string, unknown>).familia_id;
  const tipo = typeof fam === 'string' ? tipoDeFamilia(fam, familias) : null;
  if (!tipo) return 'herraje';
  return PIEZA_DE_BANDEJA.test(sinTildes(String(product.tipo_pieza ?? ''))) ? tipo : 'herraje';
}

const esHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function leerColores(): Record<TipoColor, string> {
  const out = { ...COLORES_POR_DEFECTO };
  try {
    const raw = JSON.parse(localStorage.getItem(COLORES_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const t of TIPOS_COLOR) if (esHex(raw[t])) out[t] = raw[t].toLowerCase();
  } catch { /* sin almacenamiento o dato corrupto: valores por defecto */ }
  return out;
}

function leerLeyenda(): boolean {
  try { return localStorage.getItem(LEYENDA_STORAGE_KEY) !== 'oculta'; } catch { return true; }
}

function guardar(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* preferencia de pantalla: si no se puede guardar, sigue en memoria */ }
}

interface ColoresState {
  colores: Record<TipoColor, string>;
  leyendaVisible: boolean;
  setColor: (t: TipoColor, hex: string) => void;
  restablecer: () => void;
  setLeyendaVisible: (v: boolean) => void;
}

export const useColoresStore = create<ColoresState>((set, get) => ({
  colores: typeof localStorage === 'undefined' ? { ...COLORES_POR_DEFECTO } : leerColores(),
  leyendaVisible: typeof localStorage === 'undefined' ? true : leerLeyenda(),
  setColor: (t, hex) => {
    if (!esHex(hex)) return;
    const colores = { ...get().colores, [t]: hex.toLowerCase() };
    guardar(COLORES_STORAGE_KEY, JSON.stringify(colores));
    set({ colores });
  },
  restablecer: () => {
    try { localStorage.removeItem(COLORES_STORAGE_KEY); } catch { /* idem */ }
    set({ colores: { ...COLORES_POR_DEFECTO } });
  },
  setLeyendaVisible: (leyendaVisible) => {
    guardar(LEYENDA_STORAGE_KEY, leyendaVisible ? 'visible' : 'oculta');
    set({ leyendaVisible });
  },
}));

/** Color de un producto con la paleta vigente (hook). */
export function useColorDeProducto(product: Product | undefined, familias: readonly CatalogFamily[] | undefined): { tipo: TipoColor; color: string } {
  const colores = useColoresStore((s) => s.colores);
  const tipo = tipoColorDe(product, familias);
  return { tipo, color: colores[tipo] };
}
