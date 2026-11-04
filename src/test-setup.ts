import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Desmonta componentes React después de cada prueba para evitar fugas de estado.
afterEach(cleanup);
