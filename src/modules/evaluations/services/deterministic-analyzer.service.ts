import { ISnapshotEvidence, ComputedStyleEvidence } from '@/modules/snapshots/snapshot-evidence.model';
import { TechnicalEvidenceItem, AffectedElement } from '@/modules/findings/finding.model';

export interface DeterministicFinding {
  findingGroup: 'ux' | 'accessibility';
  type: 'usability' | 'wcag';
  status: 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: 'high' | 'medium' | 'low';
  heuristicCode?: string;
  heuristicName?: string;
  wcagCriterion?: string;
  description: string;
  evidence: TechnicalEvidenceItem[];
  affectedElement?: AffectedElement;
  impact?: string;
  recommendation?: string | null;
  iteration: number;
  url: string;
  screenshotUrl?: string;
}

/**
 * [Revisión MVP, post-evaluación real `6ad2eddad9fe70084f43d58d`] La
 * extracción de formularios (`FormElementEvidence.type`, snapshot-evidence.
 * model.ts) captura el atributo HTML `type` del control (p. ej. "text",
 * "email"), NUNCA el nombre real de la etiqueta -- `analyzeForms` lo usaba
 * directamente como `affectedElement.tag`, produciendo `<text>`/`<email>`
 * en vez de `<input>` en la descripción y en el elemento afectado. La
 * propiedad DOM `.type` también existe en `<select>` ("select-one"/
 * "select-multiple") y `<textarea>` ("textarea") -- hardcodear `'input'`
 * habría sido igual de incorrecto para esos casos. No se modifica la
 * extracción compartida (automation.service.ts) ni el contrato
 * `FormElementEvidence`: esta función deriva el tag real únicamente a
 * partir del espacio cerrado y conocido de valores que `.type` puede tomar
 * para los 3 elementos de formulario con nombre accesible relevante.
 */
export function inferFormControlTag(type: string | null | undefined): string {
  const normalized = (type || '').toLowerCase();
  if (normalized === 'textarea') return 'textarea';
  if (normalized === 'select-one' || normalized === 'select-multiple') return 'select';
  return 'input';
}

/**
 * Calculates WCAG 2.2 Relative Luminance of an sRGB color component.
 */
export function getSRGBColorLuminance(r: number, g: number, b: number): number {
  const rs = r / 255;
  const gs = g / 255;
  const bs = b / 255;

  const R = rs <= 0.04045 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
  const G = gs <= 0.04045 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
  const B = bs <= 0.04045 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Parses CSS color string e.g. "rgb(17, 24, 39)" or "rgba(255, 255, 255, 1)"
 * into {r,g,b,a}. `a` defaults to 1 (fully opaque) when the string has no
 * alpha component (rgb()) or the computed style never reports one.
 */
export function parseCssColor(colorStr: string): { r: number; g: number; b: number; a: number } | null {
  if (!colorStr) return null;
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
    a: match[4] !== undefined ? parseFloat(match[4]) : 1,
  };
}

/**
 * Calculates Contrast Ratio: (L1 + 0.05) / (L2 + 0.05).
 *
 * P1.1 (real incident, evaluación 6ae15b04ce94179ae8ad199b, `#desktopToggle`):
 * the previous version discarded the alpha channel entirely, so
 * `rgba(33,40,50,0.5)` over `rgba(33,40,50,0.2)` parsed to the SAME {r,g,b}
 * and produced a degenerate, misleading "1:1". Alpha is now handled, but
 * only where it can be handled HONESTLY:
 *
 * - A background with partial transparency (`bg.a < 1`) does NOT have a
 *   known effective color here — `SnapshotEvidence` never captures what's
 *   layered behind an element (no ancestor backgroundColor chain), so
 *   compositing onto the DECLARED translucent background would fabricate a
 *   ratio that may not match what a real user sees. This returns `null`
 *   ("not determinable") instead of guessing — same signal already used,
 *   and already correctly handled, by every existing caller (`computeContrastFailure`
 *   skips/flags it; `evidence-claim-consistency.service.ts`'s J6 derived
 *   resolver already treats a `null` ratio as NOT_CHECKABLE, never as a
 *   fabricated mismatch).
 * - Once the background is confirmed opaque (`bg.a === 1`), a translucent
 *   FOREGROUND color DOES have a well-defined, honestly composable
 *   effective color (real alpha-blend over a known backdrop) — this is
 *   standard sRGB "source-over" compositing, not a guess, and is computed
 *   before measuring luminance.
 * - Two fully opaque colors (`fg.a === bg.a === 1`, e.g. the real
 *   `a:nth-of-type(2)` finding from the same incident) take the exact same
 *   path as before this fix — byte-identical output, no regression.
 */
export function calculateContrastRatio(fgColorStr: string, bgColorStr: string): number | null {
  const fg = parseCssColor(fgColorStr);
  const bg = parseCssColor(bgColorStr);
  if (!fg || !bg) return null;

  if (bg.a < 1) return null; // fondo efectivo desconocido -- no se inventa

  const effectiveFg = fg.a < 1
    ? {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
      }
    : fg;

  const l1 = getSRGBColorLuminance(effectiveFg.r, effectiveFg.g, effectiveFg.b);
  const l2 = getSRGBColorLuminance(bg.r, bg.g, bg.b);

  const maxL = Math.max(l1, l2);
  const minL = Math.min(l1, l2);

  return parseFloat(((maxL + 0.05) / (minL + 0.05)).toFixed(2));
}

/**
 * Hardening K.1, Parte D — extraído de `analyzeContrast` (sin alterar su
 * comportamiento; mismo cálculo exacto, ahora reutilizable) para que
 * `evidence-prioritization.service.ts` pueda identificar evidencia de
 * contraste YA objetivamente insuficiente ANTES de la priorización, sin
 * reimplementar la fórmula/umbral en un segundo lugar.
 *
 * P1.1 — ahora puede devolver 3 formas distintas (contrato ampliado,
 * consumidores ya identificados y actualizados: `analyzeContrast` abajo y
 * `evidence-prioritization.service.ts`):
 * - `null`: nada que reportar (sin fondo propio -- comportamiento IDÉNTICO
 *   al anterior, incluye el caso ya existente de fondo totalmente
 *   transparente) o color de texto no parseable.
 * - `{ inconclusive: true, ratio: null, ... }`: SÍ había un fondo declarado,
 *   pero con transparencia parcial -- el efectivo es desconocido, no se
 *   inventa. Caso nuevo, el del incidente real.
 * - `{ inconclusive: false, ratio: number, ... }`: determinable (igual que
 *   antes para opaco/opaco; ahora también para texto translúcido sobre
 *   fondo opaco, compuesto honestamente).
 */
export function computeContrastFailure(
  style: Pick<ComputedStyleEvidence, 'color' | 'backgroundColor' | 'fontSize' | 'fontWeight'>,
):
  | { ratio: number; minRequiredRatio: number; inconclusive: false }
  | { ratio: null; minRequiredRatio: number; inconclusive: true; reason: string }
  | null {
  if (!style.color || !style.backgroundColor) return null;

  const bg = parseCssColor(style.backgroundColor);
  if (!bg || bg.a === 0) return null; // sin fondo propio -- comportamiento sin cambios

  const fontSizePx = parseFloat(style.fontSize) || 16;
  const isBold = style.fontWeight === '700' || style.fontWeight === 'bold' || parseInt(style.fontWeight, 10) >= 700;
  const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.5 && isBold);
  const minRequiredRatio = isLargeText ? 3.0 : 4.5;

  if (bg.a < 1) {
    return {
      ratio: null,
      minRequiredRatio,
      inconclusive: true,
      reason: `El fondo declarado (${style.backgroundColor}) es parcialmente transparente; el sistema no captura qué hay detrás, por lo que el contraste real no es determinable sin inventar el fondo efectivo.`,
    };
  }

  const ratio = calculateContrastRatio(style.color, style.backgroundColor);
  if (ratio === null) return null; // color de texto no parseable
  return { ratio, minRequiredRatio, inconclusive: false };
}

export class DeterministicAnalyzer {
  private static instance: DeterministicAnalyzer;

  private constructor() {}

  public static getInstance(): DeterministicAnalyzer {
    if (!DeterministicAnalyzer.instance) {
      DeterministicAnalyzer.instance = new DeterministicAnalyzer();
    }
    return DeterministicAnalyzer.instance;
  }

  /**
   * Analyzes snapshot evidence array deterministically against programmatically verifiable WCAG criteria.
   */
  public analyzeSnapshots(evidences: ISnapshotEvidence[]): DeterministicFinding[] {
    const findings: DeterministicFinding[] = [];

    for (const ev of evidences) {
      const iter = ev.iteration;
      const url = ev.url;
      const screenshotUrl = ev.screenshotPath;

      // 1. WCAG 1.4.3 Contraste (Mínimo) Determinístico
      this.analyzeContrast(ev, iter, url, screenshotUrl, findings);

      // 2. WCAG 1.1.1 Contenido no textual (Imágenes) Determinístico
      this.analyzeImages(ev, iter, url, screenshotUrl, findings);

      // 3. WCAG 4.1.2 Nombre, Función y Valor (Botones e Interactivos) Determinístico
      this.analyzeButtons(ev, iter, url, screenshotUrl, findings);

      // 4. WCAG 2.4.4 Propósito de los Enlaces Determinístico
      this.analyzeLinks(ev, iter, url, screenshotUrl, findings);

      // 5. Headings Jerarquía y Estructura Semántica Determinístico
      this.analyzeHeadings(ev, iter, url, screenshotUrl, findings);

      // 6. WCAG 3.3.2 Etiquetas o instrucciones (Fase I.2, Hardening Post-Fase H) Determinístico
      this.analyzeForms(ev, iter, url, screenshotUrl, findings);
    }

    return findings;
  }

  private analyzeContrast(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    for (const style of ev.computedStyles || []) {
      const failure = computeContrastFailure(style);
      if (failure === null) continue; // Skip transparent/undeterminable backgrounds, same as before (comportamiento sin cambios, ver computeContrastFailure)

      if (failure.inconclusive) {
        // P1.1 (real incident) — fondo declarado con transparencia parcial:
        // antes esto nunca se reportaba (el ratio engañoso se calculaba
        // igual que para un fondo opaco). Ahora se deja un registro
        // NOT_EVALUABLE explícito y trazable -- nunca un FAIL ni un ratio
        // inventado -- en vez de desaparecer silenciosamente.
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'NOT_EVALUABLE',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
          description: `No se pudo determinar el contraste del elemento <${style.tag}>: ${failure.reason}`,
          evidence: [
            {
              type: 'COMPUTED_STYLE',
              property: 'contrastRatio',
              value: 'no determinable',
              selector: style.selector,
              context: `color: ${style.color}, backgroundColor: ${style.backgroundColor}, fontSize: ${style.fontSize}`,
              relatedValue: { property: 'backgroundColor', value: style.backgroundColor },
            },
          ],
          affectedElement: { tag: style.tag, text: style.text, selector: style.selector },
          recommendation: null,
          iteration: iter,
          url,
          screenshotUrl,
        });
        continue;
      }

      const { ratio, minRequiredRatio } = failure;

      if (ratio < minRequiredRatio) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'FAIL',
          severity: ratio < 3.0 ? 'high' : 'medium',
          confidence: 'high',
          wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
          description: `El elemento <${style.tag}> presenta un ratio de contraste insuficiente de ${ratio}:1 (mínimo requerido: ${minRequiredRatio}:1).`,
          evidence: [
            {
              type: 'COMPUTED_STYLE',
              property: 'contrastRatio',
              value: `${ratio}:1`,
              measurement: `esperado >= ${minRequiredRatio}:1`,
              selector: style.selector,
              context: `color: ${style.color}, backgroundColor: ${style.backgroundColor}, fontSize: ${style.fontSize}`,
              relatedValue: { property: 'backgroundColor', value: style.backgroundColor },
            },
          ],
          affectedElement: {
            tag: style.tag,
            text: style.text,
            selector: style.selector,
          },
          impact: 'Dificulta seriamente la lectura a personas con baja visión, presbicia o bajo condiciones de luz solar.',
          recommendation: `Ajustar el color del texto (${style.color}) o del fondo (${style.backgroundColor}) para lograr un contraste mínimo de ${minRequiredRatio}:1.`,
          iteration: iter,
          url,
          screenshotUrl,
        });
      } else {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 1.4.3 Contraste (Mínimo)',
          description: `El elemento <${style.tag}> cumple con el ratio de contraste requerido (${ratio}:1).`,
          evidence: [
            {
              type: 'COMPUTED_STYLE',
              property: 'contrastRatio',
              value: `${ratio}:1`,
              selector: style.selector,
            },
          ],
          affectedElement: { tag: style.tag, text: style.text, selector: style.selector },
          recommendation: null,
          iteration: iter,
          url,
          screenshotUrl,
        });
      }
    }
  }

  // `property` (no `attribute`): contrato canónico -- ver finding-matching.ts
  // (canonicalProperty) y audit-metrics.service.ts (mergeEvidence). Gemini y
  // el resto de reglas determinísticas (analyzeForms/analyzeButtons) ya
  // usan `property`; `analyzeImages`/`analyzeLinks` citaban `attribute` --
  // migrado en Hardening post Gemini Real #1 (causaba que estos findings
  // nunca satisficieran `minimumEvidence` del matcher ni el dedup-key de
  // `mergeEvidence`, que solo leían `.property`).
  private analyzeImages(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    for (const img of ev.images || []) {
      if (img.isDecorative) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
          description: `La imagen en ${img.selector} está correctamente marcada como decorativa (alt="" o role="presentation").`,
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: img.alt ?? '', selector: img.selector }],
          affectedElement: { tag: 'img', selector: img.selector },
          recommendation: null,
          iteration: iter,
          url,
          screenshotUrl,
        });
      } else if (img.alt !== null && img.alt.trim().length > 0) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
          description: `La imagen posee un atributo alt descriptivo: "${img.alt}".`,
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: img.alt, selector: img.selector }],
          affectedElement: { tag: 'img', selector: img.selector },
          recommendation: null,
          iteration: iter,
          url,
          screenshotUrl,
        });
      } else if (!img.ariaLabel) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'FAIL',
          severity: 'high',
          confidence: 'high',
          wcagCriterion: 'WCAG 1.1.1 Contenido no textual',
          description: `La imagen informativa en ${img.selector} carece de atributo alt o texto alternativo accesibilidad.`,
          // "null" (no "null/missing"): convención de normalización única
          // del sistema para valores ausentes -- ver
          // evidence-claim-consistency.service.ts (J6), que compara el
          // valor real (JS null/undefined) normalizado a exactamente la
          // string "null" contra lo citado aquí. Una representación
          // distinta (como la anterior "null/missing") hace que J6
          // clasifique esta evidencia, real y correcta, como INCONSISTENT
          // -- descubierto en Fase I.3 (Landing V1), corregido aquí.
          evidence: [{ type: 'DOM_ATTRIBUTE', property: 'alt', value: 'null', selector: img.selector }],
          affectedElement: { tag: 'img', selector: img.selector },
          impact: 'Los usuarios de lectores de pantalla no podrán conocer la información expresada por esta imagen.',
          recommendation: `Agregar un atributo alt descriptivo a la etiqueta <img> que comunique la función o contenido de la imagen.`,
          iteration: iter,
          url,
          screenshotUrl,
        });
      }
    }
  }

  private analyzeButtons(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    for (const btn of ev.buttons || []) {
      const ariaLabel = btn.ariaLabel && btn.ariaLabel.trim().length > 0 ? btn.ariaLabel.trim() : null;
      const text = btn.text && btn.text.trim().length > 0 ? btn.text.trim() : null;

      if (ariaLabel || text) {
        // sourceProperty/sourceValue (mismo mecanismo que analyzeForms,
        // Fase I.2): identifica la propiedad REAL de la que proviene el
        // valor citado, en vez de citar siempre 'aria-label' sin importar
        // el origen real -- descubierto en Fase I.3.1 como una discrepancia
        // de evidencia: cuando el nombre accesible venía de `text`, el
        // finding igual citaba la propiedad 'aria-label' (y además con el
        // guion, que ni siquiera es el nombre real del campo -- la
        // whitelist usa 'ariaLabel'), haciendo que J6 comparara el valor
        // citado contra el campo equivocado (PROPERTY_NOT_FOUND) o, si se
        // corregía solo el nombre sin la fuente, contra `ariaLabel` cuando
        // el valor real citado venía de `text` (falso INCONSISTENT).
        // Prioridad ariaLabel > text: NO es una heurística nueva, es la
        // misma precedencia que el código previo ya aplicaba para elegir
        // el valor (`btn.ariaLabel || btn.text`), consistente con el
        // cómputo real de nombre accesible ARIA (aria-label tiene
        // precedencia sobre el contenido de texto).
        const sourceProperty = ariaLabel ? 'ariaLabel' : 'text';
        const sourceValue = ariaLabel || text!;
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
          description: `El botón <${btn.tag}> posee un nombre accesible demostrable vía "${sourceProperty}": "${sourceValue}".`,
          evidence: [{ type: 'DOM_ATTRIBUTE', property: sourceProperty, value: sourceValue, selector: btn.selector }],
          affectedElement: { tag: btn.tag, text: btn.text || undefined, selector: btn.selector, role: btn.role || 'button' },
          recommendation: null,
          iteration: iter,
          url,
          screenshotUrl,
        });
      } else {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'FAIL',
          severity: 'high',
          confidence: 'high',
          wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
          description: `El elemento interactivo <${btn.tag}> en ${btn.selector} carece de nombre accesible (texto visible o aria-label).`,
          // Ambos mecanismos citados explícitamente como ausentes (igual
          // que analyzeForms con label/ariaLabel/ariaLabelledBy), con
          // "null" (convención única del sistema, Fase I.3.1 discrepancia
          // 3) -- nunca "missing".
          evidence: [
            { type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'null', selector: btn.selector },
            { type: 'DOM_ATTRIBUTE', property: 'text', value: 'null', selector: btn.selector },
          ],
          affectedElement: { tag: btn.tag, selector: btn.selector, role: btn.role || 'button' },
          impact: 'Tecnologías de asistencia anunciarán este botón como "botón sin etiqueta", impidiendo al usuario saber qué acción ejecuta.',
          recommendation: `Agregar texto visible dentro del botón o un atributo aria-label descriptivo para indicar su propósito.`,
          iteration: iter,
          url,
          screenshotUrl,
        });
      }
    }
  }

  // `property` (no `attribute`) -- mismo contrato canónico que analyzeImages, ver comentario arriba.
  private analyzeLinks(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    for (const link of ev.links || []) {
      const fullLinkText = (link.ariaLabel || link.text || '').trim();
      // [Revisión MVP, post-evaluación real `6ad2eddad9fe70084f43d58d`] El
      // dato que realmente decide PASS/FAIL (`link.text`/`link.ariaLabel`)
      // ya se extrae y se usa arriba, pero nunca se adjuntaba como
      // evidencia -- solo se citaba `href`, que no demuestra por sí solo la
      // ausencia/presencia de texto accesible. Aditivo: conserva `href` tal
      // cual, agrega los datos que realmente sustentan la conclusión. No
      // cambia `fullLinkText` ni la clasificación.
      const supportingEvidence: TechnicalEvidenceItem[] = [
        { type: 'DOM_ATTRIBUTE', property: 'href', value: link.href, selector: link.selector },
        { type: 'DOM_ATTRIBUTE', property: 'text', value: link.text || '', selector: link.selector },
        ...(link.ariaLabel
          ? [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: link.ariaLabel, selector: link.selector } as TechnicalEvidenceItem]
          : []),
      ];
      if (fullLinkText.length > 0) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
          description: `El enlace en ${link.selector} tiene un propósito identificable: "${fullLinkText}".`,
          evidence: supportingEvidence,
          affectedElement: { tag: 'a', text: link.text, selector: link.selector, href: link.href },
          recommendation: null,
          iteration: iter,
          url,
          screenshotUrl,
        });
      } else {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'FAIL',
          severity: 'medium',
          confidence: 'high',
          wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
          description: `El enlace en ${link.selector} carece de texto accesible que identifique su destino o propósito.`,
          evidence: supportingEvidence,
          affectedElement: { tag: 'a', selector: link.selector, href: link.href },
          impact: 'Usuarios de lectores de pantalla no sabrán a dónde dirige la navegación al enfocar este enlace.',
          recommendation: `Reformular el texto del enlace o agregar un aria-label descriptivo para indicar claramente su destino.`,
          iteration: iter,
          url,
          screenshotUrl,
        });
      }
    }
  }

  private analyzeHeadings(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    const headings = ev.headings || [];
    if (headings.length === 0) return;

    const h1s = headings.filter((h) => h.level === 1);
    if (h1s.length === 0) {
      findings.push({
        findingGroup: 'ux',
        type: 'usability',
        status: 'FAIL',
        severity: 'medium',
        confidence: 'high',
        heuristicCode: 'N-04',
        heuristicName: 'Consistencia y estándares',
        wcagCriterion: 'WCAG 1.3.1 Información y relaciones',
        description: `La página evaluada carece de un encabezado principal de primer nivel (<h1>).`,
        evidence: [{ type: 'HEADING_STRUCTURE', value: 'h1_count: 0', selector: 'body' }],
        impact: 'Los usuarios de tecnologías de asistencia no cuentan con un punto de inicio claro para la jerarquía del documento.',
        recommendation: `Incluir un único encabezado <h1> en la página que resuma el título o propósito principal.`,
        iteration: iter,
        url,
        screenshotUrl,
      });
    }
  }

  /**
   * Fase I.2 (Hardening Post-Fase H) — WCAG 3.3.2 Etiquetas o instrucciones,
   * determinístico, sobre `ev.forms[].elements[]` (FormElementEvidence).
   *
   * CRITERIO WCAG: 3.3.2, no 4.1.2 -- consistente con cómo el resto del
   * proyecto ya modela este problema (fixture `forms/login-missing-label.
   * groundtruth.json`, y las 4 ejecuciones reales H-REGRESSION-1..4, donde
   * Gemini asignó consistentemente 3.3.2 a este tipo de hallazgo). WCAG
   * 4.1.2 permanece exclusivamente responsabilidad de `analyzeButtons`.
   *
   * EXCLUSIÓN DELIBERADA de controles tipo botón (button/submit/reset/
   * image) y de `hidden`: `form.querySelectorAll('input, select, textarea,
   * button')` en automation.service.ts SÍ incluye `<button>` dentro de
   * `ev.forms[].elements[]` -- sin esta exclusión, un mismo botón real
   * produciría un finding aquí (3.3.2) Y otro en `analyzeButtons` (4.1.2)
   * para el mismo elemento, violando "no duplicar findings ya generados
   * por otra regla". `hidden` se excluye porque un campo no perceptible no
   * tiene un requisito de etiqueta visible aplicable.
   *
   * PASS: `label` o `ariaLabel` no vacíos -- ambos son TEXTO YA RESUELTO
   * por el extractor (label: texto real de `<label for>`/envolvente,
   * verificado en automation.service.ts líneas 416-423; ariaLabel: el
   * propio valor del atributo, que ES el texto) -- demostrable sin
   * ambigüedad.
   *
   * NOT_EVALUABLE: `ariaLabelledBy` presente pero ni `label` ni `ariaLabel`
   * -- LIMITACIÓN REAL Y CONFIRMADA DEL EXTRACTOR (automation.service.ts
   * línea 431): `ariaLabelledBy` captura únicamente
   * `el.getAttribute('aria-labelledby')`, el STRING DE REFERENCIA (id), sin
   * resolver el texto del elemento referenciado. La evidencia demuestra que
   * existe una referencia, pero NO demuestra que produzca un nombre
   * accesible real (el id podría no existir, o apuntar a un elemento
   * vacío) -- degradar esto a FAIL sería exactamente el error que esta
   * fase pidió evitar ("no convertir ausencia de evidencia en FAIL
   * automáticamente"); degradarlo a PASS sería inventar una demostración
   * que la evidencia no sostiene. NOT_EVALUABLE es la única clasificación
   * honesta aquí.
   *
   * FAIL: ninguna de las tres fuentes (label/ariaLabel/ariaLabelledBy)
   * está presente -- ausencia total y demostrable de nombre accesible.
   */
  private analyzeForms(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    const BUTTON_LIKE_TYPES = new Set(['button', 'submit', 'reset', 'image', 'hidden']);

    for (const form of ev.forms || []) {
      for (const el of form.elements || []) {
        if (BUTTON_LIKE_TYPES.has((el.type || '').toLowerCase())) continue;
        const tag = inferFormControlTag(el.type);

        const label = el.label && el.label.trim().length > 0 ? el.label.trim() : null;
        const ariaLabel = el.ariaLabel && el.ariaLabel.trim().length > 0 ? el.ariaLabel.trim() : null;
        const ariaLabelledBy = el.ariaLabelledBy && el.ariaLabelledBy.trim().length > 0 ? el.ariaLabelledBy.trim() : null;

        if (label || ariaLabel) {
          const sourceProperty = label ? 'label' : 'ariaLabel';
          const sourceValue = label || ariaLabel!;
          findings.push({
            findingGroup: 'accessibility',
            type: 'wcag',
            status: 'PASS',
            severity: 'info',
            confidence: 'high',
            wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones',
            description: `El control <${tag}> en ${el.selector} posee un nombre accesible demostrable vía "${sourceProperty}": "${sourceValue}".`,
            evidence: [{ type: 'DOM_ATTRIBUTE', property: sourceProperty, value: sourceValue, selector: el.selector } as any],
            affectedElement: { tag, selector: el.selector },
            recommendation: null,
            iteration: iter,
            url,
            screenshotUrl,
          });
        } else if (ariaLabelledBy) {
          findings.push({
            findingGroup: 'accessibility',
            type: 'wcag',
            status: 'NOT_EVALUABLE',
            severity: 'medium',
            confidence: 'low',
            wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones',
            description: `El control <${tag}> en ${el.selector} declara aria-labelledby="${ariaLabelledBy}", pero el extractor actual no resuelve el texto del elemento referenciado -- no puede demostrarse si esto produce un nombre accesible real.`,
            evidence: [{ type: 'DOM_ATTRIBUTE', property: 'ariaLabelledBy', value: ariaLabelledBy, selector: el.selector } as any],
            affectedElement: { tag, selector: el.selector },
            recommendation: null,
            iteration: iter,
            url,
            screenshotUrl,
          });
        } else {
          findings.push({
            findingGroup: 'accessibility',
            type: 'wcag',
            status: 'FAIL',
            severity: 'high',
            confidence: 'high',
            wcagCriterion: 'WCAG 3.3.2 Etiquetas o instrucciones',
            description: `El control <${tag}> en ${el.selector} carece de nombre/etiqueta accesible: sin <label> asociado, sin aria-label y sin aria-labelledby.`,
            evidence: [
              { type: 'DOM_ATTRIBUTE', property: 'label', value: 'null', selector: el.selector } as any,
              { type: 'DOM_ATTRIBUTE', property: 'ariaLabel', value: 'null', selector: el.selector } as any,
              { type: 'DOM_ATTRIBUTE', property: 'ariaLabelledBy', value: 'null', selector: el.selector } as any,
            ],
            affectedElement: { tag, selector: el.selector },
            impact: 'Los usuarios de lectores de pantalla no podrán identificar el propósito de este campo de formulario; depender solo de placeholder no es suficiente (desaparece al escribir y no todos los lectores de pantalla lo anuncian).',
            recommendation: `Asociar un <label for="${el.name || 'ID del control'}"> con el control, o agregar un atributo aria-label descriptivo.`,
            iteration: iter,
            url,
            screenshotUrl,
          });
        }
      }
    }
  }
}

export const deterministicAnalyzer = DeterministicAnalyzer.getInstance();
