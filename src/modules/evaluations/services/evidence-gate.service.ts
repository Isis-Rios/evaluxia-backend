import { V2AuditFinding, TechnicalEvidenceItem } from '@/modules/ai/contracts/ai.contracts';
import {
  EvidenceIndex,
  checkFindingTraceability,
  isAccessibilityTreeValueTraceable,
  normalizeSelectorForComparison,
} from './evidence-traceability.service';
import { checkClaimConsistency } from './evidence-claim-consistency.service';
import { classifyDomFact, recommendedStatusForEvidence, ClassifiedEvidenceItem } from '@/shared/testing/automation-signal-taxonomy';
import { computeContrastFailure } from './deterministic-analyzer.service';

/**
 * P1.7.3.1 — vocabulario real que puede aparecer en `previousActions`
 * (`automation.service.ts:executeAction`, `evaluation.service.ts:
 * resolveActionOutcome`: `Failed to execute: ${error}`, "Timeout Nms
 * exceeded" de Playwright, "Unsupported action type", "requires a
 * selector", "no active browser session") y que Gemini podría citar o
 * parafrasear en `finding.description` al construir un FAIL. El Evidence
 * Gate NO recibe `previousActions` (ver `processAiFindings`, sin ese
 * parámetro) -- esta lista, aplicada sobre `description`, es la única señal
 * disponible en este punto del flujo para detectar que un FAIL depende de
 * un fallo de automatización. Limitación heurística, documentada (mismo
 * principio que `STRONG_SPECULATIVE_KEYWORDS` arriba): no sustituye un NLP
 * real, solo cubre el vocabulario que el propio código produce.
 */
export const AUTOMATION_FAILURE_LANGUAGE_PATTERNS = [
  'timeout',
  'tiempo de espera agotado',
  'se agotó el tiempo',
  'failed to execute',
  'no se pudo ejecutar',
  'no pudo ejecutarse',
  'unsupported action type',
  'tipo de acción no soportado',
  'requires a selector',
  'elemento no encontrado',
  'element not found',
  'selector no encontrado',
  'selector not found',
  'no active browser session',
  'no se pudo completar la acción',
  'la acción no pudo completarse',
  'no se pudo interactuar',
  'no respondió a la interacción',
  'unknown error',
];

const CONTEXTUAL_SELECTORS = new Set(['document', 'body']);

/**
 * Mismo predicado de "auto-fundamentación" ya usado por la Gate Rule 0b
 * (factorizado aquí para reutilizarlo sin cambiar su comportamiento). Incluye
 * la excepción contextual `document`/`body` -- correcta para el propósito de
 * 0b (no penalizar evidencia comparativa/contextual legítima), pero
 * DELIBERADAMENTE NO se reutiliza para decidir pertinencia en la Automation
 * Signal Protection (ver `isStrictlySelfGrounded` y la auditoría
 * P1.7.3.1-AUDIT: un `document`/`body` incidental no corrobora una
 * afirmación sobre un elemento específico).
 */
function isEvidenceSelfGrounded(itemSelector: string | undefined, affectedSelector: string | undefined): boolean {
  return !itemSelector || itemSelector === affectedSelector || CONTEXTUAL_SELECTORS.has(itemSelector);
}

/**
 * P1.7.3.1-CORRECTION — auto-fundamentación ESTRICTA para la Automation
 * Signal Protection: a diferencia de `isEvidenceSelfGrounded` (0b), aquí
 * `document`/`body` NUNCA cuentan como pertinentes para un elemento
 * específico -- confirmado por auditoría (script adversarial) que un título
 * de página o un `font-family` del `body`, citados junto a lenguaje de
 * timeout, bastaban para preservar indebidamente un FAIL sobre un botón.
 * Solo el propio selector (o su ausencia, que ya significa "el propio
 * elemento" por convención del contrato) cuenta aquí.
 */
function isStrictlySelfGrounded(itemSelector: string | undefined, affectedSelector: string | undefined): boolean {
  return !itemSelector || itemSelector === affectedSelector;
}

/**
 * P1.7.3.1-CORRECTION — determina si un ítem de evidencia es "pertinente"
 * como corroboración DOM independiente de una señal de automatización.
 * Corrige dos huecos confirmados por auditoría (P1.7.3.1-AUDIT):
 *
 *   A. `document`/`body` incidentales ya NO cuentan (ver
 *      `isStrictlySelfGrounded`).
 *   B. Ya NO basta con que el `selector` coincida: cuando `evidenceIndex`
 *      está disponible, se exige que `checkClaimConsistency` (J6, ya en
 *      producción vía `applyClaimConsistency`, reutilizada aquí tal cual,
 *      sin reimplementarla) marque ESE ítem concreto como `CONSISTENT` --
 *      es decir, que el par `property`/`value` citado corresponda
 *      realmente al dato capturado para ese selector, no solo que el
 *      selector exista.
 *
 * LÍMITE DOCUMENTADO Y CONSERVADOR: cuando `evidenceIndex` NO se provee
 * (compatibilidad con llamadores preexistentes que invocan
 * `processAiFindings` con 1 argumento), no es posible verificar el valor
 * real -- se aplica el comportamiento conservador exigido: solo la
 * auto-fundamentación estricta por selector, documentado como una garantía
 * MÁS DÉBIL que cuando el índice sí está disponible (que es el caso real en
 * producción, `audit-engine.service.ts` siempre lo provee).
 *
 * ACCESSIBILITY_TREE no pasa por `checkClaimConsistency` (opera sobre
 * `property`/`value` de los 8 EvidenceKind estructurados, nunca sobre texto
 * libre) -- conserva su propia verificación dedicada contra el árbol real
 * (misma prueba que la Gate Rule 0c), con el mismo criterio conservador: sin
 * árbol provisto, nunca cuenta como pertinente aquí.
 */
function isPertinentDomEvidence(
  item: { type: string; selector?: string; value?: string },
  itemIndex: number,
  affectedSelector: string | undefined,
  claimConsistencyItems: { status: string }[] | undefined,
  accessibilityTreeText: string | undefined,
): boolean {
  if (!isStrictlySelfGrounded(item.selector, affectedSelector)) return false;

  if (item.type === 'ACCESSIBILITY_TREE') {
    if (!accessibilityTreeText) return false;
    return typeof item.value === 'string' && isAccessibilityTreeValueTraceable(item.value, accessibilityTreeText);
  }

  if (!claimConsistencyItems) {
    // Límite documentado: sin `evidenceIndex` no hay forma de verificar el
    // valor real -- comportamiento conservador MÁS DÉBIL (solo selector),
    // nunca se afirma una pertinencia que no puede demostrarse del todo.
    return true;
  }

  return claimConsistencyItems[itemIndex]?.status === 'CONSISTENT';
}

/**
 * P1.7.3.2 — reconoce `wcagCriterion` para WCAG 1.4.3 en los DOS formatos
 * reales y schema-válidos confirmados contra el código: con prefijo "WCAG"
 * (ej. `deterministic-analyzer.service.ts:247`, "WCAG 1.4.3 Contraste
 * (Mínimo)") y sin él (`finding-contracts.test.ts:56`, "1.4.3 Contraste
 * (Mínimo)" -- validado como input legítimo de `V2AuditFindingSchema`, el
 * mismo tipo que recibe `processAiFindings`). Excluye deliberadamente
 * coincidencias parciales y códigos de cuatro partes (ej. "1.4.3.1") vía el
 * lookahead negativo y el requisito de que el código termine en espacio o
 * fin de cadena. No se reutiliza `AuditMetricsService.normalizeCriterionKey`
 * (comparte esta misma limitación de prefijo obligatorio, y su propósito
 * declarado -- deduplicación entre orígenes -- es un contrato distinto al
 * de esta política).
 */
const WCAG_143_PATTERN = /^(?:WCAG\s+)?1\.4\.3(?!\.\d)(?:\s|$)/i;

function isWcag143(wcagCriterion: string | null | undefined): boolean {
  return !!wcagCriterion && WCAG_143_PATTERN.test(wcagCriterion.trim());
}

/**
 * P1.7.3.2 — grounding ESTRICTO, exclusivo de esta política, para un ítem
 * de evidencia `contrastRatio`. Deliberadamente NO reutiliza
 * `isStrictlySelfGrounded` (P1.7.3.1): aquella trata un `itemSelector`
 * ausente como implícitamente el propio elemento -- esta política exige un
 * selector EXPLÍCITO en ambos lados, cada uno normalizado a una cadena NO
 * vacía, nunca contextual (`document`/`body`), e iguales entre sí tras
 * normalizar. Confirmado necesario por el caso adversarial de diseño: un
 * finding puede superar la Gate Rule 0b existente (que exige "al menos un
 * ítem self-grounded de CUALQUIER tipo") con un ítem `text` self-grounded,
 * mientras su único ítem `contrastRatio` pertenece a OTRO elemento real --
 * 0b nunca examina el ítem `contrastRatio` en sí.
 */
function isGroundedContrastEvidence(item: TechnicalEvidenceItem, affectedSelectorRaw: string | undefined): boolean {
  if (!affectedSelectorRaw || !item.selector) return false;

  const normalizedAffected = normalizeSelectorForComparison(affectedSelectorRaw);
  const normalizedItem = normalizeSelectorForComparison(item.selector);
  if (!normalizedAffected || !normalizedItem) return false;

  if (CONTEXTUAL_SELECTORS.has(normalizedAffected) || CONTEXTUAL_SELECTORS.has(normalizedItem)) return false;

  return normalizedAffected === normalizedItem;
}

/**
 * P1.7.3.2 — precondición de `fontSize` explícitamente interpretable,
 * exigida ANTES de invocar `computeContrastFailure` con fines de
 * CONFIRMACIÓN de un FAIL. El formato real de captura (`getComputedStyle().
 * fontSize`) es siempre "<número>px"; el parseo permisivo que
 * `computeContrastFailure` aplica internamente (`parseFloat(...) || 16`) es
 * apropiado para SU PROPIO veredicto autocontenido (analizador
 * determinístico), nunca como base para confirmar una afirmación ajena
 * (Gemini) -- esta política nunca delega esa decisión al default interno.
 */
const FONT_SIZE_PATTERN = /^-?\d+(\.\d+)?px$/;

function isUsableFontSize(fontSize: string | undefined): boolean {
  if (!fontSize || !FONT_SIZE_PATTERN.test(fontSize.trim())) return false;
  const parsed = parseFloat(fontSize);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * P1.7.3.2 — mismos tokens que `computeContrastFailure` reconoce
 * explícitamente (`'normal'`, `'bold'`, o un entero vía `parseInt`),
 * exigidos de forma explícita antes de confirmar -- mismo principio que
 * `isUsableFontSize`.
 */
function isUsableFontWeight(fontWeight: string | undefined): boolean {
  if (!fontWeight) return false;
  const v = fontWeight.trim();
  if (v === 'normal' || v === 'bold') return true;
  if (!/^\d+$/.test(v)) return false;
  const parsed = parseInt(v, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000;
}

/**
 * Hardening (post Gemini Real #1, hallazgo D) — taxonomía de lenguaje
 * especulativo en `description`. El Gate Rule 1 original degradaba CUALQUIER
 * FAIL cuyo `description` contuviera una de estas palabras, sin importar si
 * el finding tenía evidencia real y confidence alta -- confirmado con un
 * caso real: un finding de Gemini con evidencia CONSISTENT (J6) y
 * confidence=high fue degradado solo por contener "potentially" en
 * "...placeholder text which disappears on input, potentially causing
 * users to forget...", donde la palabra introduce una CONSECUENCIA de un
 * hecho ya afirmado y evidenciado, no una duda sobre si el problema existe.
 *
 * Sin un detector lingüístico de cláusulas (deliberadamente fuera de
 * alcance -- excesivo para esta fase, y el propio pedido de hardening pide
 * explícitamente NO introducir uno), no podemos distinguir con certeza,
 * palabra por palabra, "especulación sobre la EXISTENCIA del problema"
 * (debe degradar siempre) de "consecuencia potencial de un hecho ya
 * evidenciado" (no debe degradar solo por eso). El cambio mínimo
 * justificable: separar las palabras cuya función gramatical más común es
 * hedgear la EXISTENCIA/CONDICIÓN del problema mismo (degradan siempre,
 * sin importar evidencia -- Caso A/D) de "potentially" (el único término
 * con un caso real confirmado de falso positivo), que solo degrada cuando
 * NO está corroborado por evidencia real + confidence alta (Gate Rule 1,
 * abajo) -- igual que ya exige el resto de señales de esa regla. Esto NO
 * es eliminar la palabra para que un test pase: sigue degradando findings
 * genuinamente débiles (sin evidencia o con confidence ya baja); deja de
 * degradar únicamente cuando hay evidencia real que la corrobora (Caso B).
 *
 * Límite documentado, no resuelto: esta distinción es heurística por
 * palabra, no por cláusula -- "potentially" SÍ podría, en otro contexto,
 * hedgear el hecho principal ("the button is potentially broken"); no es
 * distinguible con certeza sin NLP real. El Caso C de la taxonomía pedida
 * (recomendación condicional, ej. "If the control is intended to submit
 * the form...") tampoco se cubre aquí: Gate Rule 1 solo inspecciona
 * `description`, nunca `recommendation`/`impact`/`evidence` -- una
 * recomendación condicional no implica por sí sola que el FINDING sea
 * especulativo, así que se deja fuera de este detector deliberadamente
 * (comportamiento preexistente, ahora documentado en vez de asumido).
 */
export const STRONG_SPECULATIVE_KEYWORDS = [
  'might',
  'could',
  'may',
  'possibly',
  'if implemented',
  'if it is',
  'podría',
  'quizás',
  'tal vez',
  'si se implementa',
];

/** Ver docstring arriba: solo degrada cuando no está corroborada por evidencia real + confidence alta. */
export const WEAK_SPECULATIVE_KEYWORDS = ['potentially'];

export class EvidenceGateService {
  private static instance: EvidenceGateService;

  private constructor() {}

  public static getInstance(): EvidenceGateService {
    if (!EvidenceGateService.instance) {
      EvidenceGateService.instance = new EvidenceGateService();
    }
    return EvidenceGateService.instance;
  }

  /**
   * Filters and validates findings from AI output to enforce the "NO EVIDENCE = NO FAIL" rule.
   *
   * J1 (Hardening Post-Fase H) — `evidenceIndex` es OPCIONAL, por
   * compatibilidad hacia atrás con los llamadores existentes que invocan
   * `processAiFindings([finding])` sin él (ver evidence-audit-engine.test.ts,
   * 5 llamadas preexistentes que nunca pasan un índice). Cuando SÍ se
   * provee (como lo hace AuditEngine en producción desde esta fase), se
   * aplica la Gate Rule 0 de trazabilidad ANTES de la Rule 1 existente: un
   * finding cuyo `affectedElement.selector` no es trazable a la evidencia
   * realmente enviada se degrada a NOT_EVALUABLE exactamente igual que un
   * finding especulativo o sin evidencia — nunca se descarta, nunca se
   * "corrige" el selector, solo se degrada su status.
   *
   * LÍMITE DELIBERADO (ver evidence-traceability.service.ts): esto SOLO
   * garantiza que el elemento referenciado existía en la evidencia enviada.
   * NO evalúa si el finding en sí es correcto (Caso J) ni si la evidencia
   * es semánticamente suficiente (Caso H) -- eso sigue siendo esta misma
   * Rule 1, sin cambios.
   */
  /**
   * [Revisión MVP] `accessibilityTreeText` es OPCIONAL y aditivo, mismo
   * patrón de compatibilidad que `evidenceIndex` (J1): los llamadores
   * existentes que no lo pasan (ver evidence-audit-engine.test.ts) preservan
   * el comportamiento exacto de antes -- la Gate Rule 0c de abajo solo se
   * activa cuando `AuditEngine` lo provee.
   */
  public processAiFindings(
    rawFindings: V2AuditFinding[],
    evidenceIndex?: EvidenceIndex,
    accessibilityTreeText?: string,
  ): V2AuditFinding[] {
    const validatedFindings: V2AuditFinding[] = [];

    // Telemetría J1 — contadores pequeños, nunca el contenido del finding.
    let withSelector = 0;
    let notTraceable = 0;

    for (const finding of rawFindings) {
      let status = finding.status || 'FAIL';
      let confidence = finding.confidence || 'high';

      // 0. Gate Rule 0 (J1): trazabilidad selector -> evidencia realmente
      // enviada. Solo se evalúa cuando se proveyó un índice Y el finding
      // referencia un selector -- nunca fuerza NOT_EVALUABLE por su cuenta
      // en PASS (un PASS no trazable tampoco es verificable, así que
      // también se degrada -- "verificable" es simétrico entre PASS/FAIL).
      if (evidenceIndex && finding.affectedElement?.selector) {
        withSelector++;
        const traceability = checkFindingTraceability(finding, evidenceIndex);
        if (!traceability.traceable) {
          notTraceable++;
          status = 'NOT_EVALUABLE';
          confidence = 'low';
        }
      }

      // 0b. Gate Rule 0b (Hardening Fase K, Parte B) — coherencia
      // evidencia-elemento. Confirmado con un caso construido y ejecutado
      // contra el código real: un finding puede declarar
      // `affectedElement.selector = A` y citar `evidence[0].selector = B`
      // (un elemento DISTINTO, real, con datos reales y correctos de B) --
      // J1 (Gate Rule 0, arriba) solo valida `affectedElement.selector`;
      // J6 valida cada ítem contra SU PROPIO selector citado, nunca cruza
      // contra `affectedElement.selector` -- ninguno de los dos detecta que
      // la evidencia pertenece a OTRO elemento. Esto permite "FABRICAR" una
      // conclusión sobre A respaldada 100% por datos reales de B.
      //
      // Contrato descubierto (no asumido): no existe HOY ningún productor
      // determinístico que cite legítimamente `evidence[].selector` distinto
      // de `affectedElement.selector` salvo el contexto genérico
      // 'document'/'body' (ya reconocido así en `mergeEvidence`). SÍ existe
      // un caso real, legítimo y ya observado (Gemini Real #1, finding N-04
      // sobre los enlaces "Leer más" ambiguos) donde un finding cita
      // evidencia de VARIOS elementos para una comparación -- pero en ese
      // caso real, al menos UN ítem de evidencia SÍ corresponde al propio
      // `affectedElement.selector` (grounding propio), y los demás son
      // comparativos/contextuales. La regla mínima y no-rupturista: degradar
      // SOLO cuando el finding tiene evidencia citada pero NINGÚN ítem
      // corresponde a su propio elemento, al contexto genérico, o está
      // implícito (ausente -> ya por defecto es el propio) -- es decir,
      // cuando el 100% de la evidencia pertenece a otro(s) elemento(s).
      // Evidencia comparativa/contextual ADICIONAL a un grounding propio real
      // nunca se penaliza (Caso 6, no se rompe).
      if (finding.evidence && finding.evidence.length > 0 && finding.affectedElement?.selector) {
        const affectedSelector = finding.affectedElement.selector;
        // P1.7.3.1 -- predicado factorizado a `isEvidenceSelfGrounded` (mismo
        // comportamiento exacto, reutilizado también por la Automation
        // Signal Protection más abajo).
        const hasSelfGroundedEvidence = finding.evidence.some((item) => isEvidenceSelfGrounded(item.selector, affectedSelector));
        if (!hasSelfGroundedEvidence) {
          status = 'NOT_EVALUABLE';
          confidence = 'low';
        }
      }

      // 0c. Gate Rule 0c [Revisión MVP, post-evaluación real
      // `6ad2eddad9fe70084f43d58d`] — trazabilidad de evidencia
      // ACCESSIBILITY_TREE. Ningún EvidenceKind indexado por Rule 0/0b
      // cubre este tipo (es texto libre, no uno de los 8 arreglos
      // estructurados -- ver evidence-traceability.service.ts), así que un
      // `value` citado aquí podía ser fiel o inventado sin que el sistema
      // lo distinguiera. Verificación deliberadamente estrecha (misma
      // filosofía que Rule 0): el `value` debe aparecer como subcadena en
      // el texto REAL del árbol de accesibilidad enviado en esa llamada --
      // NO confirma que pertenezca al selector exacto citado (eso
      // requeriría parsear el árbol y resolver selectores CSS contra él,
      // fuera de alcance de este cambio mínimo), solo que no fue inventado
      // de la nada.
      //
      // Si `accessibilityTreeText` no se proveyó o está vacío (la captura
      // del árbol falló para esa iteración, algo que ya ocurre
      // silenciosamente en automation.service.ts), esta regla NUNCA
      // degrada -- mismo principio de "ausencia de evidencia de
      // verificación nunca se trata como prueba de fallo" ya aplicado en
      // Gate Rule V0 del lado de prototipos: no poder verificar un árbol
      // que nunca llegó no es lo mismo que una cita falsa.
      if (finding.evidence && finding.evidence.length > 0 && accessibilityTreeText) {
        const hasUntraceableAccessibilityTreeClaim = finding.evidence.some(
          (item) =>
            item.type === 'ACCESSIBILITY_TREE' &&
            typeof item.value === 'string' &&
            !isAccessibilityTreeValueTraceable(item.value, accessibilityTreeText),
        );
        if (hasUntraceableAccessibilityTreeClaim) {
          status = 'NOT_EVALUABLE';
          confidence = 'low';
        }
      }

      const descLower = (finding.description || '').toLowerCase();

      // 0d. Automation Signal Protection (P1.7.3.1) — un FAIL no puede
      // sustentarse únicamente en que nuestra propia automatización (no la
      // página) falló: timeout, selector no localizable/accionable, acción
      // no ejecutada o no soportada. Se activa solo cuando `description`
      // contiene lenguaje de falla de automatización (ver
      // AUTOMATION_FAILURE_LANGUAGE_PATTERNS arriba); en ese caso, degrada a
      // NOT_EVALUABLE salvo que exista al menos un ítem de evidencia
      // "pertinente" (auto-fundamentado al propio elemento y, si es
      // ACCESSIBILITY_TREE, verificable contra el árbol real -- ver
      // `isPertinentDomEvidence`). Reutiliza `classifyDomFact`/
      // `recommendedStatusForEvidence` de `automation-signal-taxonomy.ts`
      // tal cual, sin duplicar `canJustifyFail`. Solo actúa sobre FAIL
      // (nunca PASS, nunca un NOT_EVALUABLE ya existente), nunca genera un
      // nuevo FAIL, y nunca convierte una señal de automatización en
      // evidencia DOM -- solo decide si el FAIL puede conservarse.
      if (status === 'FAIL') {
        const hasAutomationFailureLanguage = AUTOMATION_FAILURE_LANGUAGE_PATTERNS.some((p) => descLower.includes(p));
        if (hasAutomationFailureLanguage) {
          // J6 (`checkClaimConsistency`) reutilizada tal cual, calculada UNA
          // sola vez por finding -- verifica, para cada ítem, si su
          // property/value citado corresponde realmente al dato capturado.
          const claimConsistencyItems = evidenceIndex ? checkClaimConsistency(finding, evidenceIndex).items : undefined;
          const affectedSelector = finding.affectedElement?.selector;
          const pertinentEvidence: ClassifiedEvidenceItem[] = (finding.evidence ?? [])
            .filter((item, itemIndex) => isPertinentDomEvidence(item, itemIndex, affectedSelector, claimConsistencyItems, accessibilityTreeText))
            .map((item) => classifyDomFact(`${item.type}${item.property ? `:${item.property}` : ''}${item.attribute ? `:${item.attribute}` : ''}`, item));

          if (recommendedStatusForEvidence(pertinentEvidence) === 'NOT_EVALUABLE') {
            status = 'NOT_EVALUABLE';
            confidence = 'low';
          }
        }
      }

      // 0e. WCAG 1.4.3 Evidence Sufficiency Gate (P1.7.3.2) — un FAIL de
      // contraste no puede conservarse solo porque Gemini citó CUALQUIER
      // evidencia autofundamentada (Gate Rule 0b, arriba, exige eso sobre
      // CUALQUIER ítem del finding, nunca específicamente sobre el ítem
      // `contrastRatio`) -- el caso adversarial de diseño demostró que un
      // finding puede superar 0b con un ítem `text` self-grounded mientras
      // su único ítem `contrastRatio` pertenece a OTRO elemento real, con
      // un valor real y correcto para ESE otro elemento (J6/`checkClaim
      // Consistency` tampoco lo detecta: verifica veracidad por selector
      // citado, nunca cruza contra `affectedElement.selector`). Esta regla
      // recalcula el veredicto de contraste desde el MISMO dato real
      // indexado (nunca desde el valor citado por Gemini), reutilizando
      // `computeContrastFailure` tal cual -- única llamada a esta función
      // en todo el Gate. Solo actúa sobre FAIL de WCAG 1.4.3; nunca sobre
      // PASS, nunca sobre un NOT_EVALUABLE ya existente, y nunca produce una
      // conclusión de PASS (toda incertidumbre degrada a NOT_EVALUABLE).
      if (status === 'FAIL' && evidenceIndex && isWcag143(finding.wcagCriterion)) {
        const affectedSelector = finding.affectedElement?.selector;
        const contrastEvidenceItems = (finding.evidence ?? []).filter(
          (item) => (item.property ?? item.attribute) === 'contrastRatio',
        );

        if (contrastEvidenceItems.length === 0) {
          // Caso D -- ninguna evidencia primaria de contraste citada.
          status = 'NOT_EVALUABLE';
          confidence = 'low';
        } else {
          const groundedItems = contrastEvidenceItems.filter((item) => isGroundedContrastEvidence(item, affectedSelector));

          if (groundedItems.length === 0) {
            // Caso E -- toda la evidencia `contrastRatio` citada pertenece a
            // otro elemento, es contextual (document/body), carece de
            // selector explícito, o `affectedSelector` está ausente.
            status = 'NOT_EVALUABLE';
            confidence = 'low';
          } else {
            const normalizedAffected = normalizeSelectorForComparison(affectedSelector as string);
            const entry = evidenceIndex.get(normalizedAffected);
            const computedStyleOccurrences = entry?.occurrences.filter((o) => o.kind === 'computedStyle') ?? [];

            if (!entry || entry.ambiguous || computedStyleOccurrences.length !== 1) {
              // Entrada inexistente, ambigua (Caso D de J1), o más de un
              // registro real de estilo para el mismo selector -- ninguno
              // permite identificar inequívocamente el dato a recalcular.
              status = 'NOT_EVALUABLE';
              confidence = 'low';
            } else {
              const record = computedStyleOccurrences[0].record;
              const recordFontSize = record.fontSize as string | undefined;
              const recordFontWeight = record.fontWeight as string | undefined;

              if (!isUsableFontSize(recordFontSize) || !isUsableFontWeight(recordFontWeight)) {
                // Caso F -- `fontSize`/`fontWeight` ausentes o no
                // interpretables: nunca se usa el default interno de
                // `computeContrastFailure` como base para CONFIRMAR un FAIL.
                status = 'NOT_EVALUABLE';
                confidence = 'low';
              } else {
                const result = computeContrastFailure({
                  color: record.color as string,
                  backgroundColor: record.backgroundColor as string,
                  fontSize: recordFontSize as string,
                  fontWeight: recordFontWeight as string,
                });

                if (result === null || result.inconclusive === true) {
                  // Caso C -- ratio no calculable (color/fondo no
                  // parseable, o fondo con transparencia parcial).
                  status = 'NOT_EVALUABLE';
                  confidence = 'low';
                } else if (result.ratio >= result.minRequiredRatio) {
                  // Caso B -- el dato real CONTRADICE el FAIL de Gemini.
                  // Nunca se invierte a PASS.
                  status = 'NOT_EVALUABLE';
                  confidence = 'low';
                }
                // else: Caso A -- ratio real < umbral real -- FAIL
                // confirmado de forma genuina; status permanece sin cambio.
              }
            }
          }
        }
      }

      // [P1.7.3.1 Entrega A — "Rule 0f" (DOM Presence Sufficiency Gate) fue
      // retirada tras auditoría: no podía verificar de forma independiente
      // la pertinencia semántica de los hallazgos (coincidir con un código
      // WCAG + una propiedad ausente no demuestra que la ausencia sea la
      // causa del problema descrito), degradó hallazgos legítimos por
      // desajuste de `kind`, e interfirió con hallazgos de propósito
      // ambiguo (ej. WCAG 2.4.4). La protección de suficiencia de evidencia
      // para WCAG 4.1.2, 1.1.1, 3.3.2 y 2.4.4 queda pendiente de una
      // solución arquitectónica futura -- ver informes de auditoría de
      // P1.7.3.1. Rule 0e (WCAG 1.4.3, puramente numérica, sin este
      // problema de pertinencia) permanece sin cambios.]

      // 1. Check for speculative conditional language in description
      const hasStrongSpeculativeLanguage = STRONG_SPECULATIVE_KEYWORDS.some((kw) => descLower.includes(kw));
      const hasWeakSpeculativeLanguage = WEAK_SPECULATIVE_KEYWORDS.some((kw) => descLower.includes(kw));
      const hasRealEvidence = !!finding.evidence && finding.evidence.length > 0;
      // "potentially" (débil) solo cuenta como especulativo cuando NO está
      // corroborado por evidencia real + confidence alta -- ver taxonomía arriba.
      const isSpeculative = hasStrongSpeculativeLanguage || (hasWeakSpeculativeLanguage && (!hasRealEvidence || confidence === 'low'));

      // 2. Gate Rule 1: Confidence LOW or speculative language cannot be a FAIL -> Convert to NOT_EVALUABLE
      if (status === 'FAIL' && (isSpeculative || confidence === 'low' || !finding.evidence || finding.evidence.length === 0)) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // 1b. Gate Rule 1b (Hardening K.1, Parte A) — un PASS sin evidencia es
      // una afirmación tan infundada como un FAIL sin evidencia ("no
      // encontré ningún problema" sin nada que lo respalde puede ocultar un
      // falso negativo igual de silenciosamente). Tratamiento simétrico al
      // de FAIL arriba, pero SOLO por ausencia de evidencia -- el lenguaje
      // especulativo/confidence baja de un PASS no tiene el mismo caso real
      // confirmado que motivó la taxonomía de Gate Rule 1 para FAIL, así
      // que no se extiende sin evidencia de que sea necesario.
      if (status === 'PASS' && (!finding.evidence || finding.evidence.length === 0)) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // 2b. Gate Rule 1c (Hardening K.1, Parte A) — normaliza confidence para
      // CUALQUIER NOT_EVALUABLE, sin importar su origen (degradado por un
      // gate arriba, o auto-declarado así por Gemini con confidence=high de
      // entrada). Una abstención con confidence alta es semánticamente
      // incoherente (¿confiado en qué, si no se pudo evaluar?) -- se
      // normaliza aquí para que TODO NOT_EVALUABLE sea internamente
      // consistente con la convención que el propio sistema ya usa cuando
      // ÉL degrada (confidence='low'), nunca solo cuando el gate actuó.
      if (status === 'NOT_EVALUABLE') {
        confidence = 'low';
      }

      // 3. Gate Rule 2: Clean recommendation (Ensure recommendation is actionable, not a copy of heuristic)
      let recommendation = finding.recommendation;
      if (recommendation) {
        const recTrim = recommendation.trim();
        if (
          (finding.heuristicCode && recTrim === finding.heuristicCode.trim()) ||
          (finding.heuristicName && recTrim === finding.heuristicName.trim()) ||
          (finding.heuristic && recTrim === finding.heuristic.trim())
        ) {
          recommendation = `Proporcionar soporte visual y accesible adecuado según las directrices para ${finding.heuristicName || finding.heuristicCode || 'el criterio'}.`;
        }
      }

      // 4. Do not persist NOT_EVALUABLE or PASS as negative FAIL findings
      validatedFindings.push({
        ...finding,
        status,
        confidence,
        recommendation: status === 'FAIL' ? recommendation : null,
      });
    }

    // J1 — log estructurado y pequeño (nunca el contenido de los findings).
    if (evidenceIndex) {
      const degradationPercent = withSelector > 0 ? Number(((notTraceable / withSelector) * 100).toFixed(1)) : 0;
      console.log(
        `[EvidenceTraceabilityAudit] aiFindings=${rawFindings.length} withSelector=${withSelector} ` +
        `traceable=${withSelector - notTraceable} notTraceable=${notTraceable} degradationPercent=${degradationPercent}%`,
      );
    }

    return validatedFindings;
  }
}

export const evidenceGateService = EvidenceGateService.getInstance();
