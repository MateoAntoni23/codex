import type {
  ImportedCatalog,
  ReimportDiff,
  EntityKind,
  EquipoImportado,
  ComponenteImportado,
  AtributoImportado,
  ConexionImportada,
  TendidoImportado,
  AliasImportado,
} from './types';

function shallowFieldCompare<T extends object>(prev: T, next: T): Array<{ campo: string; antes: unknown; nuevo: unknown }> {
  const campos: Array<{ campo: string; antes: unknown; nuevo: unknown }> = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof T>;
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (a === b) continue;
    // Tratar undefined/null como equivalentes (ambos = "sin dato").
    if ((a === undefined || a === null) && (b === undefined || b === null)) continue;
    campos.push({ campo: String(k), antes: a, nuevo: b });
  }
  return campos;
}

/**
 * Compara un catálogo recién parseado contra el ya guardado en el proyecto.
 * No muta nada. El llamador decide cómo aplicar (reemplazar, mantener, retirar).
 *
 * Contrato §9:
 *  - Match por ID estable.
 *  - Huérfanos = ID en proyecto y no en nuevo. NUNCA se borran automáticamente.
 *  - Renombre probable = equipo nuevo cuyo TAG coincide con el TAG de un huérfano,
 *    o resuelve por ALIAS a un huérfano.
 *  - Equipos que pasaron a RETIRADO se muestran aparte para que el operador decida.
 */
export function diffCatalogs(prev: ImportedCatalog | null, next: ImportedCatalog): ReimportDiff {
  const diff: ReimportDiff = {
    sinCambios: 0,
    nuevos: [],
    modificados: [],
    huerfanos: [],
    conciliacionesPorTag: [],
    pasaronARetirado: [],
    mismoHash: false,
  };

  if (!prev) {
    // Primera importación: todo es "nuevo".
    for (const e of next.equipos) diff.nuevos.push({ kind: 'equipo', id: e.equipoId, tag: e.tag });
    for (const c of next.componentes) diff.nuevos.push({ kind: 'componente', id: c.componenteId });
    for (const a of next.atributos) diff.nuevos.push({ kind: 'atributo', id: a.atributoId });
    for (const cx of next.conexiones) diff.nuevos.push({ kind: 'conexion', id: cx.conexionId });
    for (const t of next.tendidos) diff.nuevos.push({ kind: 'tendido', id: t.tendidoId });
    for (const al of next.alias) diff.nuevos.push({ kind: 'alias', id: al.aliasId });
    return diff;
  }

  diff.mismoHash = prev.meta.fileHash === next.meta.fileHash;

  // Mapas ID→registro para cada tipo.
  const prevEquipos = new Map(prev.equipos.map((e) => [e.equipoId, e] as const));
  const nextEquipos = new Map(next.equipos.map((e) => [e.equipoId, e] as const));
  compareCollection<EquipoImportado>('equipo', prevEquipos, nextEquipos, (e) => e.tag, diff);

  const prevCmp = new Map(prev.componentes.map((c) => [c.componenteId, c] as const));
  const nextCmp = new Map(next.componentes.map((c) => [c.componenteId, c] as const));
  compareCollection<ComponenteImportado>('componente', prevCmp, nextCmp, (c) => c.tag, diff);

  const prevAt = new Map(prev.atributos.map((a) => [a.atributoId, a] as const));
  const nextAt = new Map(next.atributos.map((a) => [a.atributoId, a] as const));
  compareCollection<AtributoImportado>('atributo', prevAt, nextAt, () => undefined, diff);

  const prevCx = new Map(prev.conexiones.map((c) => [c.conexionId, c] as const));
  const nextCx = new Map(next.conexiones.map((c) => [c.conexionId, c] as const));
  compareCollection<ConexionImportada>('conexion', prevCx, nextCx, () => undefined, diff);

  const prevTd = new Map(prev.tendidos.map((t) => [t.tendidoId, t] as const));
  const nextTd = new Map(next.tendidos.map((t) => [t.tendidoId, t] as const));
  compareCollection<TendidoImportado>('tendido', prevTd, nextTd, () => undefined, diff);

  const prevAl = new Map(prev.alias.map((a) => [a.aliasId, a] as const));
  const nextAl = new Map(next.alias.map((a) => [a.aliasId, a] as const));
  compareCollection<AliasImportado>('alias', prevAl, nextAl, (a) => a.alias, diff);

  // Pasaron a RETIRADO: estaban activos en prev y ahora están RETIRADO en next.
  for (const [id, prevEq] of prevEquipos) {
    const nx = nextEquipos.get(id);
    if (nx && prevEq.estadoAlcance !== 'RETIRADO' && nx.estadoAlcance === 'RETIRADO') {
      diff.pasaronARetirado.push({ kind: 'equipo', id, tag: nx.tag });
    }
  }

  // Conciliaciones por TAG: un equipo nuevo (distinto equipoId) cuyo TAG coincide con
  // el TAG de un huérfano. Requiere revisión del usuario — NO se aplica automáticamente.
  // Un "rename" real donde cambia sólo el TAG con el mismo equipoId ya cae en `modificados`.
  const huerfanosPorTag = new Map<string, { id: string; tag?: string }>();
  for (const h of diff.huerfanos) {
    if (h.kind === 'equipo' && h.tag) huerfanosPorTag.set(h.tag, h);
  }
  const huerfanoIds = new Set(diff.huerfanos.filter((h) => h.kind === 'equipo').map((h) => h.id));
  for (const n of diff.nuevos) {
    if (n.kind !== 'equipo' || !n.tag) continue;
    const match = huerfanosPorTag.get(n.tag);
    if (match) {
      diff.conciliacionesPorTag.push({ kind: 'equipo', idNuevo: n.id, tagNuevo: n.tag, idHuerfano: match.id });
    }
  }
  // Alias puente: si un alias del nuevo libro apunta a un equipoId huérfano y el nuevo
  // libro tiene un equipo cuyo TAG = ese alias, también es candidato a conciliación.
  for (const al of next.alias) {
    if (huerfanoIds.has(al.equipoId)) {
      const nvEquipo = next.equipos.find((e) => e.tag === al.alias);
      if (nvEquipo && !prevEquipos.has(nvEquipo.equipoId)) {
        diff.conciliacionesPorTag.push({ kind: 'equipo', idNuevo: nvEquipo.equipoId, tagNuevo: nvEquipo.tag, idHuerfano: al.equipoId });
      }
    }
  }

  return diff;
}

function compareCollection<T extends object>(
  kind: EntityKind,
  prev: Map<string, T>,
  next: Map<string, T>,
  getTag: (x: T) => string | undefined,
  diff: ReimportDiff,
) {
  for (const [id, nx] of next) {
    const pv = prev.get(id);
    if (!pv) {
      diff.nuevos.push({ kind, id, tag: getTag(nx) });
      continue;
    }
    const campos = shallowFieldCompare(pv, nx);
    if (campos.length === 0) {
      diff.sinCambios++;
    } else {
      diff.modificados.push({ kind, id, tag: getTag(nx), campos });
    }
  }
  for (const [id, pv] of prev) {
    if (!next.has(id)) {
      diff.huerfanos.push({ kind, id, tag: getTag(pv) });
    }
  }
}

/** Resumen humano de un diff, útil para la vista previa de reimportación. */
export function summarizeDiff(d: ReimportDiff): string {
  if (d.mismoHash) return 'El archivo es idéntico a uno ya importado. Nada que aplicar.';
  const parts: string[] = [];
  if (d.sinCambios) parts.push(`${d.sinCambios} sin cambios`);
  if (d.nuevos.length) parts.push(`${d.nuevos.length} nuevos`);
  if (d.modificados.length) parts.push(`${d.modificados.length} modificados`);
  if (d.huerfanos.length) parts.push(`${d.huerfanos.length} huérfanos`);
  if (d.conciliacionesPorTag.length) parts.push(`${d.conciliacionesPorTag.length} conciliaciones por TAG (requiere revisión)`);
  if (d.pasaronARetirado.length) parts.push(`${d.pasaronARetirado.length} pasaron a RETIRADO`);
  return parts.length ? parts.join(' · ') : 'Sin cambios.';
}
