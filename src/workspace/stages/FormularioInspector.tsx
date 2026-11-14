/**
 * Formulario abierto en el inspector (interfaz, 2026-11-14). Los formularios no
 * viven en el panel izquierdo (que muestra lo que existe): se abren acá, desde la
 * barra de herramientas, desde el inspector sin selección o desde una pieza
 * seleccionada (con esa pieza ya elegida). Se cierran con «Cerrar» o Escape.
 */
import { useUiStore, type Formulario } from './uiStore';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { AddTraySegmentForm } from '../AddTraySegmentForm';
import { AddSupportForm } from '../AddSupportForm';
import { DerivacionForm } from './DerivacionSection';
import { BajadaForm, CircuitoEquiposSection } from './CircuitoEquipos';
import { RecorridoSection } from './RecorridoSection';
import { PreviewAddForm } from '../../preview/PreviewAddForm';

const TITULO: Record<Formulario['tipo'], string> = {
  tramo: 'Tramo nuevo',
  soporte: 'Soporte nuevo',
  derivacion: 'Derivación en un tramo',
  enlace: 'Enlazar un equipo con la bandeja',
  circuito: 'Circuito entre dos equipos',
  medir: 'Medir entre dos bocas',
  'equipo-nuevo': 'Equipo nuevo',
};

export function FormularioInspector({ f }: { f: Formulario }) {
  const cerrar = () => useUiStore.getState().abrirFormulario(null);
  let cuerpo: React.ReactNode;
  switch (f.tipo) {
    case 'tramo': cuerpo = <AddTraySegmentForm onClose={cerrar} />; break;
    case 'soporte': cuerpo = <AddSupportForm onClose={cerrar} />; break;
    case 'derivacion': cuerpo = <DerivacionForm key={f.tronco ?? ''} tronco={f.tronco} onClose={cerrar} />; break;
    case 'enlace': cuerpo = <BajadaForm key={`${f.tronco ?? ''}|${f.equipo ?? ''}`} tronco={f.tronco} equipo={f.equipo} />; break;
    case 'circuito': cuerpo = <CircuitoEquiposSection />; break;
    case 'medir': cuerpo = <RecorridoSection key={f.origen ? `${f.origen.pieza}|${f.origen.boca}` : ''} origen={f.origen} />; break;
    case 'equipo-nuevo':
      cuerpo = (
        <div data-testid="new-equipment-form">
          <PreviewAddForm
            onCreated={(el) => { useWorkspaceStore.getState().addElement(el); cerrar(); }}
            onCancel={cerrar}
          />
        </div>
      );
      break;
  }
  return (
    <div className="inspector-panel" data-testid={`formulario-${f.tipo}`}>
      <div className="inspector-header" style={{ display: 'flex', alignItems: 'center' }}>
        <span className="inspector-title" style={{ flex: 1 }}>{TITULO[f.tipo]}</span>
        <button type="button" data-testid="formulario-cerrar" onClick={cerrar} title="Cerrar (Esc)">Cerrar</button>
      </div>
      <div style={{ padding: '4px 12px 8px' }}>{cuerpo}</div>
    </div>
  );
}
