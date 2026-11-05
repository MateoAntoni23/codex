function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 24, height: 10, marginRight: 6,
      background: dashed ? 'none' : color,
      border: dashed ? `2px dashed ${color}` : 'none',
      borderRadius: 2, verticalAlign: 'middle', flexShrink: 0,
    }} />
  );
}

function LegendRow({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '3px 0', fontSize: 11, lineHeight: 1.3 }}>
      <Swatch color={color} dashed={dashed} />
      <span style={{ color: '#c0c0d8' }}>{label}</span>
    </div>
  );
}

export function WorkspaceLegend() {
  return (
    <details style={{ margin: '0 0 4px' }}>
      <summary style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, background: '#1f2235', userSelect: 'none' }}>
        Leyenda
      </summary>
      <div style={{ padding: '6px 12px 8px', borderBottom: '1px solid #2a2e44' }}>
        <LegendRow color="#50b8de" label="Bandeja recta (con dimensiones de catálogo)" />
        <LegendRow color="#8899bb" label="Pieza esquemática (sin dimensiones)" />
        <LegendRow color="#bb77bb" label="Soporte — ubicación calculada (no es geometría real)" />
        <LegendRow color="#b9e539" dashed label="PE equipotencial (contacto con ala ≠ conexión eléctrica)" />
        <LegendRow color="#ffcf33" label="Seleccionado" />
        <LegendRow color="#ff4444" label="P1 — extremo de referencia de la pieza" />
        <p style={{ marginTop: 6, fontSize: 10, color: '#666688', lineHeight: 1.4 }}>
          Los soportes son cajas púrpuras que marcan la ubicación calculada por Python.<br />
          No representan la geometría real del soporte.
        </p>
      </div>
    </details>
  );
}
