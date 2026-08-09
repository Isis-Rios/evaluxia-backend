/**
 * DOM Cleaner Utility — Purga el HTML de elementos no semánticos y pesados.
 *
 * Utilizado para reducir el tamaño del DOM antes de almacenarlo o procesarlo.
 * Elimina scripts, estilos, comentarios HTML, SVGs pesados y atributos no semánticos.
 */
export function cleanHtmlDom(html: string): string {
  if (!html) return '';

  return html
    // 1. Eliminar scripts y estilos y sus contenidos
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // 2. Eliminar comentarios HTML
    .replace(/<!--[\s\S]*?-->/gi, '')
    // 3. Eliminar SVGs embebidos pesados (los reemplaza por un tag vacío para conservar la posición)
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '<svg></svg>')
    // 4. Eliminar linebreaks y espacios redundantes
    .replace(/\s+/g, ' ')
    .trim();
}
