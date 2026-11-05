import { usePreviewStore } from './usePreviewStore';
import { PREVIEW_ELEMENTS } from './previewData';
import { elementToRenderProps } from '../scene/v2-adapter';
import type { Category } from '../types/domain-v2';

const CATEGORY_LABEL: Record<Category, string> = {
  electrical_panel: 'Tablero Eléctrico',
  pneumatic_panel:  'Tablero Neumático',
  motor:            'Motor',
  pump:             'Bomba',
  sensor:           'Sensor',
  process_valve:    'Válvula de Proceso',
  solenoid_valve:   'Electroválvula',
  actuator:         'Actuador',
  luminaire:        'Luminaria',
  pushbutton:       'Botonera',
  terminal_block:   'Bornera',
  manifold:         'Manifold',
  infrastructure:   'Infraestructura',
};

const GEOMETRY_LABEL: Record<string, string> = {
  box:      'Caja (box)',
  cylinder: 'Cilindro',
  plane:    'Plano',
  asset:    'Asset 3D',
  unknown:  'Dimensiones pendientes',
};

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-field">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{value}</span>
    </div>
  );
}

function fmt(n: number) {
  return n.toFixed(3);
}

export function PreviewInspector() {
  const selectedId = usePreviewStore((s) => s.selectedId);

  const element = selectedId != null
    ? (PREVIEW_ELEMENTS.find((e) => e.id === selectedId) ?? null)
    : null;

  const renderProps = element != null
    ? elementToRenderProps(element, PREVIEW_ELEMENTS)
    : null;

  return (
    <div className="panel panel-right">
      <div className="panel-title">Inspector (solo lectura)</div>

      {element == null ? (
        <p className="inspector-empty">Seleccioná un elemento</p>
      ) : (
        <div className="inspector-content">
          <ReadField label="Nombre"    value={element.name} />
          <ReadField label="ID"        value={element.id} />
          <ReadField label="Categoría" value={CATEGORY_LABEL[element.category as Category] ?? element.category} />
          <ReadField label="Geometría" value={GEOMETRY_LABEL[renderProps?.geometryKind ?? 'unknown']} />

          {renderProps?.placed && renderProps.sizeViewer != null && (
            <>
              <div className="inspector-section">Tamaño en visor (m)</div>
              <ReadField label="Ancho"  value={fmt(renderProps.sizeViewer[0])} />
              <ReadField label="Alto"   value={fmt(renderProps.sizeViewer[1])} />
              <ReadField label="Prof."  value={fmt(renderProps.sizeViewer[2])} />
            </>
          )}

          {renderProps?.placed && renderProps.positionViewer != null && (
            <>
              <div className="inspector-section">Posición en visor (m)</div>
              <ReadField label="X" value={fmt(renderProps.positionViewer[0])} />
              <ReadField label="Y" value={fmt(renderProps.positionViewer[1])} />
              <ReadField label="Z" value={fmt(renderProps.positionViewer[2])} />
            </>
          )}

          {renderProps?.placed && renderProps.rotationViewer != null && (
            <>
              <div className="inspector-section">Cuaternión visor</div>
              <ReadField label="X" value={fmt(renderProps.rotationViewer[0])} />
              <ReadField label="Y" value={fmt(renderProps.rotationViewer[1])} />
              <ReadField label="Z" value={fmt(renderProps.rotationViewer[2])} />
              <ReadField label="W" value={fmt(renderProps.rotationViewer[3])} />
            </>
          )}

          {!renderProps?.placed && (
            <>
              <div className="inspector-section">Estado</div>
              <p className="inspector-empty" style={{ padding: '8px 12px' }}>
                Elemento sin ubicar — no tiene posición en escena.
              </p>
            </>
          )}

          {renderProps?.geometryKind === 'unknown' && (
            <div className="preview-inspector-pending">
              Dimensiones pendientes: este elemento no tiene geometría definida.
              Se muestra como marcador en la escena.
            </div>
          )}

          {element.parentId != null && (
            <>
              <div className="inspector-section">Jerarquía</div>
              <ReadField
                label="Padre"
                value={
                  PREVIEW_ELEMENTS.find((e) => e.id === element.parentId)?.name
                  ?? element.parentId
                }
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
