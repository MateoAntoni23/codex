import type {
  ImportedCatalog,
  ValidationIssue,
  EquipoImportado,
  AliasImportado,
  PendienteImportado,
  CatalogoAtributo,
} from './types';

// Patrones de IDs del contrato §4.
const PATTERN_EQUIPO = /^EQ-\d{4,}$/;
const PATTERN_COMPONENTE = /^CMP-\d{4,}$/;
const PATTERN_ATRIBUTO = /^AT-\d{5,}$/;
const PATTERN_CONEXION = /^CX-\d{4,}$/;
const PATTERN_TENDIDO = /^(CB-\d{3,}|TUB-\d{4,})$/;
const PATTERN_ALIAS = /^AL-\d{4,}$/;
const PATTERN_PENDIENTE = /^PD-\d{4,}$/;

const FUNCIONES_CON_PE = new Set(['PE', '3F+PE', '3F+N+PE', 'F+N+PE', 'EQUIPOTENCIAL']);

/**
 * Aplica V-05..V-25 (y los V-05 de IDs mal formados). Los V-01..V-04 y V-26 los
 * levanta el parser durante la lectura del libro.
 */
export function validateCatalog(cat: ImportedCatalog, issues: ValidationIssue[]): void {
  checkIdPatternsAndUniqueness(cat, issues);
  checkTagUniqueness(cat.equipos, issues);
  checkEquipoRefs(cat, issues);
  checkComponentes(cat, issues);
  checkAtributos(cat, issues);
  checkConexiones(cat, issues);
  checkTendidos(cat, issues);
  checkAlias(cat, issues);
  reflectPendientes(cat.pendientes, issues);
}

function checkIdPatternsAndUniqueness(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const checks: Array<{
    name: string;
    sheet: string;
    ids: string[];
    pattern: RegExp;
  }> = [
    { name: 'equipo', sheet: 'EQUIPOS', ids: cat.equipos.map((e) => e.equipoId), pattern: PATTERN_EQUIPO },
    { name: 'componente', sheet: 'COMPONENTES', ids: cat.componentes.map((c) => c.componenteId), pattern: PATTERN_COMPONENTE },
    { name: 'atributo', sheet: 'ATRIBUTOS_TECNICOS', ids: cat.atributos.map((a) => a.atributoId), pattern: PATTERN_ATRIBUTO },
    { name: 'conexion', sheet: 'CONEXIONES', ids: cat.conexiones.map((c) => c.conexionId), pattern: PATTERN_CONEXION },
    { name: 'tendido', sheet: 'TENDIDOS', ids: cat.tendidos.map((t) => t.tendidoId), pattern: PATTERN_TENDIDO },
    { name: 'alias', sheet: 'ALIAS', ids: cat.alias.map((a) => a.aliasId), pattern: PATTERN_ALIAS },
    { name: 'pendiente', sheet: 'PENDIENTES', ids: cat.pendientes.map((p) => p.pendienteId), pattern: PATTERN_PENDIENTE },
  ];
  for (const c of checks) {
    const seen = new Map<string, number>();
    for (const id of c.ids) {
      if (!c.pattern.test(id)) {
        issues.push({
          code: 'V-05',
          severity: 'ERROR',
          sheet: c.sheet,
          recordId: id,
          message: `${c.sheet}: identificador ${id} no cumple el patrón esperado.`,
        });
      }
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const [id, n] of seen) {
      if (n > 1) {
        issues.push({
          code: 'V-05',
          severity: 'ERROR',
          sheet: c.sheet,
          recordId: id,
          message: `${c.sheet}: identificador ${id} aparece ${n} veces.`,
        });
      }
    }
  }
}

function checkTagUniqueness(equipos: EquipoImportado[], issues: ValidationIssue[]) {
  const porTag = new Map<string, EquipoImportado[]>();
  for (const e of equipos) {
    if (e.estadoAlcance === 'RETIRADO') continue;
    if (!e.tag) continue;
    const list = porTag.get(e.tag) ?? [];
    list.push(e);
    porTag.set(e.tag, list);
  }
  for (const [tag, list] of porTag) {
    if (list.length > 1) {
      const ids = list.map((e) => e.equipoId).join(', ');
      issues.push({
        code: 'V-10',
        severity: 'ERROR',
        sheet: 'EQUIPOS',
        tag,
        message: `TAG ${tag} repetido en ${ids}.`,
      });
    }
  }
}

function checkEquipoRefs(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const equipos = new Map(cat.equipos.map((e) => [e.equipoId, e]));
  const listas = cat.listas;
  const catEquipo = new Set(listas.categoria_equipo ?? []);
  const proyectos = new Set(listas.proyecto ?? []);
  const estados = new Set(listas.estado_alcance ?? []);
  const siNo = new Set(listas.si_no ?? ['SI', 'NO']);

  for (const e of cat.equipos) {
    if (!e.tag) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, message: `EQUIPOS ${e.equipoId}: falta tag.` });
    }
    if (!e.categoria) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, message: `EQUIPOS ${e.equipoId}: falta categoria.` });
    } else if (catEquipo.size > 0 && !catEquipo.has(e.categoria)) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, column: 'categoria', message: `EQUIPOS ${e.equipoId}: '${e.categoria}' no es un valor permitido para categoria.` });
    }
    if (!e.proyecto) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, message: `EQUIPOS ${e.equipoId}: falta proyecto.` });
    } else if (proyectos.size > 0 && !proyectos.has(e.proyecto)) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, column: 'proyecto', message: `EQUIPOS ${e.equipoId}: '${e.proyecto}' no es un valor permitido para proyecto.` });
    }
    if (!e.estadoAlcance) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, message: `EQUIPOS ${e.equipoId}: falta estado_alcance.` });
    } else if (estados.size > 0 && !estados.has(e.estadoAlcance)) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, column: 'estado_alcance', message: `EQUIPOS ${e.equipoId}: '${e.estadoAlcance}' no es un valor permitido.` });
    }
    if (!e.estadoAlcanceConfirmado) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, message: `EQUIPOS ${e.equipoId}: falta estado_alcance_confirmado.` });
    } else if (!siNo.has(e.estadoAlcanceConfirmado)) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, column: 'estado_alcance_confirmado', message: `EQUIPOS ${e.equipoId}: '${e.estadoAlcanceConfirmado}' no es un valor permitido.` });
    }
    if (e.tableroOrigenId && !equipos.has(e.tableroOrigenId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, column: 'tablero_origen_id', message: `EQUIPOS ${e.equipoId}: tablero_origen_id apunta a ${e.tableroOrigenId}, que no existe.` });
    }
    if (e.contenedorId && !equipos.has(e.contenedorId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'EQUIPOS', recordId: e.equipoId, tag: e.tag, column: 'contenedor_id', message: `EQUIPOS ${e.equipoId}: contenedor_id apunta a ${e.contenedorId}, que no existe.` });
    }
  }
}

function checkComponentes(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const equipos = new Map(cat.equipos.map((e) => [e.equipoId, e]));
  const tiposComponente = new Set(cat.listas.tipo_componente ?? []);
  for (const c of cat.componentes) {
    if (!c.contenedorEquipoId) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'COMPONENTES', recordId: c.componenteId, message: `COMPONENTES ${c.componenteId}: falta contenedor_equipo_id.` });
    } else if (!equipos.has(c.contenedorEquipoId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'COMPONENTES', recordId: c.componenteId, column: 'contenedor_equipo_id', message: `COMPONENTES ${c.componenteId}: contenedor_equipo_id apunta a ${c.contenedorEquipoId}, que no existe.` });
    }
    if (c.equipoAsociadoId && !equipos.has(c.equipoAsociadoId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'COMPONENTES', recordId: c.componenteId, column: 'equipo_asociado_id', message: `COMPONENTES ${c.componenteId}: equipo_asociado_id ${c.equipoAsociadoId} no existe.` });
    }
    if (tiposComponente.size > 0 && c.tipoComponente && !tiposComponente.has(c.tipoComponente)) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'COMPONENTES', recordId: c.componenteId, column: 'tipo_componente', message: `COMPONENTES ${c.componenteId}: '${c.tipoComponente}' no es un valor permitido.` });
    }
    if (!Number.isFinite(c.cantidad) || c.cantidad < 1) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'COMPONENTES', recordId: c.componenteId, column: 'cantidad', message: `COMPONENTES ${c.componenteId}: cantidad inválida (${c.cantidad}).` });
    }
  }
}

function checkAtributos(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const equipos = new Map(cat.equipos.map((e) => [e.equipoId, e]));
  const componentes = new Map(cat.componentes.map((c) => [c.componenteId, c]));
  const catalogo = new Map<string, CatalogoAtributo>();
  for (const a of cat.catalogoAtributos) catalogo.set(a.atributo, a);

  // Clave (equipo, componente|null, atributo) → cuántos vigentes=SI hay.
  const vigentes = new Map<string, number>();

  for (const a of cat.atributos) {
    const tagEq = equipos.get(a.equipoId)?.tag;
    if (!a.equipoId) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, message: `ATRIBUTOS_TECNICOS ${a.atributoId}: falta equipo_id.` });
      continue;
    }
    if (!equipos.has(a.equipoId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, column: 'equipo_id', message: `ATRIBUTOS_TECNICOS ${a.atributoId}: equipo_id ${a.equipoId} no existe.` });
      continue;
    }
    if (a.componenteId && !componentes.has(a.componenteId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, column: 'componente_id', message: `ATRIBUTOS_TECNICOS ${a.atributoId}: componente_id ${a.componenteId} no existe.` });
    }
    if (!a.atributo) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, message: `ATRIBUTOS_TECNICOS ${a.atributoId}: falta atributo.` });
      continue;
    }
    const def = catalogo.get(a.atributo);
    if (!def) {
      issues.push({ code: 'V-16', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, message: `Atributo ${a.atributo} desconocido.` });
      continue;
    }
    if (def.tipoDato === 'NUMERO') {
      if (a.estadoDato !== 'PENDIENTE' && a.valorNumero === undefined) {
        issues.push({ code: 'V-17', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, message: `${a.atributo} de ${tagEq ?? a.equipoId}: valor/unidad inválidos (esperado número en ${def.unidad ?? '-'}).` });
      }
      if (def.unidad && def.unidad !== '-' && a.unidad && a.unidad !== def.unidad) {
        issues.push({ code: 'V-17', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, column: 'unidad', message: `${a.atributo} de ${tagEq ?? a.equipoId}: unidad '${a.unidad}' no coincide con '${def.unidad}'.` });
      }
    } else if (def.tipoDato === 'TEXTO') {
      if (a.estadoDato !== 'PENDIENTE' && !a.valorTexto) {
        issues.push({ code: 'V-17', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, message: `${a.atributo} de ${tagEq ?? a.equipoId}: falta valor_texto.` });
      }
    }
    if (a.estadoDato === 'PENDIENTE' && (a.valorNumero !== undefined || a.valorTexto !== undefined)) {
      issues.push({ code: 'V-18', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, message: `${a.atributo} de ${tagEq ?? a.equipoId}: un dato PENDIENTE no debe tener valor.` });
    }
    if (a.estadoDato === 'CONFLICTO') {
      issues.push({ code: 'V-20', severity: 'ADVERTENCIA', sheet: 'ATRIBUTOS_TECNICOS', recordId: a.atributoId, tag: tagEq, message: `${tagEq ?? a.equipoId}: ${a.atributo} tiene valores contradictorios en el origen.` });
    }
    if (a.vigente === 'SI' && def.multivalor === 'NO') {
      const key = `${a.equipoId}|${a.componenteId ?? ''}|${a.atributo}`;
      vigentes.set(key, (vigentes.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of vigentes) {
    if (n > 1) {
      const [equipoId, componenteId, atributo] = key.split('|');
      const tag = equipos.get(equipoId)?.tag;
      issues.push({ code: 'V-19', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', recordId: equipoId, tag, message: `${tag ?? equipoId}${componenteId ? `/${componenteId}` : ''}: hay ${n} valores vigentes para ${atributo}.` });
    }
  }
}

function checkConexiones(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const equipos = new Map(cat.equipos.map((e) => [e.equipoId, e]));
  const componentes = new Map(cat.componentes.map((c) => [c.componenteId, c]));
  const servicios = new Set(cat.listas.servicio ?? []);

  // Pendientes REFERENCIA_NO_RESUELTA por conexión — explican un extremo vacío.
  const pendientesRefNoResuelta = new Set<string>();
  for (const p of cat.pendientes) {
    if (p.tipo === 'REFERENCIA_NO_RESUELTA' && p.tabla === 'CONEXIONES') {
      pendientesRefNoResuelta.add(p.registroId);
    }
  }

  // Tendidos por conexion_id — para V-11 "sin tendidos".
  const tendidosPorConexion = new Map<string, number>();
  for (const t of cat.tendidos) {
    tendidosPorConexion.set(t.conexionId, (tendidosPorConexion.get(t.conexionId) ?? 0) + 1);
  }

  for (const c of cat.conexiones) {
    if (!c.servicio) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `CONEXIONES ${c.conexionId}: falta servicio.` });
    } else if (servicios.size > 0 && !servicios.has(c.servicio)) {
      issues.push({ code: 'V-07', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, column: 'servicio', message: `CONEXIONES ${c.conexionId}: '${c.servicio}' no es un valor permitido.` });
    }
    // V-11: conexión sin tendidos.
    if ((tendidosPorConexion.get(c.conexionId) ?? 0) === 0) {
      issues.push({ code: 'V-11', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} no tiene tendidos.` });
    }

    // V-12 / V-13 extremo vacío con o sin pendiente.
    if (!c.origenEquipoId) {
      if (pendientesRefNoResuelta.has(c.conexionId)) {
        issues.push({ code: 'V-13', severity: 'ADVERTENCIA', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} se importa sin origen; no se podrá trazar hasta resolverlo.` });
      } else {
        issues.push({ code: 'V-12', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} no tiene origen y no hay un pendiente que lo explique.` });
      }
    } else if (!equipos.has(c.origenEquipoId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, column: 'origen_equipo_id', message: `CONEXIONES ${c.conexionId}: origen_equipo_id ${c.origenEquipoId} no existe.` });
    } else if (equipos.get(c.origenEquipoId)!.estadoAlcance === 'RETIRADO') {
      issues.push({ code: 'V-15', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} usa el equipo retirado ${equipos.get(c.origenEquipoId)!.tag}.` });
    }
    if (!c.destinoEquipoId) {
      if (pendientesRefNoResuelta.has(c.conexionId)) {
        issues.push({ code: 'V-13', severity: 'ADVERTENCIA', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} se importa sin destino; no se podrá trazar hasta resolverlo.` });
      } else {
        issues.push({ code: 'V-12', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} no tiene destino y no hay un pendiente que lo explique.` });
      }
    } else if (!equipos.has(c.destinoEquipoId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, column: 'destino_equipo_id', message: `CONEXIONES ${c.conexionId}: destino_equipo_id ${c.destinoEquipoId} no existe.` });
    } else if (equipos.get(c.destinoEquipoId)!.estadoAlcance === 'RETIRADO') {
      issues.push({ code: 'V-15', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `La conexión ${c.conexionId} usa el equipo retirado ${equipos.get(c.destinoEquipoId)!.tag}.` });
    }
    // V-14: componente de extremo debe estar contenido en el equipo del extremo.
    if (c.origenComponenteId && c.origenEquipoId) {
      const cmp = componentes.get(c.origenComponenteId);
      if (cmp && cmp.contenedorEquipoId !== c.origenEquipoId && cmp.equipoAsociadoId !== c.origenEquipoId) {
        issues.push({ code: 'V-14', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `${c.conexionId}: el componente ${c.origenComponenteId} no pertenece a ${c.origenEquipoId}.` });
      }
    }
    if (c.destinoComponenteId && c.destinoEquipoId) {
      const cmp = componentes.get(c.destinoComponenteId);
      if (cmp && cmp.contenedorEquipoId !== c.destinoEquipoId && cmp.equipoAsociadoId !== c.destinoEquipoId) {
        issues.push({ code: 'V-14', severity: 'ERROR', sheet: 'CONEXIONES', recordId: c.conexionId, message: `${c.conexionId}: el componente ${c.destinoComponenteId} no pertenece a ${c.destinoEquipoId}.` });
      }
    }
  }
}

function checkTendidos(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const conexiones = new Set(cat.conexiones.map((c) => c.conexionId));
  // IDs retirados (no reutilizables) — vienen de TRAZABILIDAD.
  const retirados = new Set<string>();
  for (const t of cat.trazabilidad) {
    if (t.accion === 'EXCLUIDO_RETIRADO' && t.idOrigen) retirados.add(t.idOrigen);
  }
  for (const t of cat.tendidos) {
    if (!t.conexionId) {
      issues.push({ code: 'V-06', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, message: `TENDIDOS ${t.tendidoId}: falta conexion_id.` });
    } else if (!conexiones.has(t.conexionId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, column: 'conexion_id', message: `TENDIDOS ${t.tendidoId}: conexion_id ${t.conexionId} no existe.` });
    }
    if (!(t.cantidadUnidades >= 1)) {
      issues.push({ code: 'V-22', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, message: `${t.tendidoId}: cantidad_unidades inválida.` });
    }
    if (t.conductoresPorUnidad !== undefined && t.conductoresPorUnidad < 1) {
      issues.push({ code: 'V-22', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, message: `${t.tendidoId}: conductores_por_unidad inválida.` });
    }
    // V-21: combinaciones incoherentes.
    if (t.incluyePe === 'SI' && !FUNCIONES_CON_PE.has(t.funcion)) {
      issues.push({ code: 'V-21', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, message: `${t.tendidoId}: incluye_pe=SI con función ${t.funcion} sin PE.` });
    }
    if (t.naturaleza === 'TUBO' && t.seccionMm2 !== undefined) {
      issues.push({ code: 'V-21', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, message: `${t.tendidoId}: TUBO no puede llevar sección eléctrica.` });
    }
    // V-23: ID retirado reutilizado.
    if (retirados.has(t.tendidoId)) {
      issues.push({ code: 'V-23', severity: 'ERROR', sheet: 'TENDIDOS', recordId: t.tendidoId, message: `${t.tendidoId} fue retirado del alcance y no puede reutilizarse.` });
    }
  }
}

function checkAlias(cat: ImportedCatalog, issues: ValidationIssue[]) {
  const equipos = new Map(cat.equipos.map((e) => [e.equipoId, e]));
  const tagsActivos = new Set(
    cat.equipos.filter((e) => e.estadoAlcance !== 'RETIRADO' && e.tag).map((e) => e.tag),
  );
  const porAlias = new Map<string, AliasImportado[]>();
  for (const a of cat.alias) {
    if (!a.equipoId || !equipos.has(a.equipoId)) {
      issues.push({ code: 'V-09', severity: 'ERROR', sheet: 'ALIAS', recordId: a.aliasId, column: 'equipo_id', message: `ALIAS ${a.aliasId}: equipo_id ${a.equipoId} no existe.` });
    }
    if (tagsActivos.has(a.alias)) {
      issues.push({ code: 'V-24', severity: 'ERROR', sheet: 'ALIAS', recordId: a.aliasId, message: `Alias ${a.alias} coincide con un TAG activo.` });
    }
    const list = porAlias.get(a.alias) ?? [];
    list.push(a);
    porAlias.set(a.alias, list);
  }
  for (const [alias, list] of porAlias) {
    const distintos = new Set(list.map((a) => a.equipoId));
    if (distintos.size > 1) {
      issues.push({ code: 'V-24', severity: 'ERROR', sheet: 'ALIAS', recordId: alias, message: `Alias ${alias} ambiguo (resuelve a ${distintos.size} equipos).` });
    }
  }
}

function reflectPendientes(pendientes: PendienteImportado[], issues: ValidationIssue[]) {
  // V-25: trasladar ERROR a nivel registro; las ADVERTENCIA/INFO no las replicamos
  // en issues para no duplicar la pantalla — la vista previa ya muestra la hoja
  // PENDIENTES completa. Replicamos únicamente las ERROR porque bloquean el registro.
  for (const p of pendientes) {
    if (p.severidad === 'ERROR') {
      issues.push({
        code: 'V-25',
        severity: 'ERROR',
        sheet: p.tabla,
        recordId: p.registroId,
        column: p.campo,
        message: `${p.registroId}: ${p.descripcion}`,
      });
    }
  }
}
