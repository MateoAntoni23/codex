/** Importaciones `?raw` de Vite (texto crudo) y constantes inyectadas en build. */
declare module '*?raw' {
  const content: string;
  export default content;
}

/**
 * SHA-256 (hex) de vendor/motor_bandejas/datos/decisiones_producto.json, calculado
 * por vite.config.ts sobre los bytes del archivo — la misma huella que publica el
 * motor en `decisiones_sha256`. Sirve para detectar un motor con datos distintos
 * a los empaquetados en el frontend.
 */
declare const __DECISIONES_SHA256__: string;
