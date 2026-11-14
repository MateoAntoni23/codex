/**
 * Leyenda de colores por tipo (interfaz B2/B5, 2026-11-14), en la escena.
 *
 * Muestra sólo los tipos que hay en el proyecto (lo mínimo a la vista). Cada
 * muestra es el selector de color: la persona cambia el color de un tipo desde
 * acá, y se guarda como el tema (por navegador, fuera del archivo). Se puede
 * ocultar; queda un botón chico para volver a mostrarla. Si la paleta elegida
 * no se distingue (contra sí misma o contra el fondo, también con visión
 * reducida del color), se avisa con el par y el número.
 */
import { useMemo } from 'react';
import { useTrayStore } from '../../tray/store';
import {
  COLORES_POR_DEFECTO, FONDO_ESCENA, NOMBRE_TIPO, TIPOS_COLOR, tipoColorDe, useColoresStore, type TipoColor,
} from './coloresTipo';
import { evaluarPaleta, MIN_CONTRASTE_FONDO, MIN_DELTA_E } from './distincion';

const VISION: Record<string, string> = { normal: '', protan: ' con protanopía', deutan: ' con deuteranopía' };

export function LeyendaColores() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const colores = useColoresStore((s) => s.colores);
  const visible = useColoresStore((s) => s.leyendaVisible);
  const setVisible = useColoresStore((s) => s.setLeyendaVisible);
  const setColor = useColoresStore((s) => s.setColor);
  const restablecer = useColoresStore((s) => s.restablecer);

  const presentes = useMemo(() => {
    const prod = new Map((context?.productos ?? []).map((p) => [p.producto_id, p]));
    const set = new Set<TipoColor>();
    for (const p of entrada?.piezas ?? []) set.add(tipoColorDe(prod.get(p.producto_id), context?.familias));
    if (entrada?.soportes.length) set.add('herraje');
    return TIPOS_COLOR.filter((t) => set.has(t));
  }, [entrada, context]);

  const aviso = useMemo(() => {
    const inf = evaluarPaleta(Object.fromEntries(TIPOS_COLOR.map((t) => [t, colores[t]])), FONDO_ESCENA);
    if (inf.ok) return null;
    const { peorPar: p, peorFondo: f } = inf;
    if (p.deltaE < MIN_DELTA_E) {
      return `${NOMBRE_TIPO[p.a as TipoColor]} y ${NOMBRE_TIPO[p.b as TipoColor]} se distinguen poco${VISION[p.vision]} (ΔE ${p.deltaE.toFixed(0)}; mínimo ${MIN_DELTA_E}).`;
    }
    return `${NOMBRE_TIPO[f.clave as TipoColor]} se ve poco contra el fondo${VISION[f.vision]} (contraste ${f.contraste.toFixed(1)}:1; mínimo ${MIN_CONTRASTE_FONDO}:1).`;
  }, [colores]);

  const cambiados = TIPOS_COLOR.some((t) => colores[t] !== COLORES_POR_DEFECTO[t]);

  if (!presentes.length) return null;
  if (!visible) {
    return (
      <button type="button" className="leyenda-colores-mostrar" data-testid="leyenda-mostrar" onClick={() => setVisible(true)} title="Mostrar la leyenda de colores">
        Colores
      </button>
    );
  }
  return (
    <div className="leyenda-colores" data-testid="leyenda-colores" role="group" aria-label="Colores por tipo de bandeja">
      <div className="leyenda-colores-cabecera">
        <span>Colores por tipo</span>
        <button type="button" data-testid="leyenda-ocultar" onClick={() => setVisible(false)} title="Ocultar la leyenda" aria-label="Ocultar la leyenda">×</button>
      </div>
      {presentes.map((t) => (
        <label key={t} className="leyenda-colores-fila" data-testid={`leyenda-tipo-${t}`} data-color={colores[t]}>
          <input
            type="color"
            value={colores[t]}
            data-testid={`leyenda-color-${t}`}
            aria-label={`Color de ${NOMBRE_TIPO[t]}`}
            title="Cambiar el color (se guarda en este navegador, no en el proyecto)"
            onChange={(e) => setColor(t, e.target.value)}
          />
          <span>{NOMBRE_TIPO[t]}</span>
        </label>
      ))}
      {aviso && <p className="leyenda-colores-aviso" role="status" data-testid="leyenda-aviso">⚠ {aviso}</p>}
      {cambiados && (
        <button type="button" className="leyenda-colores-restablecer" data-testid="leyenda-restablecer" onClick={restablecer}>
          Restablecer colores
        </button>
      )}
    </div>
  );
}
