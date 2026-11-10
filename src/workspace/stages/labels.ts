import type { Category } from '../../types/domain-v2';

export const CATEGORY_LABEL: Record<Category, string> = {
  electrical_panel: 'Tableros eléctricos',
  pneumatic_panel: 'Tableros neumáticos',
  motor: 'Motores',
  pump: 'Bombas',
  sensor: 'Sensores',
  process_valve: 'Válvulas de proceso',
  solenoid_valve: 'Electroválvulas',
  actuator: 'Actuadores',
  luminaire: 'Luminarias',
  pushbutton: 'Botoneras',
  terminal_block: 'Borneras',
  manifold: 'Manifolds',
  infrastructure: 'Infraestructura',
};
