/**
 * PrototypeCriteriaResolver — mecanismo ESTÁTICO (no depende de la imagen)
 * que determina qué criterios WCAG/Nielsen son aplicables a una evaluación
 * de prototipo visual. Implementa la matriz definitiva aprobada en
 * K.2.1.1 §6 (revisada: WCAG 2.4.4 degradado a PARTIALLY_EVALUABLE, 1.4.1
 * confirmado DIRECTLY_EVALUABLE con justificación más estricta).
 *
 * `OUT_OF_COVERAGE` es metadata de diseño, nunca un `FindingStatus`
 * persistido (K.2.1 §5) — los criterios OUT_OF_COVERAGE jamás se envían a
 * Gemini (sección 15/17 del prompt de implementación).
 */

export type PrototypeCriterionCoverage = 'DIRECTLY_EVALUABLE' | 'PARTIALLY_EVALUABLE' | 'OUT_OF_COVERAGE';

export interface PrototypeCriterionDefinition {
  code: string;
  name: string;
  framework: 'WCAG' | 'NIELSEN';
  coverage: PrototypeCriterionCoverage;
  /** Qué SÍ puede observarse desde una imagen estática, y qué NO puede demostrarse — nunca se omite por brevedad. */
  note: string;
}

export const PROTOTYPE_WCAG_CRITERIA: PrototypeCriterionDefinition[] = [
  {
    code: 'WCAG 1.4.1',
    name: 'Uso del color',
    framework: 'WCAG',
    coverage: 'DIRECTLY_EVALUABLE',
    note:
      'Tanto el uso del color como la presencia/ausencia de un indicador alternativo (icono/texto) son observables dentro del frame capturado. No puede confirmar ausencia de alternativas en estados no visibles (hover/focus) ni fuera del recorte de la imagen (K.2.1.1 §5) — se evalúa solo lo mostrado en ESTA imagen.',
  },
  {
    code: 'WCAG 1.3.1',
    name: 'Información y relaciones',
    framework: 'WCAG',
    coverage: 'PARTIALLY_EVALUABLE',
    note:
      'Puede observarse la jerarquía VISUAL (tamaño/peso/espaciado). No puede confirmar el etiquetado semántico real (h1-h6, landmarks) del DOM.',
  },
  {
    code: 'WCAG 1.4.3',
    name: 'Contraste mínimo',
    framework: 'WCAG',
    coverage: 'PARTIALLY_EVALUABLE',
    note:
      'VISUAL_OBSERVATION_ONLY (política aprobada, no reabierta): Gemini puede observar que "el texto parece tener bajo contraste", pero tiene PROHIBIDO afirmar o calcular una ratio WCAG numérica.',
  },
  {
    code: 'WCAG 2.4.4',
    name: 'Propósito de los enlaces',
    framework: 'WCAG',
    coverage: 'PARTIALLY_EVALUABLE',
    note:
      'Puede juzgarse si el TEXTO del enlace es descriptivo en aislamiento. NO puede confirmar si múltiples enlaces con texto idéntico llevan realmente a destinos distintos (las URLs reales no son visibles en una imagen estática) — degradado respecto a una clasificación DIRECTLY_EVALUABLE (K.2.1.1 §5).',
  },
  {
    code: 'WCAG 2.4.6',
    name: 'Encabezados y etiquetas',
    framework: 'WCAG',
    coverage: 'DIRECTLY_EVALUABLE',
    note: 'La calidad descriptiva de encabezados/etiquetas es puramente textual/visual, sin dependencia de ninguna propiedad invisible.',
  },
  {
    code: 'WCAG 1.1.1',
    name: 'Contenido no textual',
    framework: 'WCAG',
    coverage: 'PARTIALLY_EVALUABLE',
    note:
      'Puede observarse "hay un ícono sin indicio textual visible de su propósito". No puede confirmar el estado real del atributo `alt`/`aria-label` programático.',
  },
  {
    code: 'WCAG 3.3.2',
    name: 'Etiquetas o instrucciones',
    framework: 'WCAG',
    coverage: 'PARTIALLY_EVALUABLE',
    note: 'Puede observarse si hay un label visualmente cercano a un campo. No puede confirmar la asociación programática (`<label for>`).',
  },
  {
    code: 'WCAG 4.1.2',
    name: 'Nombre, función y valor',
    framework: 'WCAG',
    coverage: 'OUT_OF_COVERAGE',
    note: 'Role/value accesibles son 100% programáticos, invisibles en una imagen estática.',
  },
  {
    code: 'WCAG 2.1.1',
    name: 'Teclado',
    framework: 'WCAG',
    coverage: 'OUT_OF_COVERAGE',
    note: '100% comportamental (orden de foco, operabilidad) — no observable en una imagen estática, consistente con su exclusión del prompt WEB (K.1 Parte E).',
  },
];

export const PROTOTYPE_NIELSEN_CRITERIA: PrototypeCriterionDefinition[] = [
  { code: 'N-02', name: 'Coincidencia entre el sistema y el mundo real', framework: 'NIELSEN', coverage: 'DIRECTLY_EVALUABLE', note: 'Evaluable desde una única imagen estática (metáforas/iconografía/lenguaje visibles).' },
  { code: 'N-03', name: 'Control y libertad del usuario', framework: 'NIELSEN', coverage: 'DIRECTLY_EVALUABLE', note: 'Evaluable desde la presencia/ausencia visible de salidas (botones cancelar/cerrar/atrás).' },
  { code: 'N-04', name: 'Consistencia y estándares', framework: 'NIELSEN', coverage: 'DIRECTLY_EVALUABLE', note: 'Evaluable por comparación visual entre elementos de la misma imagen (ej. mismo texto, distinto estilo).' },
  {
    code: 'N-05',
    name: 'Prevención de errores',
    framework: 'NIELSEN',
    coverage: 'DIRECTLY_EVALUABLE',
    note:
      'Evaluable ÚNICAMENTE cuando un indicio de confirmación/advertencia SÍ está presente y visible en la imagen (se puede juzgar su claridad/ubicación). La AUSENCIA de ese indicio en una única captura estática del formulario sin interactuar NUNCA permite concluir que el sistema carece de validación o prevención de errores -- esa capacidad, si existe, solo se manifestaría tras un intento de envío inválido, algo que esta imagen no muestra (P1.6.4, hallazgo real confirmado en auditoría post-piloto).',
  },
  { code: 'N-06', name: 'Reconocimiento antes que recuerdo', framework: 'NIELSEN', coverage: 'DIRECTLY_EVALUABLE', note: 'Evaluable desde la visibilidad de opciones/instrucciones en la propia imagen.' },
  { code: 'N-08', name: 'Diseño estético y minimalista', framework: 'NIELSEN', coverage: 'DIRECTLY_EVALUABLE', note: 'Evaluable directamente por densidad/ruido visual de la imagen.' },
  {
    code: 'N-01',
    name: 'Visibilidad del estado del sistema',
    framework: 'NIELSEN',
    coverage: 'OUT_OF_COVERAGE',
    note: 'Requiere comparar un ANTES/DESPUÉS de una interacción — una única imagen estática no lo captura (limitación de MVP de una sola imagen, no permanente).',
  },
  {
    code: 'N-07',
    name: 'Flexibilidad y eficiencia de uso',
    framework: 'NIELSEN',
    coverage: 'OUT_OF_COVERAGE',
    note: 'Requiere observar atajos/rutas alternativas en uso — no deducible de una imagen estática.',
  },
  {
    code: 'N-09',
    name: 'Ayudar a reconocer, diagnosticar y recuperarse de errores',
    framework: 'NIELSEN',
    coverage: 'OUT_OF_COVERAGE',
    note: 'Requiere un estado de error real en pantalla; si la imagen no lo muestra, no es evaluable con esta única imagen (MVP de una imagen).',
  },
  {
    code: 'N-10',
    name: 'Ayuda y documentación',
    framework: 'NIELSEN',
    coverage: 'OUT_OF_COVERAGE',
    note: 'Requiere explorar contenido de ayuda — no deducible de una única imagen estática.',
  },
];

export function getAllPrototypeCriteria(): PrototypeCriterionDefinition[] {
  return [...PROTOTYPE_WCAG_CRITERIA, ...PROTOTYPE_NIELSEN_CRITERIA];
}

/** Criterios que SÍ pueden enviarse a Gemini (nunca incluye OUT_OF_COVERAGE). */
export function resolveApplicablePrototypeCriteria(): PrototypeCriterionDefinition[] {
  return getAllPrototypeCriteria().filter((c) => c.coverage !== 'OUT_OF_COVERAGE');
}

export function getOutOfCoveragePrototypeCriteria(): PrototypeCriterionDefinition[] {
  return getAllPrototypeCriteria().filter((c) => c.coverage === 'OUT_OF_COVERAGE');
}
