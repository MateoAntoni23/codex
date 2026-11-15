/**
 * Parte civil en la etapa Planta (A6): a la izquierda, los archivos agrupados por
 * nivel; en el inspector, la importación (declarar tipo y nivel, ver medidas y
 * confirmar) o el archivo seleccionado con sus datos y acciones.
 */
import { useRef } from 'react';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useParteCivilStore, triangulosCiviles } from './parteCivilStore';
import { convertirStep } from './convertir';
import { avisoDePeso } from './peso';
import {
  cajaEnApp, EJES_VERTICALES, NOMBRE_TIPO_CIVIL, TIPOS_CIVIL, type ArchivoCivil, type EjeVertical, type TipoCivil,
} from './modelo';

const mm = (n: number) => `${Math.round(n).toLocaleString('es-AR')} mm`;
const miles = (n: number) => n.toLocaleString('es-AR');

/** Convierte el STEP en el servicio y deja la importación esperando la declaración del operador. */
export async function iniciarImportacion(archivo: File, reemplaza?: ArchivoCivil): Promise<void> {
  const st = useParteCivilStore.getState();
  st.setError(null);
  st.setPendiente(null);
  st.setConvirtiendo(archivo.name);
  const r = await convertirStep(archivo);
  st.setConvirtiendo(null);
  if (!r.ok) { st.setError(r.motivo); return; }
  st.setPendiente(reemplaza
    ? { modo: 'reemplazar', reemplazaId: reemplaza.id, nombreArchivo: archivo.name, malla: r.malla, tipo: reemplaza.tipo, nivel: { ...reemplaza.nivel }, ejeVertical: reemplaza.ejeVertical }
    : { modo: 'nuevo', nombreArchivo: archivo.name, malla: r.malla, tipo: null, nivel: { nombre: '', cotaMm: null }, ejeVertical: 'Z' });
}

function seleccionarCivil(id: string | null) {
  useWorkspaceStore.getState().selectEquip(null);
  useParteCivilStore.getState().seleccionar(id);
}

// ─── Lista (panel izquierdo) ─────────────────────────────────────────────────

export function ListaCivil() {
  const archivos = useParteCivilStore((s) => s.archivos);
  const seleccionado = useParteCivilStore((s) => s.seleccionado);
  const convirtiendo = useParteCivilStore((s) => s.convirtiendo);
  const error = useParteCivilStore((s) => s.error);
  const input = useRef<HTMLInputElement | null>(null);

  const niveles = new Map<string, { cota: number; archivos: ArchivoCivil[] }>();
  for (const a of archivos) {
    const n = niveles.get(a.nivel.nombre) ?? niveles.set(a.nivel.nombre, { cota: a.nivel.cotaMm, archivos: [] }).get(a.nivel.nombre)!;
    n.archivos.push(a);
  }
  const orden = [...niveles.entries()].sort((x, y) => x[1].cota - y[1].cota || x[0].localeCompare(y[0]));

  return (
    <section className="stage-section" data-testid="civil-lista">
      <h4 className="stage-section-title">Parte civil ({archivos.length})</h4>
      <button type="button" className="stage-primary" data-testid="civil-importar" disabled={!!convirtiendo} onClick={() => input.current?.click()}>
        Importar STEP…
      </button>
      <input
        ref={input}
        type="file"
        accept=".stp,.step,.STP,.STEP"
        style={{ display: 'none' }}
        data-testid="civil-importar-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void iniciarImportacion(f);
        }}
      />
      {convirtiendo && <p className="stage-note" role="status" data-testid="civil-convirtiendo">Convirtiendo {convirtiendo}…</p>}
      {error && <p className="stage-note tone-warn" role="alert" data-testid="civil-error" style={{ whiteSpace: 'normal' }}>{error}</p>}
      {archivos.length === 0 && !convirtiendo && (
        <p className="stage-note" style={{ whiteSpace: 'normal' }}>Un archivo STEP por piso y por tipo (p. ej. PB-columnas.stp). Al importar declarás el tipo y el nivel.</p>
      )}
      {orden.map(([nombre, n]) => (
        <details key={nombre} className="grupo-piezas" open data-testid={`civil-nivel-${nombre}`}>
          <summary>{nombre} · cota {mm(n.cota)} ({n.archivos.length})</summary>
          {n.archivos.map((a) => (
            <button
              key={a.id}
              type="button"
              data-row-key={`civil:${a.id}`}
              className={`workspace-tree-item stage-row${seleccionado === a.id ? ' active' : ''}`}
              aria-current={seleccionado === a.id ? 'true' : undefined}
              onClick={() => seleccionarCivil(a.id)}
            >
              {NOMBRE_TIPO_CIVIL[a.tipo]} · {a.nombre}
            </button>
          ))}
        </details>
      ))}
    </section>
  );
}

// ─── Importación (inspector) ─────────────────────────────────────────────────

export function ImportarCivilForm() {
  const p = useParteCivilStore((s) => s.pendiente);
  const archivos = useParteCivilStore((s) => s.archivos);
  const editar = useParteCivilStore((s) => s.editarPendiente);
  if (!p) return null;
  const caja = cajaEnApp(p.malla, p.ejeVertical);
  const actuales = triangulosCiviles(archivos.filter((a) => a.id !== p.reemplazaId));
  const aviso = avisoDePeso(actuales, p.malla.triangulos);
  const faltan = [!p.tipo && 'el tipo', !p.nivel.nombre.trim() && 'el nombre del nivel', (p.nivel.cotaMm === null || !Number.isFinite(p.nivel.cotaMm)) && 'la cota del nivel'].filter(Boolean) as string[];
  const reemplaza = p.modo === 'reemplazar';

  const confirmar = () => {
    const id = useParteCivilStore.getState().confirmarPendiente();
    if (id) useWorkspaceStore.getState().markDirty();
  };

  return (
    <div className="inspector-panel" data-testid="civil-importacion">
      <div className="inspector-header inspector-fijo-arriba" style={{ display: 'flex', alignItems: 'center' }}>
        <span className="inspector-title" style={{ flex: 1 }}>{reemplaza ? 'Reemplazar archivo civil' : 'Importar parte civil'}</span>
        <button type="button" data-testid="civil-cancelar" onClick={() => useParteCivilStore.getState().setPendiente(null)}>Cancelar</button>
      </div>
      <div style={{ padding: '6px 12px', display: 'grid', gap: 6, fontSize: 12 }}>
        <div data-testid="civil-archivo"><strong>{p.nombreArchivo}</strong></div>
        {reemplaza && <p className="stage-note" style={{ whiteSpace: 'normal' }}>Se conservan el tipo, el nivel y la posición; cambia sólo la geometría.</p>}

        <label style={{ display: 'grid', gap: 2 }}>Tipo
          <select className="inspector-input" data-testid="civil-tipo" value={p.tipo ?? ''} disabled={reemplaza} onChange={(e) => editar({ tipo: (e.target.value || null) as TipoCivil | null })}>
            <option value="">— Elegí el tipo —</option>
            {TIPOS_CIVIL.map((t) => <option key={t} value={t}>{NOMBRE_TIPO_CIVIL[t]}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ display: 'grid', gap: 2, flex: 1 }}>Nivel
            <input className="inspector-input" data-testid="civil-nivel-nombre" placeholder="PB, P1…" value={p.nivel.nombre} disabled={reemplaza} onChange={(e) => editar({ nivel: { nombre: e.target.value } })} />
          </label>
          <label style={{ display: 'grid', gap: 2, width: 110 }}>Cota (mm)
            <input className="inspector-input" type="number" data-testid="civil-nivel-cota" value={p.nivel.cotaMm ?? ''} disabled={reemplaza}
              onChange={(e) => editar({ nivel: { cotaMm: e.target.value.trim() === '' ? null : Number(e.target.value) } })} />
          </label>
        </div>

        <fieldset style={{ border: '1px solid var(--ws-border)', padding: '4px 8px', borderRadius: 3 }} data-testid="civil-medidas">
          <legend>Lo que se leyó del STEP</legend>
          <div data-testid="civil-unidades">Unidades: {p.malla.unidades.texto}</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Altura (eje del archivo)
            <select className="inspector-input" data-testid="civil-eje" value={p.ejeVertical} disabled={reemplaza} onChange={(e) => editar({ ejeVertical: e.target.value as EjeVertical })}>
              {EJES_VERTICALES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <div data-testid="civil-caja" data-ancho={Math.round(caja.ancho)} data-fondo={Math.round(caja.fondo)} data-alto={Math.round(caja.alto)}>
            Caja: {mm(caja.ancho)} ancho × {mm(caja.fondo)} fondo × <strong>{mm(caja.alto)} alto</strong>
          </div>
          <div data-testid="civil-triangulos" data-triangulos={p.malla.triangulos}>
            {miles(p.malla.solidos)} sólido(s) · {miles(p.malla.triangulos)} triángulos
          </div>
          <p className="stage-note" style={{ whiteSpace: 'normal' }}>
            Revisá el alto: si una columna o un muro aparecen acostados, el eje de la altura es otro.
          </p>
        </fieldset>

        {aviso && <p className="stage-note tone-warn" role="alert" data-testid="civil-aviso-peso" style={{ whiteSpace: 'normal' }}>⚠ {aviso}</p>}
      </div>
      <div className="inspector-fijo-abajo" style={{ padding: '6px 12px' }}>
        {faltan.length > 0 && <p className="stage-note" data-testid="civil-faltan">Falta declarar {faltan.join(', ')}.</p>}
        <button type="button" className="stage-primary" data-testid="civil-confirmar" disabled={faltan.length > 0} onClick={confirmar}>
          {aviso ? 'Sumar igual a la escena' : reemplaza ? 'Reemplazar' : 'Sumar a la escena'}
        </button>
      </div>
    </div>
  );
}

// ─── Archivo seleccionado (inspector) ────────────────────────────────────────

export function FichaCivil({ archivo }: { archivo: ArchivoCivil }) {
  const actualizar = useParteCivilStore((s) => s.actualizar);
  const reemplazo = useRef<HTMLInputElement | null>(null);
  const caja = cajaEnApp(archivo.malla, archivo.ejeVertical);
  const cambiar = (patch: Parameters<typeof actualizar>[1]) => {
    actualizar(archivo.id, patch);
    useWorkspaceStore.getState().markDirty();
  };
  const d = archivo.desplazamientoMm;
  const numero = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  return (
    <div className="inspector-panel" data-testid="civil-ficha" data-archivo={archivo.id}>
      <div className="inspector-header inspector-fijo-arriba" style={{ display: 'flex', alignItems: 'center' }}>
        <span className="inspector-title" style={{ flex: 1 }}>{NOMBRE_TIPO_CIVIL[archivo.tipo]} · {archivo.nivel.nombre}</span>
        <button type="button" onClick={() => seleccionarCivil(null)}>Cerrar</button>
      </div>
      <div style={{ padding: '6px 12px', display: 'grid', gap: 4, fontSize: 12 }}>
        <div><strong data-testid="civil-ficha-nombre">{archivo.nombre}</strong>{archivo.version > 1 ? ` (versión ${archivo.version})` : ''}</div>
        <div>Nivel {archivo.nivel.nombre} · cota {mm(archivo.nivel.cotaMm)}</div>
        <div>Unidades del STEP: {archivo.malla.unidades.texto}</div>
        <div data-testid="civil-ficha-caja" data-alto={Math.round(caja.alto)}>Caja: {mm(caja.ancho)} × {mm(caja.fondo)} × {mm(caja.alto)} alto (altura = eje {archivo.ejeVertical} del archivo)</div>
        <div data-testid="civil-ficha-triangulos">{miles(archivo.malla.solidos)} sólido(s) · {miles(archivo.malla.triangulos)} triángulos</div>

        <fieldset style={{ border: '1px solid var(--ws-border)', padding: '4px 8px', borderRadius: 3 }}>
          <legend>Posición (por defecto, las coordenadas del archivo)</legend>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['X', 'Y', 'Z'] as const).map((eje, i) => (
              <label key={eje} style={{ flex: 1, display: 'grid' }}>{eje} (mm)
                <input className="inspector-input" type="number" data-testid={`civil-desp-${eje.toLowerCase()}`} defaultValue={d[i]} key={`${archivo.id}-${eje}-${d[i]}`}
                  onBlur={(e) => {
                    const v = numero(e.target.value);
                    if (v === null || v === d[i]) return;
                    const n = [...d] as [number, number, number];
                    n[i] = v;
                    cambiar({ desplazamientoMm: n });
                  }} />
              </label>
            ))}
          </div>
          <label style={{ display: 'grid' }}>Giro en planta (°)
            <input className="inspector-input" type="number" data-testid="civil-giro" defaultValue={archivo.giroDeg} key={`${archivo.id}-giro-${archivo.giroDeg}`}
              onBlur={(e) => { const v = numero(e.target.value); if (v !== null && v !== archivo.giroDeg) cambiar({ giroDeg: v }); }} />
          </label>
        </fieldset>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button type="button" data-testid="civil-reemplazar" onClick={() => reemplazo.current?.click()}>Reemplazar por versión nueva…</button>
          <button type="button" className="tone-danger" data-testid="civil-quitar"
            onClick={() => {
              if (!confirm(`¿Quitar ${archivo.nombre} de la parte civil?`)) return;
              useParteCivilStore.getState().quitar(archivo.id);
              useWorkspaceStore.getState().markDirty();
            }}>Quitar</button>
        </div>
        <input ref={reemplazo} type="file" accept=".stp,.step,.STP,.STEP" style={{ display: 'none' }} data-testid="civil-reemplazar-input"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void iniciarImportacion(f, archivo); }} />
      </div>
    </div>
  );
}

/** Inspector de la parte civil en Planta: importación en curso, archivo seleccionado, o nada. */
export function InspectorCivil(): JSX.Element | null {
  const pendiente = useParteCivilStore((s) => s.pendiente);
  const archivos = useParteCivilStore((s) => s.archivos);
  const seleccionado = useParteCivilStore((s) => s.seleccionado);
  if (pendiente) return <ImportarCivilForm />;
  const a = seleccionado ? archivos.find((x) => x.id === seleccionado) : null;
  return a ? <FichaCivil archivo={a} /> : null;
}
