import { ConsolidatedFinding } from './audit-metrics.service';

/**
 * [Cierre de inconsistencia del resumen ejecutivo, auditoría post-fix
 * CLICK→CLICK 2026-11-14] Hasta ahora, `executiveSummary` llegaba de la
 * MISMA respuesta de Gemini que los `findings` crudos, ANTES de Evidence
 * Gate/consolidación -- nunca se conciliaba con el veredicto final. En una
 * evaluación real (`6af7c107d95c2b6563ab8705`) esto produjo un resumen que
 * describía dos hallazgos `NOT_EVALUABLE` como incumplimientos confirmados
 * y omitía los 3 `FAIL` reales de contraste.
 *
 * Este módulo construye una sección DETERMINÍSTICA ("Resultados verificados
 * por EvalUXIA") directamente desde `metrics.consolidatedFindings` -- el
 * MISMO arreglo ya usado para calcular todas las métricas del Report (no se
 * recalcula ni se deriva nada por separado) -- y la antepone al texto
 * narrativo de Gemini, dejando este último explícitamente etiquetado como
 * complementario y no autoritativo. No se usa NINGUNA expresión regular ni
 * heurística de texto sobre el resumen de Gemini para "adivinar" su
 * contenido: el bloque verificado se construye exclusivamente a partir de
 * campos ya estructurados (`status`, `severity`, `wcagCriterion`/
 * `heuristicCode`, `description`, `evidence`, `recommendation`,
 * `affectedElement`), nunca inventados.
 *
 * Texto plano, sin sintaxis Markdown -- mismo motivo ya documentado en
 * `appendSummaryDisclaimer` (metrics-tracker.ts): `EvaluationSummary.tsx`
 * (frontend) renderiza `report.summary` como texto literal
 * (`whiteSpace: 'pre-wrap'`, sin parser de Markdown).
 *
 * `severity` se muestra tal cual está persistida (impacto potencial, según
 * su semántica ya documentada) -- nunca se reinterpreta ni se sustituye en
 * función del `status`.
 */

function describeCriterion(finding: ConsolidatedFinding): string {
  return finding.wcagCriterion || finding.heuristicCode || finding.heuristicName || 'Criterio no especificado';
}

function describeAffectedElement(finding: ConsolidatedFinding): string | null {
  const el = finding.affectedElement as { selector?: string; text?: string; tag?: string } | undefined;
  if (!el) return null;
  if (el.text) return el.tag ? `<${el.tag}> "${el.text}"` : `"${el.text}"`;
  if (el.selector) return el.selector;
  return null;
}

function describeEvidence(finding: ConsolidatedFinding): string | null {
  if (!finding.evidence || finding.evidence.length === 0) return null;
  return finding.evidence
    .map((item) => {
      const prop = (item as { property?: string; attribute?: string }).property ?? (item as { attribute?: string }).attribute ?? 'evidencia';
      const value = (item as { value?: unknown }).value;
      return value !== undefined && value !== null ? `${prop}: ${value}` : prop;
    })
    .join('; ');
}

/** Un hallazgo por entrada, con el detalle completo disponible -- usado para FAIL y NOT_EVALUABLE (volumen típicamente bajo, máxima trazabilidad). */
function renderDetailedFinding(finding: ConsolidatedFinding, index: number): string {
  const lines: string[] = [];
  lines.push(`  ${index}. Criterio: ${describeCriterion(finding)} | Severidad: ${finding.severity}`);
  lines.push(`     Descripción: ${finding.description}`);
  const element = describeAffectedElement(finding);
  if (element) lines.push(`     Elemento afectado: ${element}`);
  const evidence = describeEvidence(finding);
  if (evidence) lines.push(`     Evidencia: ${evidence}`);
  if (finding.recommendation) lines.push(`     Recomendación: ${finding.recommendation}`);
  return lines.join('\n');
}

function renderDetailedSection(title: string, findings: ConsolidatedFinding[], emptyMessage: string): string {
  if (findings.length === 0) {
    return `${title}:\n  ${emptyMessage}`;
  }
  return `${title}:\n${findings.map((f, i) => renderDetailedFinding(f, i + 1)).join('\n')}`;
}

/** Hallazgos PASS agrupados por criterio con conteo -- volumen típicamente alto; el detalle fino ya existe en los documentos Finding persistidos. */
function renderPassSection(passFindings: ConsolidatedFinding[]): string {
  if (passFindings.length === 0) {
    return 'Cumplimientos confirmados (PASS):\n  No se registraron cumplimientos confirmados en esta evaluación.';
  }
  const byCriterion = new Map<string, number>();
  for (const f of passFindings) {
    const key = describeCriterion(f);
    byCriterion.set(key, (byCriterion.get(key) ?? 0) + 1);
  }
  const lines = Array.from(byCriterion.entries()).map(
    ([criterion, count]) => `  - ${criterion}: ${count} elemento${count === 1 ? '' : 's'} conforme${count === 1 ? '' : 's'}`,
  );
  return `Cumplimientos confirmados (PASS) -- ${passFindings.length} en total:\n${lines.join('\n')}`;
}

/**
 * Construye la sección determinística completa a partir de los hallazgos
 * consolidados. Pura -- sin Gemini, sin Mongo, sin efectos.
 */
export function buildVerifiedResultsSection(consolidatedFindings: ConsolidatedFinding[]): string {
  const failFindings = consolidatedFindings.filter((f) => f.status === 'FAIL');
  const notEvaluableFindings = consolidatedFindings.filter((f) => f.status === 'NOT_EVALUABLE');
  const passFindings = consolidatedFindings.filter((f) => f.status === 'PASS');

  return [
    'RESULTADOS VERIFICADOS POR EVALUXIA',
    '(Esta sección se construye exclusivamente a partir de los hallazgos consolidados y sus estados finales. No proviene del texto narrativo de IA que aparece más abajo.)',
    '',
    renderDetailedSection('Incumplimientos confirmados (FAIL)', failFindings, 'No se encontraron incumplimientos confirmados en esta evaluación.'),
    '',
    renderDetailedSection('Observaciones no evaluables (NOT_EVALUABLE)', notEvaluableFindings, 'No se registraron observaciones no evaluables en esta evaluación.'),
    '',
    renderPassSection(passFindings),
  ].join('\n');
}

/**
 * Compone el `summary` final: sección verificada primero, luego el texto
 * narrativo de Gemini explícitamente marcado como complementario y no
 * autoritativo, con una regla de precedencia explícita ante cualquier
 * discrepancia.
 */
export function composeVerifiedSummary(verifiedSection: string, aiNarrative: string): string {
  return [
    verifiedSection,
    '',
    '----------------------------------------',
    '',
    'ANÁLISIS NARRATIVO COMPLEMENTARIO (IA, NO AUTORITATIVO)',
    'El siguiente texto fue generado por IA y puede incluir observaciones adicionales, interpretaciones o énfasis distintos a los resultados verificados arriba. Ante cualquier discrepancia con la sección "RESULTADOS VERIFICADOS POR EVALUXIA", prevalece esta última.',
    '',
    aiNarrative,
  ].join('\n');
}
