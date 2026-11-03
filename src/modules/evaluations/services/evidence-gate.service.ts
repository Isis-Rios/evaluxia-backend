import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';
import { EvidenceIndex, checkFindingTraceability, isAccessibilityTreeValueTraceable } from './evidence-traceability.service';

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
        const CONTEXTUAL_SELECTORS = new Set(['document', 'body']);
        const hasSelfGroundedEvidence = finding.evidence.some((item) => {
          const itemSelector = item.selector;
          return !itemSelector || itemSelector === affectedSelector || CONTEXTUAL_SELECTORS.has(itemSelector);
        });
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

      // 1. Check for speculative conditional language in description
      const descLower = (finding.description || '').toLowerCase();
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
