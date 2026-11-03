import { V2AuditFinding, TechnicalEvidenceItem } from '@/modules/ai/contracts/ai.contracts';
import { classifySrcType } from '@/modules/ai/ai.service';
import {
  EvidenceIndex,
  EvidenceKind,
  normalizeSelectorForComparison,
} from './evidence-traceability.service';
import { EVIDENCE_FIELD_WHITELIST } from './evidence-field-whitelist';
import { calculateContrastRatio } from './deterministic-analyzer.service';

/**
 * J6 (Hardening Post-Fase H) — Evidence Claim Consistency.
 *
 * Responde una pregunta DISTINTA y MÁS ESTRECHA que J1/EvidenceTraceability:
 *
 *   J1: ¿el `affectedElement.selector` del finding existe en la evidencia
 *       enviada a Gemini en ESTA llamada?
 *   J6: para cada ítem de `finding.evidence[]`, ¿el par `property`/`value`
 *       que Gemini CITA corresponde realmente al dato capturado para ESE
 *       selector?
 *
 * NO evalúa (deliberadamente, ver diseño aprobado):
 *   - si el `wcagCriterion`/`heuristicCode` elegido es el correcto para la
 *     evidencia citada (eso seguiría siendo un gap abierto, fuera de
 *     alcance);
 *   - afirmaciones dinámicas/conductuales en `description` que no tengan
 *     un ítem de `evidence[]` correspondiente (ver caso N-06 en el informe
 *     de diseño) — J6 solo puede juzgar lo que SÍ fue citado como dato
 *     estructurado, nunca el texto libre de `description`.
 *   - `evidence[].relatedValue`, `.measurement`, `.context` — existen en el
 *     schema pero no forman parte de esta primera implementación (mismo
 *     principio de alcance mínimo del diseño aprobado; se documentan como
 *     limitación conocida, no se ignoran por descuido).
 */

export type ClaimConsistencyStatus = 'CONSISTENT' | 'INCONSISTENT' | 'PROPERTY_NOT_FOUND' | 'NOT_CHECKABLE';

export interface ClaimItemResult {
  itemIndex: number;
  type: string;
  property?: string;
  claimedValue?: string;
  selector?: string;
  status: ClaimConsistencyStatus;
  reason: string;
}

export interface ClaimConsistencyResult {
  /**
   * INCONSISTENT si al menos un ítem lo es (prioridad máxima -- un solo
   * dato falso invalida la confiabilidad del finding, sin importar cuántos
   * otros ítems sean correctos). CONSISTENT si no hay ningún INCONSISTENT
   * y al menos un ítem fue verificado como consistente. INSUFFICIENT si
   * ningún ítem pudo verificarse en ningún sentido (todos NOT_CHECKABLE /
   * PROPERTY_NOT_FOUND) -- nunca se trata como un fallo, solo como "no hay
   * suficiente estructura para pronunciarse".
   */
  overallStatus: 'CONSISTENT' | 'INCONSISTENT' | 'INSUFFICIENT';
  items: ClaimItemResult[];
}

/**
 * Normaliza un valor REAL (tomado del registro indexado, con su tipo
 * original: string/number/boolean/null/undefined/array/object) a la MISMA
 * representación que `TechnicalEvidenceItemSchema` ya fuerza sobre el valor
 * CITADO por Gemini (ver ai.contracts.ts: `.transform((v) => v===undefined
 * ? undefined : v===null ? 'null' : String(v))`).
 *
 * CONFIRMADO por schema (ai.contracts.ts): tanto un `null` real como el
 * STRING literal `"null"` escrito por Gemini colapsan, tras el parseo Zod,
 * exactamente al mismo valor JS: la string `"null"`. Esta ambigüedad es
 * PREEXISTENTE al schema (no introducida por J6) y no es distinguible desde
 * `V2AuditFinding` -- J6 la hereda y la trata de forma uniforme (ambos casos
 * se consideran "el valor real es null/ausente"), documentada aquí en vez de
 * resuelta silenciosamente.
 */
function normalizeActualValueForComparison(actual: unknown): string {
  if (actual === undefined || actual === null) return 'null';
  if (Array.isArray(actual)) return JSON.stringify(actual.map((v) => (v === null ? null : v)));
  if (typeof actual === 'object') {
    const sortedKeys = Object.keys(actual as Record<string, unknown>).sort();
    const stable: Record<string, unknown> = {};
    for (const k of sortedKeys) stable[k] = (actual as Record<string, unknown>)[k];
    return JSON.stringify(stable);
  }
  return String(actual);
}

/** El valor CITADO por Gemini ya llegó como string (o undefined) tras el parseo Zod -- ver docstring arriba. */
function normalizeClaimedValueForComparison(claimed: string | undefined): string | undefined {
  return claimed;
}

/**
 * Propiedades DERIVADAS que J6 reconoce como legítimamente verificables aun
 * cuando no son (o no siempre son) claves literales del registro crudo
 * capturado. Cada una reutiliza la función real de producción -- nunca se
 * reimplementa ni se acepta un campo derivado arbitrario sin resolver aquí
 * explícitamente.
 *
 * `image.srcType`: SÍ es una clave literal de lo que `sanitizeEvidenceForGemini`
 * realmente serializa a Gemini (`EVIDENCE_FIELD_WHITELIST.image` ya la
 * incluye, verificado por `evidence-field-whitelist.test.ts`) -- se deriva
 * de `record.src` vía `classifySrcType`, calculado en tiempo de
 * serialización, pero Gemini genuinamente la ve bajo ese nombre.
 *
 * `computedStyle.contrastRatio`: es DISTINTA en naturaleza -- NUNCA es una
 * clave literal de lo que realmente se serializa a Gemini (confirmado: ni
 * `ComputedStyleEvidence` ni el mapeo de `sanitizeEvidenceForGemini` la
 * incluyen jamás -- por eso `EVIDENCE_FIELD_WHITELIST.computedStyle`
 * correctamente NO la lista; agregarla ahí rompería el test de
 * sincronización whitelist↔producción). Se reconoce aquí, en un registro
 * SEPARADO, únicamente porque: (a) `DeterministicAnalyzer.analyzeContrast`
 * ya la cita en la evidencia de sus propios findings, calculada con la
 * MISMA fórmula (`calculateContrastRatio`, reutilizada, no reimplementada);
 * y (b) el prompt de Fase 2 (`ai.service.ts`, regla "DETERMINISTIC EVIDENCE
 * PRIORITY") le indica a Gemini que existe un "contrastRatio field"
 * citable en el bundle de computedStyles -- una afirmación que no es
 * literalmente cierta para el payload serializado (inconsistencia
 * prompt/evidencia ya documentada por separado), lo que hace plausible que
 * Gemini también cite esta propiedad en findings reales, no solo
 * determinísticos. J6 la verifica recalculándola desde los mismos campos
 * ya en la whitelist (`color`/`backgroundColor`) en los que ya confía.
 */
const DERIVED_PROPERTY_RESOLVERS: Partial<Record<EvidenceKind, Record<string, (record: Record<string, unknown>) => unknown>>> = {
  image: {
    srcType: (record) => classifySrcType(record.src),
  },
  computedStyle: {
    contrastRatio: (record) => {
      const ratio = calculateContrastRatio(record.color as string, record.backgroundColor as string);
      return ratio === null ? null : `${ratio}:1`;
    },
  },
};

function isKnownProperty(kind: EvidenceKind, property: string): boolean {
  return !!EVIDENCE_FIELD_WHITELIST[kind]?.includes(property) || !!DERIVED_PROPERTY_RESOLVERS[kind]?.[property];
}

function resolveActualValue(kind: EvidenceKind, record: Record<string, unknown>, property: string): unknown {
  const derivedResolver = DERIVED_PROPERTY_RESOLVERS[kind]?.[property];
  if (derivedResolver) return derivedResolver(record);
  return record[property];
}

function findMatchingOccurrence(
  entry: { occurrences: Array<{ kind: EvidenceKind; record: Record<string, unknown> }> },
  property: string,
): { kind: EvidenceKind; record: Record<string, unknown> } | undefined {
  return entry.occurrences.find((o) => isKnownProperty(o.kind, property));
}

/**
 * Evalúa un único finding contra el índice. Requiere que el finding ya haya
 * pasado J1 (traceability) -- J6 no repite esa validación: si el selector
 * de un ítem no es trazable, ese ítem se marca `NOT_CHECKABLE` (J1 sigue
 * siendo la autoridad sobre el selector, ver sección 5 del diseño aprobado).
 */
export function checkClaimConsistency(finding: V2AuditFinding, index: EvidenceIndex): ClaimConsistencyResult {
  const items: ClaimItemResult[] = [];
  const evidenceItems: TechnicalEvidenceItem[] = finding.evidence || [];

  evidenceItems.forEach((item, itemIndex) => {
    const property = item.property ?? item.attribute;
    const selectorRaw = item.selector ?? finding.affectedElement?.selector;
    const base = { itemIndex, type: item.type, property, claimedValue: item.value, selector: selectorRaw };

    if (!selectorRaw) {
      items.push({ ...base, status: 'NOT_CHECKABLE', reason: 'Ítem sin selector propio ni del finding -- no verificable.' });
      return;
    }
    if (!property) {
      items.push({ ...base, status: 'NOT_CHECKABLE', reason: 'Ítem sin property/attribute citado -- no verificable.' });
      return;
    }

    const selector = normalizeSelectorForComparison(selectorRaw);
    const entry = index.get(selector);
    if (!entry || entry.ambiguous) {
      items.push({
        ...base,
        status: 'NOT_CHECKABLE',
        reason: entry?.ambiguous
          ? 'Selector ambiguo -- J1 ya lo trata como no trazable; J6 no repite ese juicio.'
          : 'Selector no presente en el índice -- J1 es la autoridad sobre esto, J6 no lo re-evalúa.',
      });
      return;
    }

    const matched = findMatchingOccurrence(entry, property);
    if (!matched) {
      items.push({
        ...base,
        status: 'PROPERTY_NOT_FOUND',
        reason: `"${property}" no es una propiedad real para ningún tipo de evidencia asociado a "${selectorRaw}".`,
      });
      return;
    }

    if (item.value === undefined) {
      items.push({ ...base, status: 'NOT_CHECKABLE', reason: 'Property citada, pero sin value -- no hay dato que comparar.' });
      return;
    }

    const actualRaw = resolveActualValue(matched.kind, matched.record, property);

    // Una propiedad DERIVADA que no pudo calcularse (ej. contrastRatio
    // cuando calculateContrastRatio no puede determinar un color/fondo
    // válido, como un background-color transparente) es distinta de un
    // campo crudo cuyo valor real genuinamente ES null (ej. ariaLabel
    // ausente). Para un campo crudo, `null` es un dato real verificable
    // (ver normalizeActualValueForComparison). Para un derivado, `null`
    // significa "no evaluable", no "el valor real es null/ausente" --
    // compararlo como tal fabricaría un INCONSISTENT artificial cada vez
    // que Gemini cite el derivado sobre un elemento donde no es calculable.
    const isDerivedProperty = !!DERIVED_PROPERTY_RESOLVERS[matched.kind]?.[property];
    if (isDerivedProperty && actualRaw === null) {
      items.push({
        ...base,
        status: 'NOT_CHECKABLE',
        reason: `"${property}" es una propiedad derivada que no pudo calcularse para "${selectorRaw}" (datos base insuficientes) -- no se trata como ausencia real, evita un INCONSISTENT artificial.`,
      });
      return;
    }

    const actualNormalized = normalizeActualValueForComparison(actualRaw);
    const claimedNormalized = normalizeClaimedValueForComparison(item.value);

    if (claimedNormalized === actualNormalized) {
      items.push({ ...base, status: 'CONSISTENT', reason: `Valor citado coincide con el dato real ("${actualNormalized}").` });
    } else {
      items.push({
        ...base,
        status: 'INCONSISTENT',
        reason: `Gemini citó "${claimedNormalized}" para "${property}" en "${selectorRaw}", pero el dato real es "${actualNormalized}".`,
      });
    }
  });

  const anyInconsistent = items.some((i) => i.status === 'INCONSISTENT');
  const anyConsistent = items.some((i) => i.status === 'CONSISTENT');
  const overallStatus: ClaimConsistencyResult['overallStatus'] = anyInconsistent
    ? 'INCONSISTENT'
    : anyConsistent
      ? 'CONSISTENT'
      : 'INSUFFICIENT';

  return { overallStatus, items };
}

export interface ClaimConsistencySummary {
  total: number;
  consistent: number;
  inconsistent: number;
  insufficient: number;
}

/**
 * Aplica J6 a un batch de findings ya procesados por EvidenceGate/J1.
 * Comportamiento ante INCONSISTENT (decisión de diseño aprobada, sección 11):
 * degrada a NOT_EVALUABLE/confidence=low, reutilizando el mismo contrato que
 * EvidenceGate ya usa para sus propias degradaciones -- nunca corrige el
 * valor, nunca elige otro criterio, nunca descarta el finding.
 */
export function applyClaimConsistency(findings: V2AuditFinding[], index: EvidenceIndex): { findings: V2AuditFinding[]; summary: ClaimConsistencySummary } {
  let consistent = 0;
  let inconsistent = 0;
  let insufficient = 0;

  const result = findings.map((finding) => {
    const check = checkClaimConsistency(finding, index);
    if (check.overallStatus === 'CONSISTENT') consistent++;
    else if (check.overallStatus === 'INCONSISTENT') inconsistent++;
    else insufficient++;

    if (check.overallStatus === 'CONSISTENT') return finding;

    // Hardening K.1.1 (descubierto durante la preparación del experimento
    // AI-only, mock M4): antes, INSUFFICIENT (ningún ítem de evidencia pudo
    // verificarse en ningún sentido -- todos NOT_CHECKABLE/
    // PROPERTY_NOT_FOUND) dejaba el finding COMPLETAMENTE SIN TOCAR --
    // confirmado con un caso real: un FAIL citando una propiedad que no
    // existe en absoluto sobrevivía como FAIL, confidence=high,
    // recommendation intacta, pese a que NINGUNA de su evidencia pudo
    // confirmarse. Esto contradice directamente el principio "NO EVIDENCE =
    // NO FAIL" ya establecido en el prompt: evidencia 100% no verificable
    // es, en la práctica, equivalente a no tener evidencia verificable en
    // absoluto. INSUFFICIENT ahora se degrada exactamente igual que
    // INCONSISTENT (NOT_EVALUABLE/confidence=low/recommendation=null) --
    // nunca se "inventa" una INCONSISTENCIA donde no la hay (la razón del
    // degradado documenta que fue por insuficiencia, no por contradicción),
    // pero tampoco se deja sobrevivir una afirmación que nadie pudo
    // confirmar.
    return {
      ...finding,
      status: 'NOT_EVALUABLE' as const,
      confidence: 'low' as const,
      recommendation: null,
    };
  });

  console.log(
    `[EvidenceClaimConsistencyAudit] total=${findings.length} consistent=${consistent} ` +
    `inconsistent=${inconsistent} insufficient=${insufficient}`,
  );

  return { findings: result, summary: { total: findings.length, consistent, inconsistent, insufficient } };
}
