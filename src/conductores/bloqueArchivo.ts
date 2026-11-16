/**
 * Cables declarados en el archivo de proyecto (A5). Mismo esquema que la biblioteca de
 * modelos (`configurator/libraryBlock.ts`):
 *   - la autoridad en cada máquina es su localStorage;
 *   - la COPIA del proyecto lleva un bloque con los declarados que el proyecto usa
 *     (`declaradosUsados`), para que abierta en otra máquina no pierda la ocupación;
 *   - el autoguardado (IndexedDB) no lo lleva, como tampoco lleva la de modelos;
 *   - abrir un archivo no toca la biblioteca local salvo que el operador elija adoptar
 *     los del archivo ante una diferencia. Adoptar AGREGA los que faltan y reemplaza
 *     los de igual id; nunca borra un cable local (el archivo trae solo los usados, no
 *     la biblioteca entera). Antes se guarda una copia de la local bajo otra clave.
 *
 * Es un campo opcional del archivo (fileVersion sin cambios). Una app anterior lo
 * ignora: no calcula nada con declarados, así que no cambia ningún resultado, pero si
 * vuelve a guardar la copia, el bloque no viaja (ver el traspaso).
 */
import { canonicalJson } from '../configurator/libraryBlock';
import { esCableDeclarado, type CableDeclarado } from './biblioteca';
import { VERSION_CONDUCTORES } from './store';

export interface BloqueConductores {
  version: typeof VERSION_CONDUCTORES;
  cables: CableDeclarado[];
}

export function bloqueConductores(usados: readonly CableDeclarado[]): BloqueConductores | null {
  return usados.length ? { version: VERSION_CONDUCTORES, cables: [...usados] } : null;
}

/** Lee el bloque de un archivo. Ausente: null. Presente y mal formado: error (no se abre a medias). */
export function leerBloqueConductores(raw: unknown): CableDeclarado[] | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('conductoresDeclarados debe ser un objeto');
  const b = raw as Record<string, unknown>;
  if (b.version !== VERSION_CONDUCTORES) throw new Error(`conductoresDeclarados: versión no soportada (${String(b.version)})`);
  if (!Array.isArray(b.cables)) throw new Error('conductoresDeclarados.cables debe ser array');
  const malos = b.cables.map((c, i) => (esCableDeclarado(c) ? null : i)).filter((i) => i !== null);
  if (malos.length) throw new Error(`conductoresDeclarados: cable(s) inválidos en las posiciones ${malos.join(', ')}`);
  const ids = new Set((b.cables as CableDeclarado[]).map((c) => c.cable_id));
  if (ids.size !== b.cables.length) throw new Error('conductoresDeclarados: ids de cable repetidos');
  return b.cables as CableDeclarado[];
}


export interface DiferenciaConductores {
  /** Están en el archivo y no en esta máquina. */
  readonly faltanLocal: readonly CableDeclarado[];
  /** Mismo id, distintos datos. */
  readonly distintos: readonly { local: CableDeclarado; archivo: CableDeclarado }[];
}

export function diferenciaConductores(local: readonly CableDeclarado[], archivo: readonly CableDeclarado[]): DiferenciaConductores {
  const porId = new Map(local.map((c) => [c.cable_id, c] as const));
  const faltanLocal: CableDeclarado[] = [];
  const distintos: { local: CableDeclarado; archivo: CableDeclarado }[] = [];
  for (const a of archivo) {
    const l = porId.get(a.cable_id);
    if (!l) faltanLocal.push(a);
    else if (canonicalJson(l) !== canonicalJson(a)) distintos.push({ local: l, archivo: a });
  }
  return { faltanLocal, distintos };
}

export const hayDiferencia = (d: DiferenciaConductores) => d.faltanLocal.length > 0 || d.distintos.length > 0;

export function describirDiferencia(d: DiferenciaConductores): string[] {
  return [
    ...d.faltanLocal.map((c) => `Cable declarado que no está en este equipo: ${c.designacion} (${c.cable_id})`),
    ...d.distintos.map(({ local, archivo }) => `Cable declarado con otros datos en el archivo: ${archivo.designacion} (${archivo.cable_id}; acá: ${local.designacion})`),
  ];
}
