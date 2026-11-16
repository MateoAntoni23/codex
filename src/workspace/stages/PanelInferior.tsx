/**
 * Panel inferior desplegable (interfaz, 2026-11-14): las tablas anchas, que no
 * entran en los costados. Pestañas: circuitos, cómputo de materiales, cálculo del
 * motor y avisos. Plegado muestra sólo la barra de pestañas; en Resultados se abre.
 *
 * Lo que agregó la app sigue distinguiéndose de lo que calculó el motor: cada
 * sección conserva su marca («[AGREGADA POR LA APP]», «cálculo de la app»).
 */
import { useTrayStore } from '../../tray/store';
import { circuitosOf } from '../recorridos/circuitosGuardados';
import { useUiStore, type PestanaInferior } from './uiStore';
import { ContrasteTabla, useContraste } from '../../conexiones/ContrasteTabla';
import { CircuitosTabla } from './CircuitosTabla';
import { CalculoMotorSection, CircuitosAlMotor } from './CalculoMotor';
import { BandejasConDeclaradosSection, BandejasSegregadasSection } from './BandaDivisoria';
import { ComputoMotor, TrayResults } from '../TrayResults';
import { AvisosModeloList, ComponentesUnionApp, CurvasEslabonadasList, ExceptionsList, MezclasList, NominalList } from './ResultadosPanel';

const PESTANAS: Array<[PestanaInferior, string]> = [
  ['circuitos', 'Circuitos'],
  ['contraste', 'Contraste con ingeniería'],
  ['computo', 'Cómputo de materiales'],
  ['motor', 'Cálculo del motor'],
  ['avisos', 'Avisos'],
];

function Contenido({ pestana }: { pestana: PestanaInferior }) {
  switch (pestana) {
    case 'circuitos':
      return <><CircuitosTabla /><CircuitosAlMotor /></>;
    case 'contraste':
      return <ContrasteTabla />;
    case 'computo':
      return <><ComputoMotor /><ComponentesUnionApp /><CurvasEslabonadasList /><BandejasSegregadasSection parte="computo" /></>;
    case 'motor':
      return (
        <>
          <CalculoMotorSection />
          <BandejasSegregadasSection parte="ocupacion" />
          <BandejasConDeclaradosSection />
          <details className="stage-card" data-testid="respuesta-cruda">
            <summary>Respuesta completa del motor (cruda)</summary>
            <TrayResults />
          </details>
        </>
      );
    case 'avisos':
      return <><ExceptionsList /><NominalList /><AvisosModeloList /><MezclasList /></>;
  }
}

export function PanelInferior() {
  const abierto = useUiStore((s) => s.panelInferior);
  const pestana = useUiStore((s) => s.pestanaInferior);
  const setAbierto = useUiStore((s) => s.setPanelInferior);
  const ver = useUiStore((s) => s.verPestana);
  const circuitos = useTrayStore((s) => circuitosOf(s.entrada).length);
  const hayResultado = useTrayStore((s) => s.result !== null);
  const avisosContraste = useContraste().filter((f) => f.estado === 'aviso').length;
  const cuenta: Partial<Record<PestanaInferior, string>> = {
    circuitos: String(circuitos),
    contraste: avisosContraste ? `${avisosContraste} ⚠` : '',
    motor: hayResultado ? '●' : '',
  };
  return (
    <section className={`panel-inferior ws-panel${abierto ? ' is-open' : ''}`} data-testid="panel-inferior" data-abierto={abierto ? 'true' : 'false'} data-pestana={pestana}>
      <div className="panel-inferior-barra" role="tablist" aria-label="Tablas">
        {PESTANAS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={abierto && pestana === id}
            className={`panel-inferior-pestana${abierto && pestana === id ? ' is-active' : ''}`}
            data-testid={`pestana-${id}`}
            onClick={() => (abierto && pestana === id ? setAbierto(false) : ver(id))}
          >
            {label}{cuenta[id] ? ` (${cuenta[id]})` : ''}
          </button>
        ))}
        <button
          type="button"
          className="panel-inferior-toggle"
          data-testid="panel-inferior-toggle"
          aria-expanded={abierto}
          title={abierto ? 'Plegar las tablas' : 'Desplegar las tablas'}
          onClick={() => setAbierto(!abierto)}
        >
          {abierto ? 'Plegar ▾' : 'Tablas ▴'}
        </button>
      </div>
      {abierto && (
        <div className="panel-inferior-cuerpo" role="tabpanel" data-testid={`panel-inferior-${pestana}`}>
          <Contenido pestana={pestana} />
        </div>
      )}
    </section>
  );
}
