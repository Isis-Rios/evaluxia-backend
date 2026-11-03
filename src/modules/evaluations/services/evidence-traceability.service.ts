import {
  HeadingEvidence,
  ImageEvidence,
  LinkEvidence,
  ButtonEvidence,
  LandmarkEvidence,
  FormEvidence,
  ComputedStyleEvidence,
} from '@/modules/snapshots/snapshot-evidence.model';
import { Deduplicated } from './evidence-deduplication.service';
import { V2AuditFinding } from '@/modules/ai/contracts/ai.contracts';

/**
 * evidence-traceability.service — Hardening Post-Fase H, J1.
 *
 * Responde UNA sola pregunta, deliberadamente estrecha (ver el "Principio
 * Fundamental" del plan J1): ¿el elemento al que un finding de Gemini
 * atribuye su hallazgo estaba realmente presente en la evidencia enviada
 * en ESA llamada? NO evalúa si el finding en sí es correcto, ni si la
 * evidencia es semánticamente suficiente para sustentarlo — eso sigue
 * siendo responsabilidad de EvidenceGate (reglas existentes) y de las
 * reglas determinísticas.
 *
 * FUENTE DE VERDAD: el índice se construye EXCLUSIVAMENTE a partir de los
 * mismos objetos (`evidencesSummary`/`dedupedLandmarks`/`dedupedLinks`/
 * `dedupedButtons`) que `AiService.performAuditAnalysis` recibe y usa para
 * construir el prompt real — NUNCA desde el DOM actual de Playwright ni
 * desde ninguna evidencia histórica ajena a ESA llamada. Esto es
 * deliberado: un selector que "alguna vez existió" en otra llamada/
 * iteración no capturada en el paquete enviado a Gemini debe tratarse
 * exactamente igual que un selector inventado (Caso C del plan J1).
 */

export type EvidenceKind = 'heading' | 'image' | 'link' | 'button' | 'landmark' | 'form' | 'formElement' | 'computedStyle';

interface EvidenceOccurrence {
  kind: EvidenceKind;
  /** Tag/tipo inferido cuando es determinable de forma inequívoca (ver inferExpectedTag) — undefined si no aplica. */
  expectedTag?: string;
  /** Huella de contenido (JSON estable) usada para detectar Caso D (mismo selector, contenido genuinamente distinto -> ambiguo). */
  fingerprint: string;
  iterations: number[];
  /**
   * J6 (Hardening Post-Fase H) — el mismo registro plano ya usado para
   * calcular `fingerprint` (sin `iterations`, sin referencias Mongoose:
   * `evidencesSummary`/`dedupedX` ya llegan aquí como objetos planos
   * serializables). Aditivo: J1/traceability nunca lo lee, solo
   * evidence-claim-consistency.service.ts lo consulta para comparar
   * `property`/`value` citados por un finding contra el dato real.
   */
  record: Record<string, unknown>;
}

export interface EvidenceIndexEntry {
  selector: string;
  occurrences: EvidenceOccurrence[];
  /**
   * true cuando el MISMO selector aparece más de una vez con contenido
   * genuinamente distinto (no una simple repetición legítima entre
   * iteraciones/tipos de evidencia complementarios) — Caso D.
   */
  ambiguous: boolean;
}

export type EvidenceIndex = Map<string, EvidenceIndexEntry>;

/**
 * Normalización MÍNIMA y conservadora (Caso E del plan J1). CSS considera
 * insignificante el espacio en blanco inmediatamente adyacente a un
 * combinador (`>`, `+`, `~`) — `a > b` y `a>b` son EL MISMO selector por
 * especificación. Esta función NO hace nada más: no normaliza mayúsculas,
 * no toca valores de atributos, no reordena nada. Cualquier otra
 * diferencia (ej. `nth-of-type(1)` vs `nth-of-type(2)`) se preserva
 * exactamente — exact match sigue siendo la regla, esto es la única
 * excepción demostrablemente segura.
 */
export function normalizeSelectorForComparison(selector: string): string {
  return selector
    .trim()
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ');
}

/**
 * [Revisión MVP, post-evaluación real `6ad2eddad9fe70084f43d58d`] Verifica
 * la procedencia de una evidencia `ACCESSIBILITY_TREE` -- tipo que, a
 * diferencia de los 8 `EvidenceKind` de arriba, NUNCA se indexa en
 * `EvidenceIndex` (el árbol de accesibilidad es texto libre, no uno de los
 * arreglos estructurados `evidencesSummary`/`dedupedLinks`/etc.), así que
 * Gate Rule 0/0b nunca lo verifican hoy -- un valor citado para este tipo
 * puede ser fiel o inventado y el sistema no lo distingue.
 *
 * Verificación DELIBERADAMENTE estrecha, mismo principio que el resto de
 * este archivo (responde una sola pregunta, no evalúa semántica completa):
 * ¿el `value` citado aparece, como subcadena, en el texto REAL del árbol de
 * accesibilidad que de verdad se envió en esa llamada? NO confirma que ese
 * valor pertenezca específicamente al `selector` citado (eso requeriría
 * parsear el árbol YAML-like de Playwright y resolver selectores CSS contra
 * él -- fuera de alcance de un cambio mínimo); solo confirma que no fue
 * inventado de la nada. Comparación case-insensitive y con espacios
 * colapsados (nunca mayúsculas/estructura más allá de eso) -- caso real
 * confirmado: el árbol de Playwright cita `button "Search":`, y el campo
 * `value` del finding es `Search` (sin comillas) -- una subcadena simple ya
 * las captura correctamente sin necesitar normalización adicional.
 *
 * Un `value` vacío siempre se considera trazable (afirmar la AUSENCIA de un
 * nombre no es una cita inventada que pueda refutarse contra el texto).
 */
export function isAccessibilityTreeValueTraceable(value: string, accessibilityTreeText: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue.length === 0) return true;
  return accessibilityTreeText.toLowerCase().includes(normalizedValue);
}

function inferExpectedTag(kind: EvidenceKind, record: any): string | undefined {
  switch (kind) {
    case 'link':
      return 'a';
    case 'image':
      return 'img';
    case 'form':
      return 'form';
    case 'button':
      return typeof record.tag === 'string' ? record.tag.toLowerCase() : undefined;
    case 'computedStyle':
      return typeof record.tag === 'string' ? record.tag.toLowerCase() : undefined;
    case 'heading':
      return typeof record.level === 'number' ? `h${record.level}` : undefined;
    // landmark: `type` puede ser un tag (header/nav/main/footer) o un rol ARIA -- no
    // se puede distinguir sin ambigüedad, se deja indeterminado a propósito.
    // formElement: `type` es el tipo de input (text/email/submit...), no un tag DOM -- indeterminado.
    default:
      return undefined;
  }
}

function addOccurrence(index: EvidenceIndex, selectorRaw: string, kind: EvidenceKind, record: any, iterations: number[]): void {
  const selector = normalizeSelectorForComparison(selectorRaw);
  if (!selector) return;

  const expectedTag = inferExpectedTag(kind, record);
  // Huella de contenido SIN el propio selector (ya es la clave) ni sin
  // `iterations` (eso se acumula aparte, no debe afectar si es "el mismo
  // contenido" o no).
  const { iterations: _ignored, ...contentOnly } = record;
  const fingerprint = JSON.stringify(contentOnly);

  const existing = index.get(selector);
  if (!existing) {
    index.set(selector, {
      selector,
      occurrences: [{ kind, expectedTag, fingerprint, iterations: [...iterations], record: contentOnly }],
      ambiguous: false,
    });
    return;
  }

  const sameKindAndContent = existing.occurrences.find((o) => o.kind === kind && o.fingerprint === fingerprint);
  if (sameKindAndContent) {
    // Misma clave, mismo tipo, MISMO contenido -- repetición legítima
    // (Caso I): solo se amplía la lista de iteraciones donde se observó.
    for (const it of iterations) {
      if (!sameKindAndContent.iterations.includes(it)) sameKindAndContent.iterations.push(it);
    }
    return;
  }

  const sameKindDifferentContent = existing.occurrences.some((o) => o.kind === kind && o.fingerprint !== fingerprint);
  if (sameKindDifferentContent) {
    // Mismo selector, mismo TIPO de evidencia, contenido DISTINTO -> Caso D real.
    existing.ambiguous = true;
  }
  // Mismo selector, tipo DISTINTO (ej. button + computedStyle del mismo
  // elemento real) -- NO es ambigüedad, es cobertura complementaria legítima.
  existing.occurrences.push({ kind, expectedTag, fingerprint, iterations: [...iterations], record: contentOnly });
}

export interface BuildEvidenceIndexInput {
  evidencesSummary: Array<{
    iteration: number;
    headings: HeadingEvidence[];
    images: ImageEvidence[];
    forms: FormEvidence[];
    computedStyles: ComputedStyleEvidence[];
  }>;
  dedupedLandmarks: Array<Deduplicated<LandmarkEvidence>>;
  dedupedLinks: Array<Deduplicated<LinkEvidence>>;
  dedupedButtons: Array<Deduplicated<ButtonEvidence>>;
  /**
   * J4 Step 2 (Hardening Post-Fase H) — OPTIONAL. When provided, this is
   * the FINAL, budget-prioritized computedStyles set that was actually
   * sent to Gemini (see evidence-prioritization.service.ts), and indexing
   * uses ONLY this array (with its own `iterations`) instead of
   * `evidencesSummary[].computedStyles` — because after J4 Step 2 wiring,
   * `evidencesSummary[].computedStyles` no longer represents what was sent
   * (it stays the small, DeterministicAnalyzer-facing raw field). Omitted
   * for backward compatibility with every caller predating J4 Step 2 (falls
   * back to indexing `evidencesSummary[].computedStyles` directly, exactly
   * as before).
   */
  dedupedComputedStyles?: Array<Deduplicated<ComputedStyleEvidence>>;
}

/**
 * Construye el índice "qué pudo observar Gemini realmente" a partir de,
 * literalmente, los mismos 4 objetos que AuditEngine ya tiene en memoria
 * ANTES de llamar a `aiService.performAuditAnalysis` (ver audit-engine.
 * service.ts, paso 4) -- nunca se vuelve a consultar Playwright ni ningún
 * otro origen.
 */
export function buildEvidenceIndex(input: BuildEvidenceIndexInput): EvidenceIndex {
  const index: EvidenceIndex = new Map();

  for (const snap of input.evidencesSummary || []) {
    for (const h of snap.headings || []) addOccurrence(index, h.selector, 'heading', h, [snap.iteration]);
    for (const img of snap.images || []) addOccurrence(index, img.selector, 'image', img, [snap.iteration]);
    for (const form of snap.forms || []) {
      addOccurrence(index, form.selector, 'form', form, [snap.iteration]);
      for (const el of form.elements || []) addOccurrence(index, el.selector, 'formElement', el, [snap.iteration]);
    }
    // J4 Step 2: computedStyles indexed from `evidencesSummary` ONLY when
    // the caller never provided the new `dedupedComputedStyles` (pre-J4
    // Step 2 callers) -- once it's provided, it's the sole source of truth
    // for what was actually sent (see BuildEvidenceIndexInput doc).
    if (!input.dedupedComputedStyles) {
      for (const cs of snap.computedStyles || []) addOccurrence(index, cs.selector, 'computedStyle', cs, [snap.iteration]);
    }
  }
  for (const lm of input.dedupedLandmarks || []) addOccurrence(index, lm.selector, 'landmark', lm, lm.iterations);
  for (const link of input.dedupedLinks || []) addOccurrence(index, link.selector, 'link', link, link.iterations);
  for (const btn of input.dedupedButtons || []) addOccurrence(index, btn.selector, 'button', btn, btn.iterations);
  for (const cs of input.dedupedComputedStyles || []) addOccurrence(index, cs.selector, 'computedStyle', cs, cs.iterations);

  return index;
}

export interface TraceabilityResult {
  /** true solo cuando el finding no requiere validación (sin selector) o la superó. */
  traceable: boolean;
  reason: string;
  matchedKinds?: EvidenceKind[];
}

/**
 * Evalúa UN finding contra el índice. NUNCA determina si el finding es
 * "correcto" -- solo si su `affectedElement.selector` (cuando existe) es
 * trazable a la evidencia realmente enviada.
 */
export function checkFindingTraceability(finding: V2AuditFinding, index: EvidenceIndex): TraceabilityResult {
  const selectorRaw = finding.affectedElement?.selector;
  if (!selectorRaw) {
    // Caso G: no todos los findings necesitan un elemento concreto (ej.
    // heurísticas UX a nivel de página). No aplica esta validación.
    return { traceable: true, reason: 'Finding sin affectedElement.selector -- la validación de trazabilidad no aplica (Caso G).' };
  }

  const selector = normalizeSelectorForComparison(selectorRaw);
  const entry = index.get(selector);

  if (!entry) {
    // Caso B (inventado) y Caso C (de otra llamada/iteración no incluida)
    // son indistinguibles desde este único índice -- y ESO ES CORRECTO: la
    // regla explícita del plan es que un selector que no forma parte de
    // ESTA evidencia se trata igual, exista o no en algún otro contexto.
    return { traceable: false, reason: `El selector "${selectorRaw}" no corresponde a ningún elemento presente en la evidencia enviada en esta llamada.` };
  }

  if (entry.ambiguous) {
    // Caso D.
    return { traceable: false, reason: `El selector "${selectorRaw}" es ambiguo: aparece más de una vez con contenido distinto dentro del mismo tipo de evidencia.` };
  }

  // Caso F: si Gemini proveyó un tag y el índice tiene un tag esperado
  // determinable para AL MENOS UNA ocurrencia, y ninguna coincide, es un
  // tipo incompatible. Si Gemini no proveyó tag, o el índice no puede
  // inferirlo con certeza, no se penaliza (nunca se adivina).
  const geminiTag = finding.affectedElement?.tag?.toLowerCase();
  if (geminiTag) {
    const comparableOccurrences = entry.occurrences.filter((o) => o.expectedTag !== undefined);
    if (comparableOccurrences.length > 0) {
      const anyMatches = comparableOccurrences.some((o) => o.expectedTag === geminiTag);
      if (!anyMatches) {
        return {
          traceable: false,
          reason: `El selector "${selectorRaw}" existe, pero el tag declarado por el finding ("${geminiTag}") no coincide con ningún tipo de evidencia real asociado a ese selector (esperado: ${comparableOccurrences.map((o) => o.expectedTag).join('/')}).`,
        };
      }
    }
  }

  // Caso A / Caso I: trazable. Caso H y Caso J se resuelven DELIBERADAMENTE
  // fuera de esta función (ver docstring del módulo) -- la suficiencia de
  // evidencia y la corrección semántica del claim siguen siendo
  // responsabilidad de EvidenceGate/reglas existentes, nunca de este check.
  return { traceable: true, reason: 'Selector trazable a la evidencia enviada.', matchedKinds: entry.occurrences.map((o) => o.kind) };
}
