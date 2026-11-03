import { PrototypeAuditFinding, VISUAL_PROPERTY_WHITELIST } from '@/modules/ai/contracts/prototype.contracts';

/**
 * VisualEvidenceConsistencyService (P3) — análogo de J6
 * (`evidence-claim-consistency.service.ts`) para evidencia visual.
 * Implementa la regla DEFINITIVA cerrada en K.2.1.1 §1-§2:
 *
 *   `region` es contexto espacial, NUNCA identidad de elemento (ni sola ni
 *   combinada con `property`) -- la identidad usada aquí es
 *   `elementDescription`, y SOLO cuenta como identidad suficiente cuando es
 *   ESPECÍFICA (no genérica como "botón"/"enlace"/"imagen"). Dos ítems solo
 *   se comparan por contradicción cuando citan el MISMO string de
 *   `elementDescription` específico Y la MISMA `property` -- nunca por
 *   compartir región.
 *
 * Prioridad metodológica explícita (K.2.1.1): no inventar identidad > no
 * inventar evidencia > no inventar inconsistencia. Cuando la identidad no
 * puede establecerse, el resultado es `NOT_CHECKABLE`, nunca `INCONSISTENT`.
 */

export type VisualClaimConsistencyStatus = 'CONSISTENT' | 'INCONSISTENT' | 'PROPERTY_NOT_OBSERVABLE' | 'NOT_CHECKABLE';

export interface VisualClaimItemResult {
  itemIndex: number;
  property?: string;
  elementDescription?: string;
  status: VisualClaimConsistencyStatus;
  reason: string;
}

export interface VisualEvidenceConsistencyResult {
  overallStatus: 'CONSISTENT' | 'INCONSISTENT' | 'INSUFFICIENT';
  items: VisualClaimItemResult[];
}

/**
 * Descripciones genéricas conocidas (sin modificador distintivo) que NUNCA
 * cuentan como identidad suficiente -- lista determinista, nunca NLP/
 * similitud semántica (K.2.1.1 §3, prohibición explícita).
 */
const GENERIC_DESCRIPTION_DENYLIST = new Set([
  'boton', 'botón', 'enlace', 'link', 'imagen', 'image', 'icono', 'icon',
  'texto', 'text', 'campo', 'field', 'etiqueta', 'label', 'elemento', 'element',
]);

export function isSpecificElementDescription(description?: string): boolean {
  if (!description) return false;
  const normalized = description.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return !GENERIC_DESCRIPTION_DENYLIST.has(normalized);
}

export function checkVisualEvidenceConsistency(finding: PrototypeAuditFinding): VisualEvidenceConsistencyResult {
  const evidenceItems = finding.evidence || [];

  const items: VisualClaimItemResult[] = evidenceItems.map((item, itemIndex) => {
    const base = { itemIndex, property: item.property, elementDescription: item.elementDescription };

    if (!item.property || item.value === undefined) {
      return { ...base, status: 'NOT_CHECKABLE' as const, reason: 'Ítem sin property/value citados -- no verificable.' };
    }
    if (!VISUAL_PROPERTY_WHITELIST.includes(item.property as any)) {
      return {
        ...base,
        status: 'PROPERTY_NOT_OBSERVABLE' as const,
        reason: `"${item.property}" no pertenece a la whitelist de propiedades visuales observables.`,
      };
    }
    if (!isSpecificElementDescription(item.elementDescription)) {
      return {
        ...base,
        status: 'NOT_CHECKABLE' as const,
        reason: 'Descripción ausente o genérica -- no hay identidad suficiente para contrastar contra otros ítems (region nunca sustituye identidad, K.2.1.1).',
      };
    }
    return { ...base, status: 'CONSISTENT' as const, reason: 'Identidad específica establecida; sin contradicción detectada frente a otros ítems con la misma identidad+propiedad.' };
  });

  // Comparación por pares: SOLO entre ítems que ya alcanzaron el estado
  // tentativo 'CONSISTENT' arriba (property conocida + descripción
  // específica). Dos ítems con descripciones específicas DISTINTAS nunca se
  // comparan entre sí -- son, por definición, elementos diferentes (Caso F:
  // "2 enlaces Leer más" con descripciones "enlace Leer más #1"/"#2" nunca
  // se contrastan, evitando una falsa INCONSISTENT).
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.status !== 'CONSISTENT' || b.status !== 'CONSISTENT') continue;
      if (a.property !== b.property) continue;

      const descA = evidenceItems[a.itemIndex].elementDescription!.trim().toLowerCase();
      const descB = evidenceItems[b.itemIndex].elementDescription!.trim().toLowerCase();
      if (descA !== descB) continue;

      const valA = evidenceItems[a.itemIndex].value;
      const valB = evidenceItems[b.itemIndex].value;
      if (valA !== valB) {
        const reason = `Misma descripción específica ("${descA}") y propiedad ("${a.property}") citan valores distintos: "${valA}" vs "${valB}".`;
        a.status = 'INCONSISTENT';
        a.reason = reason;
        b.status = 'INCONSISTENT';
        b.reason = reason;
      }
    }
  }

  // [Revisión MVP, post-P7.5.2] Un ítem SIN property/value (línea 59-61) es
  // NOT_CHECKABLE por dos razones estructuralmente distintas que esta
  // función nunca distinguía:
  //   (a) el ítem simplemente no hace ninguna afirmación property=value
  //       (evidencia 100% elementDescription/context -- el patrón que la
  //       regla 7 del prompt, ai.service.ts, EXPLÍCITAMENTE le pide a
  //       Gemini usar cuando ninguna property de la whitelist representa
  //       fielmente lo observado) -- aquí no hay NADA que contrastar por
  //       contradicción, el concepto de "consistencia" no aplica;
  //   (b) el ítem SÍ afirma property=value pero no se puede establecer
  //       identidad suficiente (descripción ausente/genérica) -- aquí SÍ
  //       hay una afirmación que no pudo verificarse, y degradar
  //       conservadoramente a INSUFFICIENT es correcto (Casos C/D ya
  //       cubiertos por los tests existentes).
  // Tratar ambos casos igual (como hacía esta función antes) degradaba
  // findings 100% caso-(a) a NOT_EVALUABLE sin ninguna razón -- el mismo
  // principio "ausencia nunca penaliza" ya aplicado en Gate Rule V0 se
  // extiende aquí: si NINGÚN ítem del finding afirma property+value, no
  // hay nada que esta función pueda validar, así que el resultado es
  // CONSISTENT (vacuamente, nunca INSUFFICIENT). Si AL MENOS un ítem sí
  // afirma property+value, el comportamiento existente (incluyendo Casos
  // C/D) permanece exactamente igual.
  const anyPropertyValueClaim = evidenceItems.some((item) => !!item.property && item.value !== undefined);

  const anyInconsistent = items.some((i) => i.status === 'INCONSISTENT');
  const anyConsistent = items.some((i) => i.status === 'CONSISTENT');
  const overallStatus: VisualEvidenceConsistencyResult['overallStatus'] = anyInconsistent
    ? 'INCONSISTENT'
    : anyConsistent
      ? 'CONSISTENT'
      : anyPropertyValueClaim
        ? 'INSUFFICIENT'
        : 'CONSISTENT';

  return { overallStatus, items };
}

export interface VisualClaimConsistencySummary {
  total: number;
  consistent: number;
  inconsistent: number;
  insufficient: number;
}

/**
 * Aplica el gate a un batch de findings ya procesados por
 * VisualEvidenceGateService -- mismo patrón de degradación que
 * `applyClaimConsistency` (J6): INCONSISTENT e INSUFFICIENT degradan
 * ambos a NOT_EVALUABLE/confidence=low/recommendation=null (K.1.1: una
 * afirmación 100% no verificable no debe sobrevivir como FAIL confiado,
 * igual que su análogo WEB).
 */
export function applyVisualEvidenceConsistency(
  findings: PrototypeAuditFinding[],
): { findings: PrototypeAuditFinding[]; summary: VisualClaimConsistencySummary } {
  let consistent = 0;
  let inconsistent = 0;
  let insufficient = 0;

  const result = findings.map((finding) => {
    const check = checkVisualEvidenceConsistency(finding);
    if (check.overallStatus === 'CONSISTENT') consistent++;
    else if (check.overallStatus === 'INCONSISTENT') inconsistent++;
    else insufficient++;

    if (check.overallStatus === 'CONSISTENT') return finding;

    return {
      ...finding,
      status: 'NOT_EVALUABLE' as const,
      confidence: 'low' as const,
      recommendation: null,
    };
  });

  console.log(
    `[VisualEvidenceConsistencyAudit] total=${findings.length} consistent=${consistent} ` +
    `inconsistent=${inconsistent} insufficient=${insufficient}`,
  );

  return { findings: result, summary: { total: findings.length, consistent, inconsistent, insufficient } };
}
