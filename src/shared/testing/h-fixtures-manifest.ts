/**
 * Fase H — manifiesto de las 6 fixtures aprobadas (H1-H6), sin agregar
 * escenarios nuevos. Cada entrada referencia una fixture YA existente
 * (construida y validada localmente en Fase B/D/E) por su path relativo a
 * `/fixtures`, junto con la pregunta específica que responde -- ver el
 * plan de Fase H aprobado.
 *
 * Este archivo es solo un manifiesto (datos), no ejecuta nada.
 */
export interface HFixtureManifestEntry {
  id: string;
  path: string;
  question: string;
}

export const H_FIXTURES: HFixtureManifestEntry[] = [
  {
    id: 'H1',
    path: 'forms/login-good.html',
    question: 'WCAG 3.3.2 (labels correctos) — cero regla determinística existe para formularios: ¿Gemini reconoce correctamente un form bien etiquetado?',
  },
  {
    id: 'H2',
    path: 'forms/login-missing-label.html',
    question: 'WCAG 3.3.2 (labels ausentes) — contraparte de H1: ¿Gemini detecta el defecto real cuando existe?',
  },
  {
    id: 'H3',
    path: 'navigation/duplicate-link-text-diff-dest.html',
    question: 'AMBIGUOUS-LINK-DESTINATION — comparación cruzada entre 2 elementos, imposible determinísticamente por diseño: ¿Gemini lo detecta?',
  },
  {
    id: 'H4',
    path: 'components/accordion.html',
    question: 'aria-expanded (gap de CAPTURA, no solo de análisis) — ¿Gemini se abstiene honestamente o fabrica un dato que nunca capturamos?',
  },
  {
    id: 'H5',
    path: 'automation-signal/click-timeout-does-not-leak.html',
    question: 'GT-05 (automationSignal ≠ evidencia) — ¿Gemini real respeta la frontera que la taxonomía de Fase D exige?',
  },
  {
    id: 'H6',
    path: 'components/dropdown-hover-reveal.html',
    question: 'HOVER-ONLY-ACCESS — juicio UX genuino (operabilidad por teclado) que ninguna regla local puede emitir.',
  },
];
