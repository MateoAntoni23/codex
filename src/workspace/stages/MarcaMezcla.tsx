/**
 * Marca de MEZCLA DE ACABADOS (mezclaAcabados.ts). Es un aviso, no una invalidez.
 *
 * La señal es el TEXTO, no un color: el encargo de interfaz asigna un color por
 * tipo de bandeja, y una perforada zincada y una color van a tener el mismo. La
 * marca nombra los dos acabados y lleva la procedencia de la decisión.
 */
import { PROCEDENCIA_MEZCLA, type Mezcla } from '../mezclaAcabados';

export function MarcaMezcla({ mezcla, testid, bloque = false }: { mezcla: Mezcla; testid: string; bloque?: boolean }) {
  const contenido = (
    <>
      <strong>⚠ MEZCLA DE ACABADOS</strong>: {mezcla.skuA} {mezcla.acabadoA.nombre} ↔ {mezcla.skuB} {mezcla.acabadoB.nombre}
      {' '}<em>({PROCEDENCIA_MEZCLA})</em>
    </>
  );
  const attrs = { 'data-testid': testid, 'data-mezcla': `${mezcla.acabadoA.codigo}|${mezcla.acabadoB.codigo}`, title: mezcla.texto };
  return bloque
    ? <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} {...attrs}>{contenido}</div>
    : <span {...attrs}> · {contenido}</span>;
}
