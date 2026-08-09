import { InteractiveElement } from '@/modules/automation/automation.service';

/**
 * Configuración de límites para el cálculo dinámico de iteraciones.
 */
export const DYNAMIC_ITERATIONS_CONFIG = {
  MIN_LIMIT: 3,
  BASE: 2,
  MAX_LIMIT: 8,
};

/**
 * Calcula dinámicamente el número máximo de iteraciones permitidas para la Fase 1
 * basándose únicamente en el snapshot de elementos interactivos inicial de la página.
 *
 * Fórmula:
 * clamp(3, 2 + ceil(editablesCount × 1.0 + primaryButtonsCount × 1.0 + min(secondaryLinks × 0.1, 2)), 8)
 *
 * @param elements Arreglo de elementos interactivos extraídos del snapshot inicial (visibleDOMSummary).
 * @returns Número máximo de iteraciones (entero entre MIN_LIMIT y MAX_LIMIT).
 */
export function calculateDynamicMaxIterations(elements: InteractiveElement[]): number {
  const dom = elements || [];

  // 1. Conteo de elementos editables de entrada (inputs, selects, textareas, checkboxes, radios)
  const editablesCount = dom.filter((el) =>
    ['input', 'select', 'textarea', 'checkbox', 'radio'].includes(el.type.toLowerCase()),
  ).length;

  // 2. Conteo de botones primarios / principales de envío
  const primaryButtonsCount = dom.filter(
    (el) =>
      !el.isDisabled &&
      (el.type.toLowerCase() === 'button' || el.role?.toLowerCase() === 'button') &&
      (el.isPrimary || el.role?.toLowerCase() === 'submit'),
  ).length;

  // 3. Conteo de enlaces secundarios o elementos menores
  const secondaryLinks = dom.filter(
    (el) =>
      !el.isDisabled &&
      !['input', 'select', 'textarea', 'checkbox', 'radio'].includes(el.type.toLowerCase()) &&
      !(
        (el.type.toLowerCase() === 'button' || el.role?.toLowerCase() === 'button') &&
        (el.isPrimary || el.role?.toLowerCase() === 'submit')
      ),
  ).length;

  // Aporte acotado de enlaces secundarios (máximo +2 iteraciones)
  const cappedSecondaryContribution = Math.min(secondaryLinks * 0.1, 2);

  // Cálculo bruto de iteraciones
  const calculated =
    DYNAMIC_ITERATIONS_CONFIG.BASE +
    Math.ceil(editablesCount * 1.0 + primaryButtonsCount * 1.0 + cappedSecondaryContribution);

  // Aplicación estricta de los límites de seguridad clamp(3, calculated, 8)
  return Math.min(
    Math.max(calculated, DYNAMIC_ITERATIONS_CONFIG.MIN_LIMIT),
    DYNAMIC_ITERATIONS_CONFIG.MAX_LIMIT,
  );
}
