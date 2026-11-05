export interface GuideInput {
  nPiezas: number;
  nConexiones: number;
  circuitos: { recorrido: string[]; cable_id: string }[];
  nSoportes: number;
  cableId: string;
  status: string;
  estadoTrazado?: string;
}

export interface GuideStep {
  id: string;
  label: string;
  done: boolean;
  hint: string;
}

/**
 * Computes the guide checklist steps from current workspace state.
 *
 * Step 6 (revisar) is NEVER auto-completed — it requires deliberate human review.
 * The hint shows the actual estado_trazado string from Python without interpreting
 * it as "good" or "bad", since the caller does not know the full value set.
 */
export function computeGuideSteps(input: GuideInput): GuideStep[] {
  const { nPiezas, nConexiones, circuitos, nSoportes, cableId, status, estadoTrazado } = input;

  const trazadoDone    = nPiezas > 0;
  const conexionesDone = nConexiones > 0;
  const cablesDone     = circuitos.some((c) => c.recorrido.length > 0 && Boolean(c.cable_id));
  const soportesDone   = nSoportes > 0 && cableId !== '';
  const calcularDone   = status === 'vigente';

  return [
    {
      id: 'trazado',
      label: '1. Trazado — definir piezas',
      done: trazadoDone,
      hint: trazadoDone ? `${nPiezas} piezas` : 'Importá un trazado o cargá el motor',
    },
    {
      id: 'conexiones',
      label: '2. Conexiones entre piezas',
      done: conexionesDone,
      hint: conexionesDone
        ? `${nConexiones} conexiones`
        : 'Usá "Conectar piezas" en la sección Conexiones',
    },
    {
      id: 'cables',
      label: '3. Cables por circuito',
      done: cablesDone,
      hint: cablesDone ? '' : 'Asigná cable y recorrido en cada circuito',
    },
    {
      id: 'soportes',
      label: '4. Soportes y cable PE',
      done: soportesDone,
      hint: soportesDone
        ? `${nSoportes} soportes · PE: ${cableId}`
        : 'Definí soportes y seleccioná cable PE',
    },
    {
      id: 'calcular',
      label: '5. Calcular trazado',
      done: calcularDone,
      hint: calcularDone ? 'Resultado vigente' : 'Presioná "Calcular trazado" en el inspector',
    },
    {
      id: 'revisar',
      label: '6. Revisar pendientes',
      // Never auto-complete: requires deliberate human review of the Python result
      done: false,
      hint: estadoTrazado
        ? `Estado del trazado: ${estadoTrazado.replace(/_/g, ' ')}`
        : calcularDone
          ? 'Revisá el resultado en el inspector'
          : 'Calculá primero para ver el estado del trazado',
    },
  ];
}
