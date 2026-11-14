/**
 * Cierre de brecha Rule 0 → Decision Engine (auditoría 2026-11-13, Riesgos 1/5
 * ya corregidos en rule-engine.service.ts y automation.service.ts).
 *
 * Cuando `RuleEngine.evaluate()` no puede resolver la recuperación de una
 * acción fallida, delega en el Decision Engine (Gemini). Hasta ahora, la
 * única protección sobre esa decisión era `isRepeatingFailedSelector` en
 * `evaluation.service.ts`: evita repetir el selector exacto que acaba de
 * fallar, pero no valida que la alternativa propuesta conserve la intención
 * semántica de la acción original, ni excluye acciones destructivas o
 * transaccionales.
 *
 * Este módulo reutiliza el mismo criterio de equivalencia por categoría de
 * interacción + token léxico verificable que `RuleEngine.findSemanticallyCompatibleAlternative`
 * ya aplica a sus propias alternativas determinísticas (ver rule-engine.service.ts),
 * generalizado para validar también la decisión que llega desde Gemini. Se
 * duplica deliberadamente (en vez de importar los métodos privados de
 * RuleEngine) para no tocar el archivo de los Riesgos 1/5 ya auditados y
 * probados; si se corrige un caso aquí, revisar también rule-engine.service.ts.
 *
 * Regla de diseño explícita: la lista de lenguaje destructivo/transaccional
 * es UNA señal de RECHAZO independiente, nunca la única base de ACEPTACIÓN.
 * Una alternativa solo se acepta cuando, además de no contener lenguaje
 * destructivo, comparte categoría de interacción y token léxico verificable
 * con la acción que falló -- nunca únicamente porque el selector exista o el
 * elemento sea visible.
 *
 * [Cierre de brecha NAVIGATE, auditoría posterior 2026-11-13] Una
 * recuperación `NAVIGATE` NO se valida con el criterio de categoría+token
 * anterior: lo único que determina a dónde navega `page.goto()` es
 * `inputData` (la URL), nunca `targetElement` -- confiar en el selector de
 * un elemento DOM como "prueba" de equivalencia para NAVIGATE sería validar
 * algo distinto de lo que realmente se ejecuta. Para NAVIGATE se exige en
 * cambio una de dos evidencias verificables, con igualdad EXACTA de URL
 * normalizada (nunca por dominio compartido ni por similitud léxica):
 *   a) la acción que falló fue ella misma un NAVIGATE y se conserva su URL
 *      original (ver `extractFailedNavigateUrl`); o
 *   b) la acción que falló fue un CLIC sobre un enlace cuyo `href` real
 *      (evidencia estructurada, `knownLinks`, NUNCA inferido del texto) es
 *      exactamente igual a la URL propuesta.
 * Sin ninguna de las dos, se rechaza -- nunca se acepta "porque es del mismo
 * dominio" o "porque el texto se parece a la intención original".
 *
 * Puro — sin Playwright, sin Mongo, sin Gemini. Testable de forma aislada.
 */

export interface FailedRecoveryAction {
  actionType: string;
  /** Descripción tal como se registra en previousActions (incluye el mensaje de error de Playwright, p. ej. "Failed to execute: Timeout ... locator('...')", y, para NAVIGATE, el marcador `[NAVIGATE_TARGET_URL: ...]` -- ver `resolveActionOutcome` en evaluation.service.ts). */
  description: string;
}

/**
 * Evidencia estructurada de enlaces reales de la página (NO el
 * `visibleDOMSummary`/`InteractiveElement` liviano que usa el Decision
 * Engine como candidatos de acción -- ese no incluye `href`). Proviene de
 * `PageSnapshot.links` (`LinkEvidence[]`), ya capturado por
 * `automationService.extractCurrentSnapshot` en cada iteración.
 */
export interface KnownLinkEvidence {
  selector: string;
  href: string;
}

export interface ProposedRecoveryCandidate {
  actionType: string;
  selector: string | null;
  /** Tipo de elemento resuelto desde visibleDOMSummary; null si el selector no corresponde a ningún elemento conocido del snapshot estructurado. */
  elementType: string | null;
  text: string | null;
  ariaLabel: string | null;
  /** Solo relevante cuando `actionType` es `NAVIGATE`: la URL que `page.goto()` ejecutaría realmente (`currentAction.inputData`). Null/ausente si no se propuso NAVIGATE. */
  navigateTargetUrl?: string | null;
}

export interface RecoveryEquivalenceResult {
  isEquivalent: boolean;
  reason: string;
}

const DESTRUCTIVE_OR_TRANSACTIONAL_TERMS = [
  'eliminar', 'borrar', 'delete', 'remove',
  'pagar', 'pago', 'pay', 'checkout', 'comprar', 'compra', 'purchase', 'buy',
  'confirmar compra', 'confirm purchase',
  'cancelar suscripción', 'cancelar suscripcion', 'cancel subscription', 'unsubscribe', 'desuscrib',
  'transferir', 'transfer funds', 'enviar dinero',
];

const GENERIC_HTML_TAGS = new Set([
  'section', 'div', 'span', 'p', 'a', 'button', 'nav', 'header', 'footer', 'main', 'article', 'ul', 'li', 'form',
]);

function containsDestructiveLanguage(text: string | null, ariaLabel: string | null): boolean {
  const haystack = `${text || ''} ${ariaLabel || ''}`.toLowerCase();
  return DESTRUCTIVE_OR_TRANSACTIONAL_TERMS.some((term) => haystack.includes(term));
}

function extractFailedSelector(description: string): string | null {
  const match = description.match(
    /(?:waiting for locator\(['"]|waiting for selector\s*['"]?|on\s+selector\s*['"]?|selector\s*['"]?|on\s+['"]?)([^'"\)\s\n]+)/i,
  );
  return match ? match[1].trim() : null;
}

function extractToken(failedSelector: string | null, description: string): string | null {
  const raw = `${failedSelector || ''} ${description}`.toLowerCase();
  const idMatch = raw.match(/#([a-z0-9_-]+)/i);
  if (idMatch && idMatch[1].length >= 3) {
    return idMatch[1]
      .toLowerCase()
      .replace(/^(?:btn|input|field|txt|chk|chkbox|opt|nav|header|footer|tab|menu|link|item)-?/, '')
      .replace(/-?(?:input|field|txt|chk|chkbox|opt|mobile|desktop|responsive|btn|link|icon|tab)$/, '');
  }
  const nameMatch = raw.match(/name=['"]?([a-z0-9_-]+)['"]?/i);
  if (nameMatch && nameMatch[1].length >= 3) return nameMatch[1].toLowerCase();
  return null;
}

/**
 * Extracción de destino de navegación — deliberadamente separada de
 * `extractToken`: un fallo de navegación rara vez trae un literal `#id` o
 * `name=` (su mensaje de Playwright suele ser `locator('section:nth-of-type(1)...')`
 * o selectores anidados sin id), así que usa el mismo patrón más amplio que
 * `RuleEngine.extractNavigationTarget` (navegar a/goto/sección/tab/enlace/
 * locator(/selector), con el mismo denylist de tags HTML genéricos del
 * Riesgo 1 ya corregido en rule-engine.service.ts).
 */
function extractNavigationToken(failedSelector: string | null, description: string): string | null {
  const raw = `${failedSelector || ''} ${description}`.toLowerCase();
  const match = raw.match(
    /(?:navegar\s+a\s+|goto\s+|secci[oó]n\s+|tab\s+|enlace\s+|locator\(['"]?[#.]?|selector\s*['"]?[#.]?)([a-z0-9_-]+)/i,
  );
  if (match && match[1].length >= 3) {
    const cleaned = match[1]
      .toLowerCase()
      .replace(/^(?:nav|btn|header|footer|tab|menu|link|item)-?/, '')
      .replace(/-?(?:mobile|desktop|responsive|btn|link|icon|tab)$/, '');
    if (cleaned.length >= 3 && !GENERIC_HTML_TAGS.has(cleaned)) return cleaned;
  }
  return null;
}

function tokenMatches(token: string, candidate: ProposedRecoveryCandidate): boolean {
  const selector = (candidate.selector || '').toLowerCase();
  const text = (candidate.text || '').toLowerCase();
  const label = (candidate.ariaLabel || '').toLowerCase();
  const stem = token.slice(0, Math.min(token.length, 5));
  return (
    selector.includes(token) ||
    (token.length >= 4 && selector.includes(stem)) ||
    text.includes(token) ||
    (token.length >= 4 && text.includes(stem)) ||
    label.includes(token) ||
    (token.length >= 4 && label.includes(stem))
  );
}

/**
 * Formato único y estable del marcador que conserva la URL originalmente
 * intentada por una acción NAVIGATE dentro de su `previousActions.description`
 * -- fuente única de verdad compartida entre quien lo escribe
 * (`resolveActionOutcome`, evaluation.service.ts) y quien lo lee
 * (`extractFailedNavigateUrl`, abajo). No depende de que el mensaje de error
 * de Playwright incluya la URL (no siempre ocurre), así que es determinista
 * sea cual sea el motivo del fallo.
 */
export function formatNavigateTargetMarker(url: string): string {
  return `[NAVIGATE_TARGET_URL: ${url}]`;
}

/**
 * [Corrección de integridad, auditoría posterior 2026-11-13] El marcador
 * confiable que `resolveActionOutcome` añade SIEMPRE va al final absoluto de
 * `description` (ver su docstring en evaluation.service.ts) -- nunca con
 * texto después. Antes, esta función usaba una regex no anclada con captura
 * perezosa (`(.*?)`), que devolvía la PRIMERA coincidencia de
 * `[NAVIGATE_TARGET_URL: ...]` en la cadena -- si el `rationale` libre de
 * Gemini (que se concatena ANTES del marcador real) contenía por cualquier
 * motivo un patrón similar, esa coincidencia falsa se aceptaba como si fuera
 * la URL original (reproducido empíricamente en la auditoría).
 *
 * La corrección usa dos propiedades combinadas, sin necesitar más estado ni
 * tocar el formato de escritura:
 *   1. `$` ancla el final de LA CADENA COMPLETA -- cualquier coincidencia
 *      que no termine exactamente en el último carácter de `description`
 *      (p. ej. un marcador falso seguido de más texto, incluido el marcador
 *      real) no puede satisfacer el patrón completo en esa posición.
 *   2. `[^\]]*` (en vez de `.*?`) nunca puede cruzar un corchete de cierre
 *      `]` ya existente -- así que un intento de coincidencia que arranca en
 *      un marcador falso anterior se ve forzado a detenerse en SU PROPIO `]`
 *      y, como después de ese `]` no viene el final de la cadena, el intento
 *      completo falla en esa posición (sin posibilidad de "saltarlo" con
 *      backtracking) y el motor de regex continúa buscando en la posición
 *      del siguiente marcador -- hasta llegar, si existe, al marcador
 *      legítimo que sí está anclado al final.
 * Verificado empíricamente (no solo razonado) contra los 7 escenarios
 * exigidos antes de aplicar este cambio -- ver `recovery-equivalence-validator.test.ts`.
 */
function extractFailedNavigateUrl(description: string): string | null {
  const match = description.match(/\[NAVIGATE_TARGET_URL:\s*([^\]]*)\]$/);
  return match ? match[1].trim() : null;
}

/**
 * [Cierre de falso rechazo CLICK→CLICK, auditoría de ejecución OpenCart
 * 2026-11-14] Marcador hermano de `NAVIGATE_TARGET_URL`, con la MISMA
 * técnica de anclaje seguro ($ + clase que excluye `]`), pero para un
 * `href` distinto: el de un enlace real (`<a href>`) sobre el que se
 * intentó un CLICK. Se escribe en `resolveActionOutcome` (evaluation.service.ts)
 * ÚNICAMENTE cuando el selector del CLICK pudo resolverse, en SU PROPIO
 * snapshot (el de la iteración en que se decidió esa acción), a exactamente
 * un enlace conocido -- nunca se infiere ni se adivina. Palabra de marcador
 * deliberadamente distinta de `NAVIGATE_TARGET_URL` para que ambos mecanismos
 * sean independientes y no se confundan entre sí.
 */
export function formatClickTargetHrefMarker(href: string): string {
  return `[CLICK_TARGET_HREF: ${href}]`;
}

function extractFailedClickHref(description: string): string | null {
  const match = description.match(/\[CLICK_TARGET_HREF:\s*([^\]]*)\]$/);
  return match ? match[1].trim() : null;
}

/**
 * Resuelve el `href` real de un selector dentro de UN snapshot concreto
 * (`knownLinks` ya corresponde siempre al snapshot de la acción en
 * cuestión -- nunca se mezcla aquí evidencia de otra iteración). Rechaza
 * conservadoramente (retorna `null`) tanto la ausencia de coincidencia
 * (Caso C) como la ambigüedad de más de una coincidencia para el mismo
 * selector (Caso D) -- nunca elige "la primera" entre varias.
 */
export function resolveUniqueLinkHref(selector: string | null | undefined, knownLinks: KnownLinkEvidence[]): string | null {
  if (!selector) return null;
  const matches = knownLinks.filter((link) => link.selector === selector);
  if (matches.length !== 1) return null;
  return matches[0].href || null;
}

/**
 * Normalización segura: usa el parser `URL` nativo (misma fuente de verdad
 * que `assertSafeUrl`) para comparar por forma canónica, nunca por
 * comparación de cadenas crudas (evita falsos negativos/positivos por
 * mayúsculas de host, slash final, etc.). Una URL que no parsea se trata
 * como no verificable, nunca como "coincide por accidente".
 */
function normalizeUrl(url: string): string | null {
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/**
 * Validación específica de una recuperación NAVIGATE: exige igualdad EXACTA
 * de URL normalizada contra una de dos evidencias verificables (ver
 * docstring del módulo). Nunca acepta por dominio compartido ni por
 * similitud léxica -- eso sería exactamente el tipo de "equivalencia no
 * demostrada" que esta guarda existe para impedir.
 */
function validateNavigateEquivalence(
  failed: FailedRecoveryAction,
  candidate: ProposedRecoveryCandidate,
  knownLinks: KnownLinkEvidence[],
  failedSelector: string | null,
): RecoveryEquivalenceResult {
  const proposedUrl = candidate.navigateTargetUrl ? normalizeUrl(candidate.navigateTargetUrl) : null;
  if (!proposedUrl) {
    return {
      isEquivalent: false,
      reason: 'La recuperación NAVIGATE no trae una URL válida (inputData ausente o malformado) que verificar.',
    };
  }

  const rawFailedType = (failed.actionType || '').toUpperCase();

  if (rawFailedType === 'NAVIGATE') {
    const originalUrl = extractFailedNavigateUrl(failed.description);
    const normalizedOriginal = originalUrl ? normalizeUrl(originalUrl) : null;
    if (normalizedOriginal && normalizedOriginal === proposedUrl) {
      return {
        isEquivalent: true,
        reason: 'La URL propuesta coincide exactamente con el destino original de la navegación fallida.',
      };
    }
    return {
      isEquivalent: false,
      reason: 'No se conserva, o no coincide exactamente, la URL original de la navegación fallida; no se puede demostrar equivalencia.',
    };
  }

  if (failedSelector) {
    const matchingLink = knownLinks.find((link) => link.selector === failedSelector);
    if (matchingLink) {
      const normalizedHref = normalizeUrl(matchingLink.href);
      if (normalizedHref && normalizedHref === proposedUrl) {
        return {
          isEquivalent: true,
          reason: `La URL propuesta coincide exactamente con el href real del enlace que falló ('${matchingLink.selector}').`,
        };
      }
    }
  }

  return {
    isEquivalent: false,
    reason: 'No existe evidencia verificable (href real del enlace fallido, o URL original conservada) de que el destino propuesto corresponda a la acción original -- ni el dominio compartido ni la similitud léxica son suficientes.',
  };
}

export function validateRecoveryEquivalence(
  failed: FailedRecoveryAction,
  candidate: ProposedRecoveryCandidate,
  knownLinks: KnownLinkEvidence[] = [],
): RecoveryEquivalenceResult {
  // NAVIGATE: lo único que determina a dónde navega `page.goto()` es
  // `candidate.navigateTargetUrl` (inputData) -- nunca un elemento DOM. Se
  // valida ANTES del chequeo general de "selector conocido" (check 0), que
  // no aplica a este actionType (una NAVIGATE legítima puede no traer
  // targetElement en absoluto).
  if ((candidate.actionType || '').toUpperCase() === 'NAVIGATE') {
    const failedSelectorForNav = extractFailedSelector(failed.description);
    return validateNavigateEquivalence(failed, candidate, knownLinks, failedSelectorForNav);
  }

  // 0. Sin información estructurada verificable sobre el candidato (el
  // selector propuesto no corresponde a ningún elemento conocido del
  // snapshot): no hay evidencia sobre la cual fundamentar una equivalencia.
  if (!candidate.selector || candidate.elementType === null) {
    return {
      isEquivalent: false,
      reason: 'El selector propuesto no corresponde a ningún elemento del snapshot estructurado; no hay evidencia verificable para justificar la equivalencia.',
    };
  }

  // 1. Lenguaje destructivo/transaccional: señal de RECHAZO independiente.
  // Se evalúa antes que cualquier otra cosa, pero su ausencia nunca implica
  // aceptación por sí sola (ver los chequeos de categoría+token más abajo).
  if (containsDestructiveLanguage(candidate.text, candidate.ariaLabel)) {
    return {
      isEquivalent: false,
      reason: `El candidato contiene lenguaje destructivo o transaccional ("${candidate.text || candidate.ariaLabel}"), excluido durante cualquier recuperación.`,
    };
  }

  const rawFailedType = (failed.actionType || '').toUpperCase();
  const failedDesc = (failed.description || '').toLowerCase();
  const failedSelector = extractFailedSelector(failed.description);
  const failedSelectorLower = (failedSelector || '').toLowerCase();
  const proposedType = (candidate.actionType || '').toUpperCase();

  // 2. Recuperación de un campo de texto: la alternativa SOLO puede ser otro
  // campo de texto que comparta token léxico con el campo que falló.
  const isTextInputRecovery =
    rawFailedType === 'TYPE' ||
    rawFailedType === 'FILL' ||
    rawFailedType === 'CLEAR' ||
    failedSelectorLower.includes('input') ||
    failedSelectorLower.includes('textarea') ||
    failedDesc.includes('input') ||
    failedDesc.includes('textarea') ||
    failedDesc.includes('typed');

  if (isTextInputRecovery) {
    const proposedIsTextInput = proposedType === 'TYPE' || proposedType === 'CLEAR';
    const proposedTypeOk = candidate.elementType === 'input' || candidate.elementType === 'textarea';
    const token = extractToken(failedSelector, failedDesc);
    if (proposedIsTextInput && proposedTypeOk && token && tokenMatches(token, candidate)) {
      return { isEquivalent: true, reason: `Mismo campo de texto (token "${token}" compartido).` };
    }
    return {
      isEquivalent: false,
      reason: 'La acción fallida fue sobre un campo de texto; la alternativa propuesta no es un campo equivalente verificable.',
    };
  }

  // 3. Recuperación de un checkbox/radio: la alternativa SOLO puede ser otro
  // control de selección que comparta token léxico.
  const isCheckRecovery =
    rawFailedType === 'CHECK' ||
    rawFailedType === 'UNCHECK' ||
    failedSelectorLower.includes('checkbox') ||
    failedSelectorLower.includes('radio') ||
    failedDesc.includes('checkbox') ||
    failedDesc.includes('radio');

  if (isCheckRecovery) {
    const proposedIsCheck = proposedType === 'CHECK' || proposedType === 'UNCHECK';
    const proposedTypeOk = candidate.elementType === 'checkbox' || candidate.elementType === 'radio';
    const token = extractToken(failedSelector, failedDesc);
    if (proposedIsCheck && proposedTypeOk && token && tokenMatches(token, candidate)) {
      return { isEquivalent: true, reason: `Mismo control de selección (token "${token}" compartido).` };
    }
    return {
      isEquivalent: false,
      reason: 'La acción fallida fue sobre un checkbox/radio; la alternativa propuesta no es un control equivalente verificable.',
    };
  }

  // 4. Recuperación de un filtro/orden: la alternativa debe ser también un
  // control de filtro/orden que comparta token léxico.
  const isFilterRecovery =
    failedDesc.includes('filter') ||
    failedDesc.includes('filtro') ||
    failedSelectorLower.includes('filter') ||
    failedSelectorLower.includes('filtro') ||
    failedSelectorLower.includes('sort') ||
    failedSelectorLower.includes('ordenar') ||
    failedDesc.includes('sort') ||
    failedDesc.includes('ordenar');

  if (isFilterRecovery) {
    const selector = (candidate.selector || '').toLowerCase();
    const text = (candidate.text || '').toLowerCase();
    const isFilterControl = selector.includes('filter') || selector.includes('filtro') || text.includes('filter') || text.includes('filtro');
    const token = extractToken(failedSelector, failedDesc);
    if (isFilterControl && token && tokenMatches(token, candidate)) {
      return { isEquivalent: true, reason: `Mismo control de filtro (token "${token}" compartido).` };
    }
    return {
      isEquivalent: false,
      reason: 'La acción fallida fue sobre un filtro; la alternativa propuesta no es un control de filtro equivalente verificable.',
    };
  }

  // 5. Recuperación de navegación (CLICK/NAVIGATE): la alternativa debe ser
  // un link/botón que comparta el mismo destino conceptual -- nunca un tag
  // HTML genérico capturado por error (ver Riesgo 1, GENERIC_HTML_TAGS).
  const isNavigationRecovery = rawFailedType === 'NAVIGATE' || rawFailedType === 'CLICK';
  if (isNavigationRecovery) {
    const proposedIsNavLike = candidate.elementType === 'link' || candidate.elementType === 'button';

    // 5a. [Cierre de falso rechazo CLICK→CLICK, auditoría OpenCart 2026-11-14]
    // Verificación por `href` real -- COMPLEMENTA el token léxico de abajo,
    // nunca lo sustituye. Solo aplica cuando el candidato es un CLICK sobre
    // un `link` (NAVIGATE ya se maneja aparte, arriba) y la acción fallida
    // conservó evidencia de que ELLA MISMA era un CLICK sobre un enlace real
    // (marcador `CLICK_TARGET_HREF`, escrito en su propio snapshot). Reglas:
    //   Caso A: ambos hrefs normalizados coinciden exactamente -> ACEPTAR.
    //   Caso B: ambos son resolubles pero DIFIEREN -> RECHAZAR de forma
    //     autoritativa (no cae al chequeo de token: un href verificablemente
    //     distinto es evidencia más fuerte que cualquier parecido textual).
    //   Caso C/D: el candidato no resuelve a exactamente un enlace conocido
    //     en SU PROPIO snapshot actual (`knownLinks`) -- ausente o ambiguo,
    //     `resolveUniqueLinkHref` ya trata ambos casos igual -- RECHAZAR de
    //     forma conservadora, sin caer al token (ya sabíamos, por el
    //     marcador, que la acción original SÍ era un enlace verificable;
    //     bajar el estándar de evidencia aquí sería inconsistente).
    // Si NO hay marcador (la acción fallida no era un CLICK sobre un enlace
    // real, o no se pudo resolver en su momento), se sigue al chequeo de
    // token existente sin ningún cambio de comportamiento.
    if (candidate.actionType.toUpperCase() === 'CLICK' && candidate.elementType === 'link') {
      const failedHref = extractFailedClickHref(failed.description);
      if (failedHref) {
        const normalizedFailedHref = normalizeUrl(failedHref);
        const candidateHref = resolveUniqueLinkHref(candidate.selector, knownLinks);
        if (normalizedFailedHref && candidateHref) {
          const normalizedCandidateHref = normalizeUrl(candidateHref);
          if (normalizedCandidateHref && normalizedCandidateHref === normalizedFailedHref) {
            return {
              isEquivalent: true,
              reason: `La alternativa conduce al mismo destino real (href "${normalizedFailedHref}") que el enlace original, verificado en sus respectivos snapshots.`,
            };
          }
          return {
            isEquivalent: false,
            reason: `El enlace original y la alternativa propuesta tienen hrefs verificados distintos ("${normalizedFailedHref}" vs. "${normalizedCandidateHref ?? candidateHref}"); no es el mismo destino aunque el texto o la categoría coincidan.`,
          };
        }
        if (!candidateHref) {
          return {
            isEquivalent: false,
            reason: 'El enlace original fallido era verificable, pero la alternativa propuesta no resuelve de forma inequívoca a un enlace conocido en el snapshot actual; se rechaza de forma conservadora.',
          };
        }
      }
    }

    const navTarget = extractNavigationToken(failedSelector, failedDesc);
    if (proposedIsNavLike && navTarget && tokenMatches(navTarget, candidate)) {
      return { isEquivalent: true, reason: `Mismo destino de navegación (token "${navTarget}" compartido).` };
    }
    return {
      isEquivalent: false,
      reason: 'La acción fallida fue de navegación; no se pudo demostrar que la alternativa propuesta conduce al mismo destino.',
    };
  }

  // 6. Categoría no clasificable (p. ej. SELECT/HOVER/FOCUS fallidos): sin un
  // criterio estructurado aplicable, no se puede demostrar equivalencia. Se
  // prioriza seguridad/trazabilidad sobre continuar la exploración.
  return {
    isEquivalent: false,
    reason: `No existe un criterio estructurado para validar la equivalencia de una recuperación tras un fallo de tipo '${failed.actionType}'.`,
  };
}
