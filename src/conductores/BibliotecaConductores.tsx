/**
 * Pestaña «Biblioteca de conductores» de la configuración (parte A del encargo del
 * 2026-11-15): todos los cables, catálogo del motor (solo lectura) y declarados por el
 * operador (se cargan, editan, duplican y borran); cuántos tendidos del Excel casan con
 * cada uno, y la guía de los tendidos sin cable.
 *
 * Los tendidos son los del proyecto abierto: se leen del autoguardado (IndexedDB), sin
 * tocar nada. Esta página no abre ni cambia el proyecto.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadStaticCatalog } from '../catalog/staticCatalog';
import { parseRecord } from '../project/projectSession';
import { readCurrentRecord } from '../project/projectDb';
import type { TendidoImportado } from '../import/types';
import type { CableCatalogo } from '../workspace/cables/catalogoCables';
import {
  BORRADOR_VACIO, borradorDe, duplicarDeCatalogo, entradasBiblioteca, LINEA_DECLARADO, noCalculable, nuevoIdDeclarado,
  ORIGEN_TEXTO, validarBorrador, type BorradorDeclarado, type CableBiblioteca, type CableDeclarado,
} from './biblioteca';
import { tendidosPorCable, tendidosSinCable } from './guia';
import { useConductoresStore } from './store';
import './conductores.css';

type EstadoCatalogo = { fase: 'cargando' } | { fase: 'ok'; cables: CableCatalogo[] } | { fase: 'error'; motivo: string };
type EstadoProyecto = { fase: 'cargando' } | { fase: 'ok'; nombre: string | null; tendidos: TendidoImportado[] | null } | { fase: 'error'; motivo: string };

const num = (v: number | null, dec = 1) => (v === null ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: dec }));
const coma = (n: number) => String(n).replace('.', ',');
const NATURALEZA: Record<string, string> = { CABLE_MULTIPOLAR: 'Multipolar', CONDUCTOR_UNIPOLAR: 'Unipolar' };

function useCatalogo(): EstadoCatalogo {
  const [e, setE] = useState<EstadoCatalogo>({ fase: 'cargando' });
  useEffect(() => {
    let vivo = true;
    loadStaticCatalog()
      .then((c) => {
        if (!vivo) return;
        const r = c.catalogoCables;
        setE(r?.ok ? { fase: 'ok', cables: r.cables } : { fase: 'error', motivo: r ? r.motivo : 'el catálogo estático no trae cables' });
      })
      .catch((err) => vivo && setE({ fase: 'error', motivo: String(err) }));
    return () => { vivo = false; };
  }, []);
  return e;
}

function useTendidosDelProyecto(): EstadoProyecto {
  const [e, setE] = useState<EstadoProyecto>({ fase: 'cargando' });
  useEffect(() => {
    let vivo = true;
    readCurrentRecord()
      .then((raw) => {
        if (!vivo) return;
        if (raw === null) { setE({ fase: 'ok', nombre: null, tendidos: null }); return; }
        const r = parseRecord(raw);
        if (!r.ok) { setE({ fase: 'error', motivo: r.reason }); return; }
        setE({ fase: 'ok', nombre: r.session.fileName, tendidos: r.stored.importedCatalog?.tendidos ?? null });
      })
      .catch((err) => vivo && setE({ fase: 'error', motivo: String(err) }));
    return () => { vivo = false; };
  }, []);
  return e;
}

// ─── Ficha de carga / edición ────────────────────────────────────────────────

function FormularioDeclarado({ inicial, titulo, onGuardar, onCancelar }: {
  inicial: BorradorDeclarado;
  titulo: string;
  onGuardar: (datos: Omit<CableDeclarado, 'cable_id' | 'procedencia'>) => string | null;
  onCancelar: () => void;
}) {
  const [b, setB] = useState(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const campo = (k: keyof BorradorDeclarado) => ({
    value: b[k],
    onChange: (e: { target: { value: string } }) => setB({ ...b, [k]: e.target.value }),
  });
  const guardar = () => {
    const r = validarBorrador(b);
    if (!r.ok) { setErrores(r.errores); return; }
    const err = onGuardar(r.datos);
    setErrores(err ? [err] : []);
  };
  const vista = validarBorrador(b);
  const faltan = noCalculable({
    diametro_exterior_mm: b.diametro_exterior_mm.trim() === '' ? null : 1,
    masa_kg_km: b.masa_kg_km.trim() === '' ? null : 1,
  });
  return (
    <div className="cond-form" data-testid="conductor-form">
      <h4>{titulo}</h4>
      <label>Designación <input data-testid="cf-designacion" {...campo('designacion')} placeholder="p. ej. Sintenax 5 × 6 mm²" /></label>
      <label>Tipo
        <select data-testid="cf-tipo" {...campo('tipo')}>
          <option value="multipolar">Multipolar</option>
          <option value="unipolar">Unipolar</option>
        </select>
      </label>
      <label>Material
        <select data-testid="cf-material" {...campo('material')}>
          <option value="cobre">cobre</option>
          <option value="aluminio">aluminio</option>
        </select>
      </label>
      <label>Conductores <input data-testid="cf-n" inputMode="numeric" {...campo('n_conductores')} /></label>
      <label>Sección (mm², cada conductor) <input data-testid="cf-seccion" inputMode="decimal" {...campo('seccion_mm2')} /></label>
      <label>Diámetro exterior (mm) <input data-testid="cf-diametro" inputMode="decimal" {...campo('diametro_exterior_mm')} placeholder="vacío si no se conoce" /></label>
      <label>Masa (kg/km) <input data-testid="cf-masa" inputMode="decimal" {...campo('masa_kg_km')} placeholder="vacío si no se conoce" /></label>
      {faltan.length > 0 && vista.ok && (
        <p className="cond-aviso" data-testid="cf-no-calculable">Con este cable no se va a poder calcular: {faltan.join('; ')}.</p>
      )}
      {errores.length > 0 && (
        <ul className="cond-errores" data-testid="cf-errores">{errores.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <div className="cond-acciones">
        <button type="button" data-testid="cf-guardar" onClick={guardar}>Guardar</button>
        <button type="button" data-testid="cf-cancelar" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Ficha de un cable ───────────────────────────────────────────────────────

function Ficha({ c, tendidos, catalogo, onEditar, onDuplicado, onBorrado }: {
  c: CableBiblioteca;
  tendidos: number | null;
  catalogo: readonly CableCatalogo[];
  onEditar: () => void;
  onDuplicado: (id: string) => void;
  onBorrado: () => void;
}) {
  const { agregar, borrar } = useConductoresStore();
  const [msg, setMsg] = useState<string | null>(null);
  const d = c.declarado;
  const faltan = d ? noCalculable(d) : [];
  const duplicar = () => {
    const fuente = catalogo.find((x) => x.cable_id === c.cable_id);
    if (!fuente) return;
    const r = duplicarDeCatalogo(fuente);
    if (!r.ok) { setMsg(r.motivo); return; }
    const err = agregar(r.cable);
    if (err) setMsg(err); else onDuplicado(r.cable.cable_id);
  };
  const quitar = () => {
    if (!window.confirm(`¿Borrar el cable declarado «${c.designacion}»? Esto no se puede deshacer.`)) return;
    const err = borrar(c.cable_id);
    if (err) setMsg(err); else onBorrado();
  };
  return (
    <div className="cond-ficha" data-testid="conductor-ficha" data-cable-id={c.cable_id} data-origen={c.origen}>
      <h4>{c.designacion}</h4>
      <dl>
        <dt>Origen</dt><dd data-testid="conductor-origen">{ORIGEN_TEXTO[c.origen]}</dd>
        <dt>Id</dt><dd><code>{c.cable_id}</code></dd>
        <dt>Línea</dt><dd>{c.linea}</dd>
        <dt>Tipo</dt><dd>{c.tipoTexto}</dd>
        <dt>Conductores</dt><dd>{c.n_conductores}</dd>
        <dt>Sección</dt><dd>{c.formacion} mm²</dd>
        <dt>Diámetro exterior</dt><dd data-testid="conductor-diametro">{c.diametro_exterior_mm === null ? 'no declarado' : `${num(c.diametro_exterior_mm)} mm`}</dd>
        <dt>Masa</dt><dd data-testid="conductor-masa">{c.masa_kg_km === null ? 'no declarada' : `${num(c.masa_kg_km, 0)} kg/km`}</dd>
        <dt>Tendidos del Excel</dt><dd>{tendidos === null ? 'sin Excel en el proyecto' : `${tendidos} casan con este cable`}</dd>
      </dl>
      {d && (
        <p className="cond-procedencia" data-testid="conductor-procedencia">
          Declarado por el operador el {new Date(d.procedencia.declaradoEl).toLocaleString('es-AR')}.
          {d.procedencia.duplicadoDe && <> Duplicado de <code>{d.procedencia.duplicadoDe.cable_id}</code> ({d.procedencia.duplicadoDe.texto}) del catálogo del motor.</>}
        </p>
      )}
      {faltan.length > 0 && (
        <p className="cond-aviso" data-testid="conductor-no-calculable">Con este cable no se puede calcular: {faltan.join('; ')}.</p>
      )}
      {c.origen === 'catalogo' ? (
        <>
          <p className="cond-solo-lectura" data-testid="conductor-solo-lectura">
            Solo lectura: es dato vendorizado del catálogo del motor. Para partir de él, duplicalo: la copia nace
            declarada por el operador.
          </p>
          <div className="cond-acciones">
            <button type="button" data-testid="conductor-duplicar" onClick={duplicar}>Duplicar como declarado</button>
          </div>
        </>
      ) : (
        <div className="cond-acciones">
          <button type="button" data-testid="conductor-editar" onClick={onEditar}>Editar</button>
          <button type="button" data-testid="conductor-borrar" onClick={quitar}>Borrar</button>
        </div>
      )}
      {msg && <p className="cond-errores" data-testid="conductor-msg">{msg}</p>}
    </div>
  );
}

// ─── Guía de tendidos sin cable ──────────────────────────────────────────────

function Guia({ tendidos, catalogo, declarados, onCargar }: {
  tendidos: readonly TendidoImportado[];
  catalogo: readonly CableCatalogo[];
  declarados: readonly CableDeclarado[];
  onCargar: (b: BorradorDeclarado) => void;
}) {
  const g = useMemo(() => tendidosSinCable(tendidos, catalogo, declarados), [tendidos, catalogo, declarados]);
  return (
    <section className="cond-guia" data-testid="conductores-guia">
      <h4>Tendidos sin cable de catálogo</h4>
      <p>
        Agrupados por naturaleza, conductores y sección: lo que conviene cargar. Cada combinación destraba los tendidos
        que lista. Mismo criterio que el casamiento de los tendidos.
      </p>
      <table className="cond-tabla">
        <thead>
          <tr><th>Naturaleza</th><th>Formación</th><th>Tendidos que destraba</th><th>Por qué no casa con el catálogo</th><th>Declarados que ya casan</th><th /></tr>
        </thead>
        <tbody>
          {g.combinaciones.map((k) => (
            <tr key={k.clave} data-testid="guia-combinacion" data-clave={k.clave} data-n={k.tendidoIds.length}
              data-cubierta={k.cubiertaPor.reduce((s, x) => Math.max(s, x.tendidos), 0)}>
              <td>{NATURALEZA[k.naturaleza] ?? k.naturaleza}</td>
              <td>{k.conductores} × {coma(k.seccion_mm2)} mm²</td>
              <td title={k.tendidoIds.join(', ')}>{k.tendidoIds.length}</td>
              <td>{k.motivo}</td>
              <td>{k.cubiertaPor.length ? k.cubiertaPor.map((x) => `${x.designacion} (${x.tendidos})`).join(', ') : '—'}</td>
              <td>
                <button type="button" data-testid="guia-cargar" onClick={() => onCargar({
                  ...BORRADOR_VACIO,
                  tipo: k.naturaleza === 'CONDUCTOR_UNIPOLAR' ? 'unipolar' : 'multipolar',
                  n_conductores: String(k.conductores),
                  seccion_mm2: coma(k.seccion_mm2),
                })}>Cargar uno</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {g.fuera.length > 0 && (
        <>
          <h5>Sin cable y fuera de esta guía</h5>
          <ul data-testid="guia-fuera">
            {g.fuera.map((f) => <li key={f.motivo} data-n={f.tendidoIds.length}>{f.tendidoIds.length} tendido(s): {f.motivo}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}

// ─── Pestaña ─────────────────────────────────────────────────────────────────

type Edicion = { modo: 'nuevo'; inicial: BorradorDeclarado } | { modo: 'editar'; cable: CableDeclarado } | null;

export function BibliotecaConductores() {
  const catalogo = useCatalogo();
  const proyecto = useTendidosDelProyecto();
  const { cables: declarados, hidratado, hidratar, errorLectura, agregar, actualizar } = useConductoresStore();
  useEffect(() => { if (!hidratado) hidratar(); }, [hidratado, hidratar]);

  const [linea, setLinea] = useState('');
  const [tipo, setTipo] = useState('');
  const [seccion, setSeccion] = useState('');
  const [texto, setTexto] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [verGuia, setVerGuia] = useState(false);

  const cat = catalogo.fase === 'ok' ? catalogo.cables : [];
  const todos = useMemo(() => entradasBiblioteca(cat, declarados), [cat, declarados]);
  const tendidos = proyecto.fase === 'ok' ? proyecto.tendidos : null;
  const conteo = useMemo(() => (tendidos ? tendidosPorCable(tendidos, cat, declarados) : null), [tendidos, cat, declarados]);
  const guia = useMemo(() => (tendidos ? tendidosSinCable(tendidos, cat, declarados) : null), [tendidos, cat, declarados]);

  const lineas = useMemo(() => [...new Set(todos.map((c) => c.linea))], [todos]);
  const tipos = useMemo(() => [...new Set(todos.map((c) => c.tipoTexto))], [todos]);
  const secciones = useMemo(() => [...new Set(todos.map((c) => c.seccion_mm2))].sort((a, b) => a - b), [todos]);
  const q = texto.trim().toLowerCase();
  const visibles = todos.filter((c) => (!linea || c.linea === linea) && (!tipo || c.tipoTexto === tipo)
    && (!seccion || String(c.seccion_mm2) === seccion)
    && (!q || `${c.designacion} ${c.cable_id} ${c.linea} ${c.tipoTexto} ${c.n_conductores}x${c.formacion}`.toLowerCase().includes(q)));
  const elegido = todos.find((c) => c.cable_id === sel) ?? null;

  const guardarNuevo = (datos: Omit<CableDeclarado, 'cable_id' | 'procedencia'>) => {
    const c: CableDeclarado = { ...datos, cable_id: nuevoIdDeclarado(), procedencia: { declaradoEl: new Date().toISOString() } };
    const err = agregar(c);
    if (!err) { setEdicion(null); setSel(c.cable_id); }
    return err;
  };
  const guardarEdicion = (orig: CableDeclarado) => (datos: Omit<CableDeclarado, 'cable_id' | 'procedencia'>) => {
    const err = actualizar({ ...orig, ...datos });
    if (!err) setEdicion(null);
    return err;
  };

  return (
    <div className="cond-root" data-testid="conductores-root">
      <div className="cond-cabecera">
        <select data-testid="conductores-filtro-linea" value={linea} onChange={(e) => setLinea(e.target.value)} aria-label="Línea">
          <option value="">Todas las líneas</option>
          {lineas.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select data-testid="conductores-filtro-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select data-testid="conductores-filtro-seccion" value={seccion} onChange={(e) => setSeccion(e.target.value)} aria-label="Sección">
          <option value="">Todas las secciones</option>
          {secciones.map((s) => <option key={s} value={String(s)}>{coma(s)} mm²</option>)}
        </select>
        <input data-testid="conductores-buscar" type="search" placeholder="Buscar" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar" />
        <span className="cond-cuenta" data-testid="conductores-cuenta">{visibles.length} de {todos.length}</span>
        <span className="cond-espacio" />
        <button type="button" data-testid="conductores-nuevo" disabled={!!errorLectura}
          onClick={() => { setEdicion({ modo: 'nuevo', inicial: BORRADOR_VACIO }); setSel(null); }}>
          Cargar cable declarado
        </button>
        <button type="button" data-testid="conductores-guia-abrir" disabled={!guia} onClick={() => setVerGuia(!verGuia)}
          title={guia ? undefined : 'El proyecto abierto no tiene Excel importado'}>
          {guia ? `Tendidos sin cable (${guia.combinaciones.reduce((s, k) => s + k.tendidoIds.length, 0)})` : 'Tendidos sin cable'}
        </button>
      </div>
      <p className="cond-proyecto" data-testid="conductores-proyecto">
        {proyecto.fase === 'cargando' && 'Leyendo el proyecto abierto…'}
        {proyecto.fase === 'error' && `No se pudo leer el proyecto abierto: ${proyecto.motivo}`}
        {proyecto.fase === 'ok' && (tendidos
          ? `Tendidos del Excel del proyecto abierto${proyecto.nombre ? ` («${proyecto.nombre}»)` : ''}: ${tendidos.length}.`
          : 'El proyecto abierto no tiene Excel importado: no hay tendidos que contar.')}
      </p>
      {catalogo.fase === 'error' && <p className="cond-errores" data-testid="conductores-sin-catalogo">Catálogo de cables del motor no disponible: {catalogo.motivo}</p>}
      {errorLectura && <p className="cond-errores" data-testid="conductores-error-lectura">{errorLectura}. No se escribe encima de la biblioteca local.</p>}
      {verGuia && tendidos && (
        <Guia tendidos={tendidos} catalogo={cat} declarados={declarados}
          onCargar={(b) => { setEdicion({ modo: 'nuevo', inicial: b }); setSel(null); }} />
      )}
      <div className="cond-cuerpo">
        <div className="cond-lista">
          <table className="cond-tabla">
            <thead>
              <tr><th>Designación</th><th>Línea</th><th>Tipo</th><th>Cond.</th><th>Sección</th><th>Ø ext. (mm)</th><th>Masa (kg/km)</th><th>Origen</th><th>Tendidos</th></tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.cable_id} data-testid="conductor-fila" data-cable-id={c.cable_id} data-origen={c.origen}
                  data-tendidos={conteo ? conteo.get(c.cable_id) ?? 0 : ''}
                  className={c.cable_id === sel ? 'is-sel' : undefined} onClick={() => { setSel(c.cable_id); setEdicion(null); }}>
                  <td>{c.designacion}</td>
                  <td>{c.linea === LINEA_DECLARADO ? '—' : c.linea}</td>
                  <td>{c.tipoTexto}</td>
                  <td>{c.n_conductores}</td>
                  <td>{c.formacion}</td>
                  <td>{num(c.diametro_exterior_mm)}</td>
                  <td>{num(c.masa_kg_km, 0)}</td>
                  <td><span className={`cond-origen cond-origen--${c.origen}`}>{ORIGEN_TEXTO[c.origen]}</span></td>
                  <td>{conteo ? conteo.get(c.cable_id) ?? 0 : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="cond-lado">
          {edicion?.modo === 'nuevo' && (
            <FormularioDeclarado key={JSON.stringify(edicion.inicial)} titulo="Cargar cable declarado" inicial={edicion.inicial}
              onGuardar={guardarNuevo} onCancelar={() => setEdicion(null)} />
          )}
          {edicion?.modo === 'editar' && (
            <FormularioDeclarado key={edicion.cable.cable_id} titulo={`Editar ${edicion.cable.designacion}`} inicial={borradorDe(edicion.cable)}
              onGuardar={guardarEdicion(edicion.cable)} onCancelar={() => setEdicion(null)} />
          )}
          {!edicion && elegido && (
            <Ficha c={elegido} catalogo={cat} tendidos={conteo ? conteo.get(elegido.cable_id) ?? 0 : null}
              onEditar={() => elegido.declarado && setEdicion({ modo: 'editar', cable: elegido.declarado })}
              onDuplicado={(id) => setSel(id)} onBorrado={() => setSel(null)} />
          )}
          {!edicion && !elegido && <p className="cond-vacio">Elegí un cable de la lista para ver su ficha.</p>}
        </aside>
      </div>
    </div>
  );
}
