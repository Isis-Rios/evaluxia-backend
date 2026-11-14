import { TechnicalEvidenceItem, AffectedElement } from '@/modules/findings/finding.model';

export type CriterionStatus = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';

export const SUPPORTED_NIELSEN_HEURISTICS = [
  'N-01',
  'N-02',
  'N-03',
  'N-04',
  'N-05',
  'N-06',
  'N-07',
  'N-08',
  'N-09',
  'N-10',
] as const;

export const SUPPORTED_WCAG_CRITERIA = [
  'WCAG 1.1.1',
  'WCAG 1.3.1',
  'WCAG 1.4.1',
  'WCAG 1.4.3',
  'WCAG 2.1.1',
  'WCAG 2.4.4',
  'WCAG 2.4.6',
  'WCAG 3.2.2',
  'WCAG 3.3.2',
  'WCAG 4.1.2',
] as const;

export interface InputAuditFinding {
  findingGroup: 'ux' | 'accessibility';
  type?: string;
  status: CriterionStatus;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: 'high' | 'medium' | 'low';
  heuristicCode?: string;
  heuristicName?: string;
  heuristic?: string;
  wcagCriterion?: string;
  description: string;
  evidence?: TechnicalEvidenceItem[];
  affectedElement?: AffectedElement;
  impact?: string;
  recommendation?: string | null;
  iteration: number;
  url?: string;
  screenshotUrl?: string;
  /**
   * Hardening (post Gemini Real #1) -- de dónde proviene este finding
   * (determinístico vs IA ya validada por J1/cardinalidad/J6). Opcional y
   * aditivo a propósito: ningún caller preexistente está obligado a
   * tagguearlo. Cuando SÍ se provee, habilita la política explícita de
   * arbitraje de `deduplicateFindings` (ver docstring ahí) para el caso
   * "mismo criterio+selector, status distinto". Cuando falta en cualquiera
   * de los dos lados de una colisión, se preserva el comportamiento
   * histórico (primer finding insertado gana el status, sin campo
   * `discrepancy`) -- limitación conocida y documentada, no silenciosa.
   */
  origin?: 'deterministic' | 'ai';
}

/**
 * Hardening (post Gemini Real #1) -- cuando `deduplicateFindings` detecta
 * que un finding determinístico y uno de IA comparten exactamente la misma
 * clave (criterio normalizado + selector) pero DISCREPAN en `status`, el
 * veredicto perdedor NUNCA se descarta silenciosamente: se preserva aquí,
 * íntegro, para que frontend/persistencia/matcher puedan inspeccionarlo.
 */
export interface ConsolidationDiscrepancy {
  origin: 'deterministic' | 'ai';
  status: CriterionStatus;
  severity: InputAuditFinding['severity'];
  confidence: InputAuditFinding['confidence'];
  description: string;
  recommendation?: string | null;
  evidence?: TechnicalEvidenceItem[];
}

export interface ConsolidatedFinding extends InputAuditFinding {
  observedIterations: number[];
  screenshotUrls: string[];
  /** Presente únicamente cuando dos fuentes (determinístico/IA) discreparon en `status` para la misma clave -- ver `ConsolidationDiscrepancy`. */
  discrepancy?: ConsolidationDiscrepancy;
  /**
   * Hardening K.1, Parte C -- presente únicamente cuando este finding fue
   * deliberadamente NO fusionado con una observación previa del mismo
   * criterio+selector en OTRA iteración, porque su evidencia contradice
   * directamente la ya registrada para el mismo selector+propiedad (señal
   * de que el selector probablemente apunta a un elemento REAL distinto
   * tras un cambio de DOM entre iteraciones). Nunca se oculta: el finding
   * queda como una entrada consolidada SEPARADA, marcada explícitamente.
   */
  crossIterationIdentityUncertain?: boolean;
}

export interface DomainMetrics {
  evaluatedCount: number;
  passCount: number;
  failCount: number;
  notEvaluableCount: number;
  compliance: number | null;
  coverage: number;
}

export interface ComprehensiveAuditMetrics {
  overallScore: number | null;
  nielsenMetrics: DomainMetrics;
  wcagMetrics: DomainMetrics;
  auditCoverage: number;
  passCount: number;
  failCount: number;
  notEvaluableCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  totalFindings: number;
  evaluatedCriteria: number;
  totalCriteria: number;
  evidenceCount: number;
  consolidatedFindings: ConsolidatedFinding[];
}

export class AuditMetricsService {
  private static instance: AuditMetricsService;

  private constructor() {}

  public static getInstance(): AuditMetricsService {
    if (!AuditMetricsService.instance) {
      AuditMetricsService.instance = new AuditMetricsService();
    }
    return AuditMetricsService.instance;
  }

  /**
   * Deduplicates findings across iterations using a normalized problem identity key:
   *   normalizeCriterionKey(criterion) + "_" + selector
   *
   * Normalization extracts the canonical WCAG code (e.g. "WCAG 1.4.3") or Nielsen code
   * (e.g. "N-01") so that typographic variants from DeterministicAnalyzer and Gemini
   * resolve to the same dedup key.
   *
   * INVARIANT: deterministicFindings MUST precede validatedAiFindings in the input array
   * (guaranteed by AuditEngine). This ensures the deterministic finding is always the Map
   * seed and its measurements take priority during evidence fusion.
   */
  public deduplicateFindings(rawFindings: InputAuditFinding[]): ConsolidatedFinding[] {
    const map = new Map<string, ConsolidatedFinding>();

    for (const f of rawFindings) {
      const rawCriterion = f.wcagCriterion || f.heuristicCode || f.heuristic || f.description;
      const criterionKey = this.normalizeCriterionKey(rawCriterion);
      const selectorKey = f.affectedElement?.selector || f.affectedElement?.tag || 'global';
      let key = `${criterionKey}_${selectorKey}`;

      // Identidad entre iteraciones (Hardening K.1, Parte C): un mismo
      // selector+criterio observado en una iteración NUEVA cuya evidencia
      // CONTRADICE directamente la ya registrada (mismo selector+propiedad,
      // valor distinto) es una señal local -- sin necesitar un
      // EvidenceIndex externo, usando solo los datos ya presentes en el
      // propio array de findings -- de que el selector probablemente
      // apunta a un elemento REAL distinto tras un cambio de DOM entre
      // iteraciones (ej. `button:nth-of-type(2)` era un botón en la
      // iteración 1 y otro completamente distinto en la iteración 2).
      // Principio aplicado: "si no se puede demostrar que dos
      // observaciones son el mismo elemento, no fusionarlas silenciosamente
      // como si lo fueran". Ausencia de evidencia comparable en cualquiera
      // de los dos lados NO es evidencia de conflicto -- no hay nada que
      // demuestre que SON distintos, así que el comportamiento histórico
      // (fusionar) se preserva en ese caso (ver `hasCrossIterationEvidenceConflict`).
      const existingCandidate = map.get(key);
      const isGenuinelyNewIteration = existingCandidate && !existingCandidate.observedIterations.includes(f.iteration);
      const conflicts = isGenuinelyNewIteration
        && this.hasCrossIterationEvidenceConflict(existingCandidate!.evidence, f.evidence, selectorKey);
      // Hardening K.1.1, Parte B: incluso SIN conflicto demostrable, si
      // ambos lados citan evidencia real para propiedades que NUNCA se
      // superponen (ej. iteración 1 cita "ariaLabel", iteración 2 cita
      // "href" -- ninguna corrobora ni contradice a la otra), la identidad
      // compartida NUNCA fue realmente confirmada -- solo asumida por
      // defecto. Esto, a diferencia de "conflicts" (arriba), NO bloquea la
      // fusión (seguiría fragmentando el caso común y legítimo de
      // evidencia simplemente ausente en un lado) -- solo hace VISIBLE que
      // la identidad combinada nunca fue demostrada, para no presentarla
      // con una certeza que los datos no respaldan.
      const unprovenIdentity = isGenuinelyNewIteration && !conflicts
        && this.hasUnprovenCrossIterationIdentity(existingCandidate!.evidence, f.evidence, selectorKey);
      if (conflicts) {
        key = `${key}#iter${f.iteration}#identidad-incierta`;
      }

      if (!map.has(key)) {
        map.set(key, {
          ...f,
          observedIterations: [f.iteration],
          screenshotUrls: f.screenshotUrl ? [f.screenshotUrl] : [],
          ...(conflicts ? { crossIterationIdentityUncertain: true } : {}),
        });
      } else {
        const existing = map.get(key)!;
        if (!existing.observedIterations.includes(f.iteration)) {
          existing.observedIterations.push(f.iteration);
        }
        if (f.screenshotUrl && !existing.screenshotUrls.includes(f.screenshotUrl)) {
          existing.screenshotUrls.push(f.screenshotUrl);
        }
        if (unprovenIdentity) {
          existing.crossIterationIdentityUncertain = true;
        }
        // Política de consolidación ante discrepancia de `status` (Hardening
        // post Gemini Real #1, hallazgo A) -- ver docstring de
        // `applyStatusConsolidationPolicy`. Se aplica ANTES de fusionar
        // evidencia para que, si hay un cambio de status externo, la
        // evidencia que se fusiona después sea coherente con el finding
        // resultante.
        if (f.status !== existing.status) {
          this.applyStatusConsolidationPolicy(existing, f);
        }
        // Merge evidence with selector-awareness and deterministic-priority.
        if (f.evidence && f.evidence.length > 0) {
          existing.evidence = this.mergeEvidence(
            existing.evidence || [],
            f.evidence,
            selectorKey,
          );
        }
      }
    }

    return Array.from(map.values());
  }

  /**
   * Política de consolidación ante discrepancia de `status` (Hardening post
   * Gemini Real #1, hallazgo A). Contrato explícito, NO "Gemini siempre
   * gana" ni "determinístico siempre gana":
   *
   * Regla 1 (universal, sin importar `origin`): una abstención
   * (`NOT_EVALUABLE`) NUNCA gana silenciosamente sobre un veredicto
   * decisivo (`PASS`/`FAIL`) del otro lado, sin importar el orden de
   * inserción -- el decisivo se adopta como status externo; la abstención
   * no se registra como `discrepancy` (no es una contradicción, es "no sé",
   * no hay nada que preservar como contra-afirmación).
   *
   * Regla 2 (ambos decisivos, `status` distinto -- discrepancia genuina):
   * si se puede identificar que un lado es `origin: 'deterministic'` y el
   * otro `origin: 'ai'`, el determinístico gana el `status` externo --
   * justificado por capacidad del analyzer + verificabilidad objetiva: una
   * regla determinística es una función matemática/estructural reproducible
   * sobre evidencia ya verificada (contraste, alt, label...), nunca una
   * interpretación probabilística, SIN IMPORTAR cuál de los dos llegó
   * primero al array (a diferencia del invariante de orden anterior, que
   * dependía accidentalmente de que `deterministicFindings` precediera a
   * `validatedAiFindings`). El veredicto de IA perdedor NUNCA se descarta:
   * se adjunta íntegro en `existing.discrepancy` (status/confidence/
   * severity/description/recommendation/evidence), visible para
   * frontend/persistencia/matcher.
   *
   * Cuando `origin` falta en cualquiera de los dos lados (callers
   * preexistentes que no lo tagguean) o es igual en ambos (dos findings de
   * IA entre sí, o -- en teoría -- dos determinísticos entre sí): no hay un
   * árbitro principiado adicional más allá de J6/confidence ya aplicados
   * aguas arriba, así que se preserva el comportamiento histórico (el
   * primer finding insertado conserva el `status` externo) -- pero, a
   * diferencia del comportamiento anterior, el veredicto perdedor SIEMPRE
   * se adjunta como `discrepancy`, nunca se pierde en silencio. Esta es la
   * única diferencia de comportamiento para ese caso respecto a antes de
   * esta fase.
   *
   * Límite conocido, documentado y no resuelto en esta fase: si existieran
   * 3+ findings reales para la MISMA clave con 3 status distintos entre sí,
   * solo se preserva el discrepancy del último perdedor (no un array de
   * discrepancias) -- escenario no observado en ninguna ejecución real
   * hasta ahora, documentado como limitación conocida en vez de
   * sobre-diseñado para un caso hipotético.
   */
  private applyStatusConsolidationPolicy(existing: ConsolidatedFinding, incoming: InputAuditFinding): void {
    const existingDecisive = existing.status !== 'NOT_EVALUABLE';
    const incomingDecisive = incoming.status !== 'NOT_EVALUABLE';

    if (!existingDecisive && incomingDecisive) {
      this.adoptExternalFields(existing, incoming);
      return;
    }
    if (existingDecisive && !incomingDecisive) {
      return;
    }
    if (!existingDecisive && !incomingDecisive) {
      // Dos abstenciones con razones distintas -- no hay status decisivo
      // que perder; se conserva la primera (sin discrepancy: ninguna de
      // las dos es una afirmación que contradiga a la otra).
      return;
    }

    // Ambos decisivos, status distinto: discrepancia genuina.
    if (existing.origin === 'ai' && incoming.origin === 'deterministic') {
      const losingAiVerdict: ConsolidationDiscrepancy = {
        origin: 'ai',
        status: existing.status,
        severity: existing.severity,
        confidence: existing.confidence,
        description: existing.description,
        recommendation: existing.recommendation,
        evidence: existing.evidence,
      };
      this.adoptExternalFields(existing, incoming);
      existing.origin = 'deterministic';
      existing.discrepancy = losingAiVerdict;
      return;
    }

    // Cubre: existing=deterministic/incoming=ai (Regla 2, caso esperado);
    // y el fallback cuando origin falta o es igual en ambos lados (ver
    // docstring) -- existing conserva su status externo, pero el
    // veredicto entrante perdedor se adjunta siempre, nunca se descarta.
    existing.discrepancy = {
      origin: incoming.origin ?? (existing.origin === 'deterministic' ? 'ai' : 'deterministic'),
      status: incoming.status,
      severity: incoming.severity,
      confidence: incoming.confidence,
      description: incoming.description,
      recommendation: incoming.recommendation,
      evidence: incoming.evidence,
    };
  }

  private adoptExternalFields(existing: ConsolidatedFinding, incoming: InputAuditFinding): void {
    existing.status = incoming.status;
    existing.severity = incoming.severity;
    existing.confidence = incoming.confidence;
    existing.description = incoming.description;
    existing.recommendation = incoming.recommendation;
    existing.impact = incoming.impact;
    if (incoming.origin) existing.origin = incoming.origin;
  }

  /**
   * Normalizes a criterion string to its canonical code for deduplication.
   * Examples:
   *   "WCAG 1.4.3 Contraste (Minimo)"  -> "WCAG 1.4.3"
   *   "WCAG 1.4.3 Contraste minimo"    -> "WCAG 1.4.3"
   *   "N-01 Visibilidad del estado"    -> "N-01"
   *   "N-01"                           -> "N-01"
   * Falls back to lowercased trimmed string if no canonical code is detected.
   */
  /**
   * J6-metrics-fix (Hardening Post-Fase H): visibilidad cambiada de
   * `private` a `public` -- ÚNICO cambio de esta corrección. El cuerpo de
   * la función no se modificó. Esto permite que `calculateMetrics` (más
   * abajo) reutilice esta MISMA implementación en vez de mantener una
   * segunda lógica de extracción (`SUPPORTED_WCAG_CRITERIA.find()`), que
   * era la causa exacta de la inconsistencia demostrada en H-REGRESSION-1
   * (normalizeCriterionKey -> "WCAG 3.3.2" vs. wcagStatusMap -> "WCAG
   * 1.3.1" para el mismo string combinado). `ground-truth-oracle.ts`
   * mantiene su propia copia deliberadamente idéntica (no se tocó aquí,
   * fuera del alcance de esta fase) -- con este cambio, dedup, métricas y
   * Ground Truth Oracle comparten ahora el mismo algoritmo de extracción.
   */
  public normalizeCriterionKey(criterion: string): string {
    if (!criterion) return 'unknown';
    const nielsenMatch = criterion.match(/N-\d{2}/i);
    if (nielsenMatch) return nielsenMatch[0].toUpperCase().trim();
    const wcagMatch = criterion.match(/(?<!\d\.)\b(?:WCAG\s+)?(\d+\.\d+\.\d+)(?!\.\d)\b/i);
    if (wcagMatch) return `WCAG ${wcagMatch[1]}`;
    return criterion.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Merges incoming evidence items into the existing evidence array with two guards:
   *
   * Guard 1 - Selector coherence: only evidence whose selector matches the consolidated
   * finding's affectedElement selector (or is a global anchor like 'document'/'body') is
   * incorporated. Evidence from a different selector is discarded, preventing
   * cross-element contamination (e.g. a 13.73:1 ratio from another element bleeding
   * into the finding for a:nth-of-type(1)).
   *
   * Guard 2 - Deterministic priority: if the existing evidence already contains a
   * contrastRatio measurement for the consolidated selector, any incoming contrastRatio
   * evidence for that selector is discarded. This preserves the backend-calculated ratio
   * (e.g. 2.32:1) over Gemini's re-estimate (e.g. 3.12:1).
   *
   * Compatible contextual evidence (color, backgroundColor, etc.) from the same selector
   * is still fused to provide richer context.
   */
  /**
   * Contrato canónico `property`/`attribute` (Hardening post Gemini Real
   * #1): `property` es el nombre de campo autoritativo (Gemini y la
   * mayoría de reglas determinísticas ya lo usan); `attribute` es un alias
   * legacy que `analyzeImages`/`analyzeLinks` usaban antes de esta fase
   * (ya migradas). Esta función lee ambos para no fragmentar/duplicar
   * evidencia citada bajo el nombre legacy -- ver mismo patrón en
   * `finding-matching.ts`'s `canonicalProperty`.
   */
  private canonicalProperty(item: TechnicalEvidenceItem): string | undefined {
    return item.property ?? item.attribute;
  }

  /**
   * P1.1.1 (corrección del defecto A detectado en la auditoría de P1.1) —
   * distingue una medición de contraste REAL (ej. "2.32:1", "4:1", como las
   * produce `analyzeContrast`/J6's derived resolver) del sentinel
   * "no determinable" que `analyzeContrast` ahora puede emitir cuando el
   * fondo tiene transparencia parcial (ver deterministic-analyzer.service.ts,
   * P1.1). Guard 2 de `mergeEvidence` (abajo) existe para proteger una
   * medición determinística REAL frente al re-estimado de Gemini -- el
   * sentinel no es una medición, y tratarlo como una perdía silenciosamente
   * el `contrastRatio` numérico real que la IA sí aportaba, dejando un
   * `Finding` persistido con `status: FAIL` pero evidencia "no determinable".
   */
  private isNumericContrastRatioValue(value: string | undefined): boolean {
    return !!value && /^\d+(\.\d+)?:1$/.test(value);
  }

  /**
   * Hardening K.1, Parte C — ver docstring en `deduplicateFindings`. Compara
   * la evidencia YA registrada contra la entrante para el MISMO
   * selector+propiedad; devuelve `true` solo si existe al menos un par
   * propiedad/valor realmente comparable (presente en ambos lados) con
   * valores DISTINTOS. La ausencia de superposición (ningún lado cita una
   * propiedad en común) nunca cuenta como conflicto -- no hay nada que
   * demuestre divergencia, así que no se bloquea la fusión histórica.
   */
  private hasCrossIterationEvidenceConflict(
    existingEvidence: TechnicalEvidenceItem[] | undefined,
    incomingEvidence: TechnicalEvidenceItem[] | undefined,
    selectorKey: string,
  ): boolean {
    if (!existingEvidence?.length || !incomingEvidence?.length) return false;
    const existingValueByProperty = new Map<string, string | undefined>();
    for (const item of existingEvidence) {
      if (item.selector && item.selector !== selectorKey) continue;
      const property = this.canonicalProperty(item);
      if (property) existingValueByProperty.set(property, item.value);
    }
    for (const item of incomingEvidence) {
      if (item.selector && item.selector !== selectorKey) continue;
      const property = this.canonicalProperty(item);
      if (!property || !existingValueByProperty.has(property)) continue;
      if (existingValueByProperty.get(property) !== item.value) return true;
    }
    return false;
  }

  /**
   * Hardening K.1.1, Parte B — ver docstring de uso en `deduplicateFindings`.
   * `true` solo cuando AMBOS lados citan evidencia real para el
   * selector+criterio, pero NINGUNA propiedad se superpone entre ellos --
   * la identidad compartida nunca fue ni confirmada (no hay valor repetido
   * que coincida) ni refutada (no hay valor repetido que contradiga, eso ya
   * lo cubre `hasCrossIterationEvidenceConflict`). Cuando cualquiera de los
   * dos lados no citó evidencia en absoluto, esto devuelve `false`
   * deliberadamente -- ese es el caso común y preexistente (ej. Gemini no
   * repite evidencia ya mostrada), no el escenario nuevo de riesgo que esta
   * fase investiga.
   */
  private hasUnprovenCrossIterationIdentity(
    existingEvidence: TechnicalEvidenceItem[] | undefined,
    incomingEvidence: TechnicalEvidenceItem[] | undefined,
    selectorKey: string,
  ): boolean {
    if (!existingEvidence?.length || !incomingEvidence?.length) return false;
    const existingProps = new Set<string>();
    for (const item of existingEvidence) {
      if (item.selector && item.selector !== selectorKey) continue;
      const property = this.canonicalProperty(item);
      if (property) existingProps.add(property);
    }
    const incomingProps = new Set<string>();
    for (const item of incomingEvidence) {
      if (item.selector && item.selector !== selectorKey) continue;
      const property = this.canonicalProperty(item);
      if (property) incomingProps.add(property);
    }
    if (existingProps.size === 0 || incomingProps.size === 0) return false;
    for (const p of incomingProps) {
      if (existingProps.has(p)) return false; // superposición -> confirmado o ya tratado como conflicto arriba
    }
    return true;
  }

  private mergeEvidence(
    existing: TechnicalEvidenceItem[],
    incoming: TechnicalEvidenceItem[],
    consolidatedSelector: string,
  ): TechnicalEvidenceItem[] {
    // P1.1.1: solo una medición NUMÉRICA real cuenta como "ya hay un
    // contrastRatio determinístico que proteger" -- el sentinel
    // "no determinable" nunca lo es (ver isNumericContrastRatioValue).
    const hasDeterministicContrastRatio = existing.some(
      (e) => this.canonicalProperty(e) === 'contrastRatio' &&
        (e.selector === consolidatedSelector || !e.selector) &&
        this.isNumericContrastRatioValue(e.value),
    );

    for (const evItem of incoming) {
      const itemSelector = evItem.selector;

      // Guard 1: Discard evidence from a different element/selector
      if (
        itemSelector &&
        itemSelector !== consolidatedSelector &&
        itemSelector !== 'document' &&
        itemSelector !== 'body'
      ) {
        continue;
      }

      if (this.canonicalProperty(evItem) === 'contrastRatio') {
        if (hasDeterministicContrastRatio) {
          // Guard 2 (sin cambios de comportamiento): ya existe una medición
          // determinística REAL -- se protege del re-estimado de Gemini.
          continue;
        }
        if (this.isNumericContrastRatioValue(evItem.value)) {
          // P1.1.1: lo único que `existing` tenía para esta property/selector
          // era el sentinel "no determinable" (o nada) -- nunca una medición
          // real que proteger. Si la IA SÍ aporta una medición numérica
          // válida, se retira el sentinel no informativo antes de admitir el
          // valor real, para no dejar dos entradas `contrastRatio`
          // contradictorias (una dice "no determinable", otra da un número)
          // en el mismo finding.
          for (let i = existing.length - 1; i >= 0; i--) {
            const e = existing[i];
            if (
              this.canonicalProperty(e) === 'contrastRatio' &&
              (e.selector === consolidatedSelector || !e.selector) &&
              !this.isNumericContrastRatioValue(e.value)
            ) {
              existing.splice(i, 1);
            }
          }
        }
        // Si tampoco la IA aporta un valor numérico válido, no se inventa
        // ninguna medición ni se convierte el sentinel en un número -- se
        // deja que la deduplicación estándar de abajo decida (normalmente
        // no añadirá nada nuevo si el valor coincide con lo ya existente).
      }

      // Standard deduplication by exact key (canonicalProperty: ver arriba)
      const evKey = `${evItem.type}_${evItem.selector}_${this.canonicalProperty(evItem)}_${evItem.value}`;
      const alreadyPresent = existing.some(
        (e) => `${e.type}_${e.selector}_${this.canonicalProperty(e)}_${e.value}` === evKey,
      );
      if (!alreadyPresent) {
        existing.push(evItem);
      }
    }

    return existing;
  }

  /**
   * Consolidates criteria status: maps findings to Nielsen (10) and WCAG (10) spaces.
   * Multiple findings under 1 criterion produce 1 single criterion status (FAIL takes precedence).
   */
  public calculateMetrics(rawFindings: InputAuditFinding[]): ComprehensiveAuditMetrics {
    const consolidatedFindings = this.deduplicateFindings(rawFindings);

    // 1. Map Nielsen 10 Heuristics (N-01 to N-10)
    const nielsenStatusMap = new Map<string, { status: CriterionStatus; maxSeverity: string }>();
    for (const hCode of SUPPORTED_NIELSEN_HEURISTICS) {
      nielsenStatusMap.set(hCode, { status: 'NOT_EVALUABLE', maxSeverity: 'info' });
    }

    // 2. Map WCAG 10 Core Criteria
    const wcagStatusMap = new Map<string, { status: CriterionStatus; maxSeverity: string }>();
    for (const wCrit of SUPPORTED_WCAG_CRITERIA) {
      wcagStatusMap.set(wCrit, { status: 'NOT_EVALUABLE', maxSeverity: 'info' });
    }

    // Process consolidated findings into criteria status maps
    for (const f of consolidatedFindings) {
      // Process Nielsen
      if (f.heuristicCode && nielsenStatusMap.has(f.heuristicCode)) {
        const current = nielsenStatusMap.get(f.heuristicCode)!;
        if (f.status === 'FAIL') {
          current.status = 'FAIL';
          current.maxSeverity = this.getHigherSeverity(current.maxSeverity, f.severity);
        } else if (f.status === 'PASS' && current.status !== 'FAIL') {
          current.status = 'PASS';
        }
      }

      // Process WCAG
      if (f.wcagCriterion) {
        // J6-metrics-fix (Hardening Post-Fase H): antes se usaba
        // `SUPPORTED_WCAG_CRITERIA.find(c => f.wcagCriterion!.includes(c))`
        // -- un algoritmo DISTINTO del que usa `deduplicateFindings`
        // (normalizeCriterionKey, primer código por posición TEXTUAL), lo
        // que causaba que un `wcagCriterion` con varios códigos WCAG
        // pudiera consolidarse bajo un código (dedup) y contabilizarse en
        // las métricas bajo OTRO código distinto (demostrado en
        // H-REGRESSION-1 / audit-metrics-combined-wcag-criterion.test.ts).
        // Ahora usa la MISMA función que dedup y que el Ground Truth
        // Oracle (ground-truth-oracle.ts mantiene su propia copia
        // deliberadamente idéntica) -- una sola fuente de verdad.
        const matchedWCAG = this.normalizeCriterionKey(f.wcagCriterion);
        if (wcagStatusMap.has(matchedWCAG)) {
          const current = wcagStatusMap.get(matchedWCAG)!;
          if (f.status === 'FAIL') {
            current.status = 'FAIL';
            current.maxSeverity = this.getHigherSeverity(current.maxSeverity, f.severity);
          } else if (f.status === 'PASS' && current.status !== 'FAIL') {
            current.status = 'PASS';
          }
        }
      }
    }

    // Calculate Nielsen Domain Metrics
    let nPass = 0, nFail = 0, nNotEval = 0;
    for (const [_, val] of nielsenStatusMap) {
      if (val.status === 'PASS') nPass++;
      else if (val.status === 'FAIL') nFail++;
      else nNotEval++;
    }
    const nEvaluable = nPass + nFail;
    const nielsenCompliance = nEvaluable > 0 ? parseFloat(((nPass / nEvaluable) * 100).toFixed(2)) : null;
    const nielsenCoverage = parseFloat((((nPass + nFail) / 10) * 100).toFixed(2));

    // Calculate WCAG Domain Metrics
    let wPass = 0, wFail = 0, wNotEval = 0;
    for (const [_, val] of wcagStatusMap) {
      if (val.status === 'PASS') wPass++;
      else if (val.status === 'FAIL') wFail++;
      else wNotEval++;
    }
    const wEvaluable = wPass + wFail;
    const wcagCompliance = wEvaluable > 0 ? parseFloat(((wPass / wEvaluable) * 100).toFixed(2)) : null;
    const wcagCoverage = parseFloat((((wPass + wFail) / SUPPORTED_WCAG_CRITERIA.length) * 100).toFixed(2));

    // Consolidated Global Totals
    const totalPass = nPass + wPass;
    const totalFail = nFail + wFail;
    const totalNotEval = nNotEval + wNotEval;
    const totalEvaluable = totalPass + totalFail;
    const totalSpace = SUPPORTED_NIELSEN_HEURISTICS.length + SUPPORTED_WCAG_CRITERIA.length;

    const auditCoverage = totalSpace > 0 ? parseFloat(((totalEvaluable / totalSpace) * 100).toFixed(2)) : 0;

    // Calculate 100% Deterministic Overall Score (Alternativa C)
    let overallScore: number | null = null;
    if (totalEvaluable > 0) {
      const globalCompliance = (totalPass / totalEvaluable) * 100;

      // Calculate severity deductions normalized over evaluated criteria
      let totalSeverityPenalty = 0;
      for (const [_, val] of nielsenStatusMap) {
        if (val.status === 'FAIL') totalSeverityPenalty += this.getSeverityWeight(val.maxSeverity);
      }
      for (const [_, val] of wcagStatusMap) {
        if (val.status === 'FAIL') totalSeverityPenalty += this.getSeverityWeight(val.maxSeverity);
      }

      const severityPenaltyNormalized = totalSeverityPenalty / totalEvaluable;
      const baseQuality = Math.max(0, globalCompliance - severityPenaltyNormalized);
      const gammaCoverage = 0.5 + 0.5 * (auditCoverage / 100);

      overallScore = Math.min(100, Math.max(0, Math.round(baseQuality * gammaCoverage)));
    }

    // Counts by severity across element-level findings
    const failFindings = consolidatedFindings.filter((f) => f.status === 'FAIL');
    const criticalCount = failFindings.filter((f) => f.severity === 'critical').length;
    const highCount = failFindings.filter((f) => f.severity === 'high').length;
    const mediumCount = failFindings.filter((f) => f.severity === 'medium').length;
    const lowCount = failFindings.filter((f) => f.severity === 'low').length;
    const infoCount = consolidatedFindings.filter((f) => f.severity === 'info').length;

    // Count evidence items
    let evidenceCount = 0;
    for (const f of consolidatedFindings) {
      evidenceCount += f.evidence?.length || 0;
    }

    return {
      overallScore,
      nielsenMetrics: {
        evaluatedCount: nEvaluable,
        passCount: nPass,
        failCount: nFail,
        notEvaluableCount: nNotEval,
        compliance: nielsenCompliance,
        coverage: nielsenCoverage,
      },
      wcagMetrics: {
        evaluatedCount: wEvaluable,
        passCount: wPass,
        failCount: wFail,
        notEvaluableCount: wNotEval,
        compliance: wcagCompliance,
        coverage: wcagCoverage,
      },
      auditCoverage,
      passCount: totalPass,
      failCount: totalFail,
      notEvaluableCount: totalNotEval,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
      totalFindings: failFindings.length,
      evaluatedCriteria: totalEvaluable,
      totalCriteria: totalSpace,
      evidenceCount,
      consolidatedFindings,
    };
  }

  private getSeverityWeight(sev: string): number {
    switch (sev) {
      case 'critical':
        return 20;
      case 'high':
        return 12;
      case 'medium':
        return 6;
      case 'low':
        return 2;
      default:
        return 0;
    }
  }

  private getHigherSeverity(sev1: string, sev2: string): string {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    const idx1 = order.indexOf(sev1);
    const idx2 = order.indexOf(sev2);
    if (idx1 === -1) return sev2;
    if (idx2 === -1) return sev1;
    return idx1 <= idx2 ? sev1 : sev2;
  }
}

export const auditMetricsService = AuditMetricsService.getInstance();
