/**
 * Ficha técnica de un equipo, de los atributos importados del Excel (etapa 3): todos los
 * vigentes, agrupados como en CATALOGO_ATRIBUTOS, con valor, estado del dato y origen del
 * valor, y la celda del Excel de donde salen. Sólo lectura: es dato importado.
 */
import type { AtributoImportado, ImportedCatalog } from '../import/types';

const valor = (a: AtributoImportado) =>
  a.valorNumero !== undefined && a.valorNumero !== null
    ? `${a.valorNumero.toLocaleString('es-AR', { maximumFractionDigits: 3 })}${a.unidad ? ` ${a.unidad}` : ''}`
    : a.valorTexto ?? 'sin valor';

export function FichaTecnica({ catalog, equipoId }: { catalog: ImportedCatalog; equipoId: string }) {
  const propios = catalog.atributos.filter((a) => a.equipoId === equipoId && !a.componenteId);
  const vigentes = propios.filter((a) => a.vigente === 'SI');
  const def = new Map(catalog.catalogoAtributos.map((c) => [c.atributo, c] as const));
  const grupos = new Map<string, AtributoImportado[]>();
  for (const a of vigentes) {
    const g = def.get(a.atributo)?.grupo ?? 'Sin grupo';
    grupos.set(g, [...(grupos.get(g) ?? []), a]);
  }
  return (
    <div data-testid="ficha-tecnica" style={{ marginTop: 6, fontSize: 11 }}>
      <div style={{ color: '#8f9ba3' }} data-testid="ficha-tecnica-procedencia">
        Ficha técnica del Excel ({catalog.meta.nombreArchivo}) · sólo lectura: es dato importado
      </div>
      {vigentes.length === 0 && <div style={{ color: '#8f9ba3' }}>El Excel no trae atributos vigentes para {equipoId}.</div>}
      {[...grupos].map(([g, lista]) => (
        <div key={g} style={{ marginTop: 4 }}>
          <div style={{ color: '#ebb0ff' }}>{g}</div>
          {lista.map((a) => (
            <div key={a.atributoId} data-testid="ficha-atributo" data-atributo={a.atributo} data-estado={a.estadoDato} data-origen={a.origenValor}
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
              title={`Excel: ${a.fuenteHoja}${a.fuenteFila ? ` fila ${a.fuenteFila}` : ''}${a.fuenteColumna ? `, columna ${a.fuenteColumna}` : ''}${a.observaciones ? ` — ${a.observaciones}` : ''}`}>
              <span style={{ color: '#8f9ba3' }}>{def.get(a.atributo)?.nombre ?? a.atributo}:</span>
              <span data-testid="ficha-valor">{valor(a)}</span>
              <span className="imported-attr-badge origen" title="Origen del valor">{a.origenValor}</span>
              <span className={`imported-attr-badge ${a.estadoDato}`} title="Estado del dato">{a.estadoDato}</span>
            </div>
          ))}
        </div>
      ))}
      {propios.length > vigentes.length && (
        <div style={{ color: '#8f9ba3', marginTop: 2 }}>{propios.length - vigentes.length} atributo(s) no vigente(s) en el Excel: no se muestran.</div>
      )}
    </div>
  );
}
