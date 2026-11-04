import { describe, it, expect } from 'vitest';
import { validateProjectData } from '../validate';
import { SCHEMA_VERSION } from '../schema';

const VALID_DATA = {
  schemaVersion: SCHEMA_VERSION,
  projectOrigin: { x: 0, y: 0, z: 0 },
  objects: [
    {
      id: 'panel-1',
      name: 'Tablero',
      type: 'panel',
      position: { x: 0, y: 0, z: 1000 },
      dimensions: { width: 800, depth: 400, height: 2000 },
    },
    {
      id: 'floor-1',
      name: 'Piso',
      type: 'floor',
      position: { x: 0, y: 0, z: 0 },
      dimensions: { width: 30000, depth: 30000, height: 0 },
    },
  ],
};

describe('validateProjectData — datos válidos', () => {
  it('acepta un ProjectData bien formado', () => {
    const result = validateProjectData(VALID_DATA);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.objects).toHaveLength(2);
    expect(result.projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('permite height=0 en tipo floor', () => {
    const data = { ...VALID_DATA, objects: [VALID_DATA.objects[1]] };
    expect(() => validateProjectData(data)).not.toThrow();
  });

  it('acepta projectOrigin con coordenadas negativas', () => {
    const data = { ...VALID_DATA, projectOrigin: { x: -1000, y: -500, z: -200 } };
    expect(() => validateProjectData(data)).not.toThrow();
  });

  it('acepta posiciones con coordenadas negativas', () => {
    const data = {
      ...VALID_DATA,
      objects: [
        { ...VALID_DATA.objects[0], position: { x: -7000, y: 2000, z: 1000 } },
      ],
    };
    expect(() => validateProjectData(data)).not.toThrow();
  });
});

describe('validateProjectData — versión de esquema', () => {
  it('rechaza schemaVersion incompatible', () => {
    expect(() => validateProjectData({ ...VALID_DATA, schemaVersion: 2 })).toThrow(
      /Versión de esquema incompatible/,
    );
  });

  it('rechaza schemaVersion faltante', () => {
    const { schemaVersion: _, ...noVersion } = VALID_DATA;
    expect(() => validateProjectData(noVersion)).toThrow(/Versión de esquema incompatible/);
  });
});

describe('validateProjectData — estructura raíz', () => {
  it('rechaza null', () => {
    expect(() => validateProjectData(null)).toThrow(/objeto JSON válido/);
  });

  it('rechaza string', () => {
    expect(() => validateProjectData('texto')).toThrow(/objeto JSON válido/);
  });

  it('rechaza array', () => {
    expect(() => validateProjectData([])).toThrow(/Versión de esquema incompatible/);
  });

  it('rechaza objects que no es array', () => {
    expect(() => validateProjectData({ ...VALID_DATA, objects: 'malo' })).toThrow(
      /objects debe ser un array/,
    );
  });
});

describe('validateProjectData — IDs duplicados', () => {
  it('rechaza IDs duplicados', () => {
    const data = {
      ...VALID_DATA,
      objects: [VALID_DATA.objects[0], { ...VALID_DATA.objects[0], name: 'Copia' }],
    };
    expect(() => validateProjectData(data)).toThrow(/ID duplicado/);
  });
});

describe('validateProjectData — tipo de objeto', () => {
  it('rechaza tipo desconocido', () => {
    const bad = { ...VALID_DATA.objects[0], type: 'conveyor' };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /type desconocido/,
    );
  });

  it('rechaza type null', () => {
    const bad = { ...VALID_DATA.objects[0], type: null };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow();
  });

  it('rechaza height=0 en tipo no-floor', () => {
    const bad = {
      ...VALID_DATA.objects[0],
      type: 'panel',
      dimensions: { ...VALID_DATA.objects[0].dimensions, height: 0 },
    };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /height debe ser positivo/,
    );
  });
});

describe('validateProjectData — números no finitos', () => {
  it('rechaza Infinity en posición', () => {
    const bad = {
      ...VALID_DATA.objects[0],
      position: { x: Infinity, y: 0, z: 0 },
    };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /número finito/,
    );
  });

  it('rechaza NaN en dimensión', () => {
    const bad = {
      ...VALID_DATA.objects[0],
      dimensions: { ...VALID_DATA.objects[0].dimensions, width: NaN },
    };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /número finito/,
    );
  });

  it('rechaza string en projectOrigin', () => {
    expect(() =>
      validateProjectData({ ...VALID_DATA, projectOrigin: { x: 'abc', y: 0, z: 0 } }),
    ).toThrow(/número finito/);
  });
});

describe('validateProjectData — dimensiones inválidas', () => {
  it('rechaza width negativo', () => {
    const bad = {
      ...VALID_DATA.objects[0],
      dimensions: { ...VALID_DATA.objects[0].dimensions, width: -1 },
    };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /width debe ser positivo/,
    );
  });

  it('rechaza height negativo', () => {
    const bad = {
      ...VALID_DATA.objects[0],
      dimensions: { ...VALID_DATA.objects[0].dimensions, height: -100 },
    };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /height no puede ser negativo/,
    );
  });
});

describe('validateProjectData — campos de objeto faltantes', () => {
  it('rechaza id vacío', () => {
    const bad = { ...VALID_DATA.objects[0], id: '' };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(/id debe ser/);
  });

  it('rechaza name vacío', () => {
    const bad = { ...VALID_DATA.objects[0], name: '' };
    expect(() => validateProjectData({ ...VALID_DATA, objects: [bad] })).toThrow(
      /name debe ser/,
    );
  });

  it('rechaza objeto no-objeto en el array', () => {
    expect(() =>
      validateProjectData({ ...VALID_DATA, objects: ['no-es-objeto'] }),
    ).toThrow(/debe ser un objeto/);
  });
});
