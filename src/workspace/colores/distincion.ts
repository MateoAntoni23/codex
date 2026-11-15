/**
 * Distinción de colores (interfaz B6, 2026-11-14): cuánto se diferencian dos
 * colores para una persona, también con visión reducida del color rojo-verde.
 *
 *   - ΔE2000 (CIEDE2000) en CIELAB D65: diferencia percibida. ≈2 apenas se nota;
 *     ≥20 son colores que no se confunden de un vistazo.
 *   - Protanopía y deuteranopía simuladas con Machado, Oliveira y Fernandes
 *     (2009), severidad 1.0 (dicromacia completa: el peor caso).
 *   - Relación de contraste WCAG 2.x contra el fondo (1.4.11 pide ≥ 3:1 para
 *     elementos gráficos).
 *
 * Funciones puras: las usan la leyenda (avisar si el operador elige colores que
 * no se distinguen), las pruebas unitarias y la E2E que mide píxeles de la escena.
 */

export type Rgb = readonly [number, number, number]; // 0..1, sRGB
export type Vision = 'normal' | 'protan' | 'deutan';
export const VISIONES: readonly Vision[] = ['normal', 'protan', 'deutan'];

/** Umbrales de la verificación (B6). */
export const MIN_DELTA_E = 20;
export const MIN_CONTRASTE_FONDO = 3;

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number) => { const x = Math.max(0, Math.min(1, c)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };

export function luminancia(rgb: Rgb): number {
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: Rgb, b: Rgb): number {
  const [lo, hi] = [luminancia(a), luminancia(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

export function lab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 entre dos colores Lab. */
export function deltaE2000(l1: readonly number[], l2: readonly number[]): number {
  const [L1, a1, b1] = l1; const [L2, a2, b2] = l2;
  const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2); const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1; const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1); const C2p = Math.hypot(a2p, b2);
  const h = (b: number, a: number) => { const x = (Math.atan2(b, a) * 180) / Math.PI; return x < 0 ? x + 360 : x; };
  const h1p = h(b1, a1p); const h2p = h(b2, a2p);
  const dLp = L2 - L1; const dCp = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lbp = (L1 + L2) / 2; const Cbp = (C1p + C2p) / 2;
  let hbp: number;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp; const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// Machado 2009, severidad 1.0, sobre RGB lineal.
const MACHADO: Record<Exclude<Vision, 'normal'>, readonly (readonly number[])[]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};

export function simular(rgb: Rgb, vision: Vision): Rgb {
  if (vision === 'normal') return rgb;
  const l = rgb.map(lin); const m = MACHADO[vision];
  return m.map((row) => unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as unknown as Rgb;
}

export interface Par { readonly a: string; readonly b: string; readonly vision: Vision; readonly deltaE: number }
export interface ContraFondo { readonly clave: string; readonly vision: Vision; readonly deltaE: number; readonly contraste: number }
export interface Informe {
  readonly pares: readonly Par[];
  readonly fondo: readonly ContraFondo[];
  readonly peorPar: Par;
  readonly peorFondo: ContraFondo;
  readonly ok: boolean;
}

/** Mide una paleta {clave: color} contra sí misma y contra el fondo, en las tres visiones. */
export function evaluarPaleta(colores: Readonly<Record<string, Rgb | string>>, fondo: Rgb | string): Informe {
  const rgb = (c: Rgb | string): Rgb => (typeof c === 'string' ? hexToRgb(c) : c);
  const claves = Object.keys(colores);
  const pares: Par[] = []; const contra: ContraFondo[] = [];
  for (const vision of VISIONES) {
    const s = (c: Rgb | string) => simular(rgb(c), vision);
    const bg = s(fondo);
    for (let i = 0; i < claves.length; i++) {
      const ci = s(colores[claves[i]]);
      contra.push({ clave: claves[i], vision, deltaE: deltaE2000(lab(ci), lab(bg)), contraste: contraste(ci, bg) });
      for (let j = i + 1; j < claves.length; j++) {
        pares.push({ a: claves[i], b: claves[j], vision, deltaE: deltaE2000(lab(ci), lab(s(colores[claves[j]]))) });
      }
    }
  }
  const peorPar = pares.reduce((m, p) => (p.deltaE < m.deltaE ? p : m), pares[0]);
  const peorFondo = contra.reduce((m, p) => (p.contraste < m.contraste ? p : m), contra[0]);
  return {
    pares, fondo: contra, peorPar, peorFondo,
    ok: (!peorPar || peorPar.deltaE >= MIN_DELTA_E) && peorFondo.contraste >= MIN_CONTRASTE_FONDO,
  };
}
