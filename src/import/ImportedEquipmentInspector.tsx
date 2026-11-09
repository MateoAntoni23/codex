/**
 * ImportedEquipmentInspector — ficha técnica de un equipo del libro ELS-IMP-EQCX.
 * - Encabezado: tag, estado de alcance, categoría.
 * - Atributos técnicos agrupados por CATALOGO_ATRIBUTOS.grupo (A10).
 *   Cada atributo muestra: nombre, valor+unidad, origen y estadoDato como badge.
 *   Alternativas (vigente=NO) van en bloque colapsable al final (A14).
 * - Componentes internos del equipo con sus propios atributos.
 * - Alias, pendientes del equipo y trazabilidad: paneles secundarios.
 */
import { useMemo } from 'react';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import type {
  AtributoImportado,
  CatalogoAtributo,
  ImportedCatalog,
  ComponenteImportado,
} from './types';

function fmtValor(a: AtributoImportado): string {
  if (a.valorTexto !== undefined && a.valorTexto !== '') {
    return a.unidad ? `${a.valorTexto} ${a.unidad}` : a.valorTexto;
  }
  if (a.valorNumero !== undefined && a.valorNumero !== null) {
    const n = a.valorNumero;
    // Evitar notación científica para valores comunes; redondear decimales largos.
    const txt = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
    return a.unidad ? `${txt} ${a.unidad}` : txt;
  }
  return '—';
}

function groupAttributes(
  atributos: AtributoImportado[],
  cat: CatalogoAtributo[],
): Array<{ grupo: string; items: Array<{ atr: AtributoImportado; def?: CatalogoAtributo }> }> {
  const defByKey = new Map(cat.map((c) => [c.atributo, c] as const));
  const bucket = new Map<string, Array<{ atr: AtributoImportado; def?: CatalogoAtributo }>>();
  for (const atr of atributos) {
    const def = defByKey.get(atr.atributo);
    const grupo = def?.grupo || 'OTROS';
    const list = bucket.get(grupo);
    if (list) list.push({ atr, def });
    else bucket.set(grupo, [{ atr, def }]);
  }
  return [...bucket.entries()]
    .map(([grupo, items]) => ({
      grupo,
      items: items.sort((a, b) => (a.def?.nombre ?? a.atr.atributo).localeCompare(b.def?.nombre ?? b.atr.atributo)),
    }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo));
}

function AttrRow({ atr, def }: { atr: AtributoImportado; def?: CatalogoAtributo }) {
  return (
    <div className="imported-attr-row">
      <div className="imported-attr-label">{def?.nombre ?? atr.atributo}</div>
      <div className="imported-attr-value">
        {fmtValor(atr)}
        <span className={`imported-attr-badge origen`} title="Origen del valor">{atr.origenValor}</span>
        <span className={`imported-attr-badge ${atr.estadoDato}`} title="Estado del dato">{atr.estadoDato}</span>
      </div>
    </div>
  );
}

function ComponenteCard({
  c,
  atributos,
  cat,
}: {
  c: ComponenteImportado;
  atributos: AtributoImportado[];
  cat: CatalogoAtributo[];
}) {
  const propios = atributos.filter((a) => a.componenteId === c.componenteId && a.vigente === 'SI');
  const alternativas = atributos.filter((a) => a.componenteId === c.componenteId && a.vigente === 'NO');
  const groups = groupAttributes(propios, cat);

  return (
    <div className="cmp-card">
      <div>
        <strong>{c.tipoComponente}</strong>
        {c.tag ? <span style={{ color: '#8f9ba3' }}> · {c.tag}</span> : null}
        <span style={{ color: '#8f9ba3' }}> · x{c.cantidad}</span>
      </div>
      <div style={{ color: '#8f9ba3', marginTop: 2 }}>{c.descripcion}</div>
      {c.codigoReferencia && (
        <div style={{ color: '#8f9ba3', marginTop: 2, fontFamily: 'monospace', fontSize: 11 }}>
          {c.marca ? `${c.marca} · ` : ''}{c.codigoReferencia}
        </div>
      )}
      {groups.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {groups.map(({ grupo, items }) => (
            <div key={grupo} className="imported-attr-group">
              <h4>{grupo}</h4>
              {items.map(({ atr, def }) => <AttrRow key={atr.atributoId} atr={atr} def={def} />)}
            </div>
          ))}
        </div>
      )}
      {alternativas.length > 0 && (
        <details className="imported-alternatives">
          <summary style={{ cursor: 'pointer' }}>
            Alternativas en conflicto ({alternativas.length})
          </summary>
          {alternativas.map((a) => (
            <div key={a.atributoId} className="alt-item">
              {a.atributo}: {fmtValor(a)} [{a.estadoDato}] ← {a.origenValor}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export function ImportedEquipmentInspector() {
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const selectedId = useWorkspaceStore((s) => s.selectedImportedEquipoId);

  const data = useMemo(() => buildEquipoView(catalog, selectedId), [catalog, selectedId]);

  if (!catalog || !selectedId || !data) {
    return (
      <div className="imported-inspector">
        <p style={{ color: '#8f9ba3', fontSize: 12 }}>
          Elegí un equipo importado en el árbol para ver su ficha técnica.
        </p>
      </div>
    );
  }

  const {
    equipo, atributosEquipo, atributosAlternativos,
    componentes, alias, pendientes, conexionesRelacionadas,
  } = data;

  const groups = groupAttributes(atributosEquipo, catalog.catalogoAtributos);

  return (
    <div className="imported-inspector">
      <div>
        <span className="tag">{equipo.tag}</span>
        <h3 style={{ display: 'inline' }}>{equipo.descripcion}</h3>
        <div className="cat">
          {equipo.categoria}{equipo.tipoOrigen ? ` · ${equipo.tipoOrigen}` : ''}
          {' · '}
          <span className={`estado-${equipo.estadoAlcance}`}>
            {equipo.estadoAlcance}
            {equipo.estadoAlcanceConfirmado === 'NO' ? ' (a confirmar)' : ''}
          </span>
        </div>
        <div className="cat" style={{ marginTop: 2 }}>
          ID: <span className="tag">{equipo.equipoId}</span>
          {equipo.planta ? ` · Planta: ${equipo.planta}` : ''}
          {equipo.sector ? ` · Sector: ${equipo.sector}` : ''}
          {equipo.subsector ? ` · ${equipo.subsector}` : ''}
          {equipo.ubicacionDescriptiva ? ` · ${equipo.ubicacionDescriptiva}` : ''}
          {equipo.nivel ? ` · Nivel ${equipo.nivel}` : ''}
        </div>
        {equipo.observaciones && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#ffcc55' }}>
            Observaciones: {equipo.observaciones}
          </div>
        )}
      </div>

      {groups.length > 0 ? (
        groups.map(({ grupo, items }) => (
          <div key={grupo} className="imported-attr-group">
            <h4>{grupo}</h4>
            {items.map(({ atr, def }) => <AttrRow key={atr.atributoId} atr={atr} def={def} />)}
          </div>
        ))
      ) : (
        <p style={{ color: '#8f9ba3', fontSize: 12, marginTop: 10 }}>
          Sin atributos técnicos vigentes para este equipo.
        </p>
      )}

      {atributosAlternativos.length > 0 && (
        <details className="imported-alternatives">
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#ebb0ff' }}>
            Alternativas y conflictos ({atributosAlternativos.length})
          </summary>
          {atributosAlternativos.map((a) => (
            <div key={a.atributoId} className="alt-item">
              {a.atributo}: {fmtValor(a)} [{a.estadoDato}] ← {a.origenValor}
              {a.observaciones ? ` — ${a.observaciones}` : ''}
            </div>
          ))}
        </details>
      )}

      {componentes.length > 0 && (
        <div className="imported-components">
          <h4 style={{ color: '#8f9ba3', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 6px' }}>
            Componentes internos ({componentes.length})
          </h4>
          {componentes.map((c) => (
            <ComponenteCard key={c.componenteId} c={c} atributos={catalog.atributos} cat={catalog.catalogoAtributos} />
          ))}
        </div>
      )}

      {conexionesRelacionadas.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ color: '#8f9ba3', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
            Conexiones ({conexionesRelacionadas.length})
          </h4>
          {conexionesRelacionadas.map((c) => (
            <div key={c.conexionId} className="cmp-card">
              <div><strong>{c.conexionId}</strong> · {c.servicio}</div>
              <div style={{ color: '#8f9ba3', marginTop: 2, fontSize: 12 }}>{c.descripcion}</div>
              <div style={{ color: '#8f9ba3', marginTop: 2, fontSize: 11, fontFamily: 'monospace' }}>
                {c.origenTextoOriginal || '(sin origen)'} → {c.destinoTextoOriginal || '(sin destino)'}
              </div>
            </div>
          ))}
        </div>
      )}

      {alias.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ color: '#8f9ba3', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
            Alias
          </h4>
          {alias.map((a) => (
            <div key={a.aliasId} style={{ fontSize: 12, padding: '3px 0', color: '#e5e9ec' }}>
              <span style={{ fontFamily: 'monospace' }}>{a.alias}</span>
              <span style={{ color: '#8f9ba3' }}> · {a.tipoAlias} · {a.fuente}</span>
            </div>
          ))}
        </div>
      )}

      {pendientes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ color: '#8f9ba3', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
            Pendientes del equipo ({pendientes.length})
          </h4>
          {pendientes.map((p) => (
            <div key={p.pendienteId} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px dashed #1f262b' }}>
              <span className={`imported-attr-badge ${p.severidad === 'ERROR' ? 'CONFLICTO' : p.severidad === 'ADVERTENCIA' ? 'PENDIENTE' : 'A_CONFIRMAR'}`}>
                {p.severidad}
              </span>
              <span style={{ marginLeft: 6, color: '#8f9ba3', fontFamily: 'monospace' }}>{p.tipo}</span>
              <div style={{ color: '#e5e9ec', marginTop: 2 }}>{p.descripcion}</div>
              {p.accionSugerida && (
                <div style={{ color: '#8f9ba3', marginTop: 2 }}>→ {p.accionSugerida}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildEquipoView(catalog: ImportedCatalog | null, selectedId: string | null) {
  if (!catalog || !selectedId) return null;
  const equipo = catalog.equipos.find((e) => e.equipoId === selectedId);
  if (!equipo) return null;
  const atributosDelEquipo = catalog.atributos.filter(
    (a) => a.equipoId === selectedId && !a.componenteId,
  );
  const atributosEquipo = atributosDelEquipo.filter((a) => a.vigente === 'SI');
  const atributosAlternativos = atributosDelEquipo.filter((a) => a.vigente === 'NO');
  const componentes = catalog.componentes.filter((c) => c.contenedorEquipoId === selectedId);
  const alias = catalog.alias.filter((a) => a.equipoId === selectedId);
  const pendientes = catalog.pendientes.filter(
    (p) => p.registroId === selectedId || p.registroId === equipo.tag,
  );
  const conexionesRelacionadas = catalog.conexiones.filter(
    (c) => c.origenEquipoId === selectedId || c.destinoEquipoId === selectedId,
  );
  return {
    equipo,
    atributosEquipo,
    atributosAlternativos,
    componentes,
    alias,
    pendientes,
    conexionesRelacionadas,
  };
}
