import { ISnapshotEvidence } from '@/modules/snapshots/snapshot-evidence.model';
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
 * Parses CSS color string e.g. "rgb(17, 24, 39)" or "rgba(255, 255, 255, 1)" into {r,g,b}.
 */
export function parseCssColor(colorStr: string): { r: number; g: number; b: number } | null {
  if (!colorStr) return null;
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
  };
}

/**
 * Calculates Contrast Ratio: (L1 + 0.05) / (L2 + 0.05)
 */
export function calculateContrastRatio(fgColorStr: string, bgColorStr: string): number | null {
  const fg = parseCssColor(fgColorStr);
  const bg = parseCssColor(bgColorStr);
  if (!fg || !bg) return null;

  const l1 = getSRGBColorLuminance(fg.r, fg.g, fg.b);
  const l2 = getSRGBColorLuminance(bg.r, bg.g, bg.b);

  const maxL = Math.max(l1, l2);
  const minL = Math.min(l1, l2);

  return parseFloat(((maxL + 0.05) / (minL + 0.05)).toFixed(2));
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
      if (!style.color || !style.backgroundColor || style.backgroundColor === 'rgba(0, 0, 0, 0)') {
        continue; // Skip transparent backgrounds where contrast cannot be determined programmatically
      }

      const ratio = calculateContrastRatio(style.color, style.backgroundColor);
      if (ratio === null) continue;

      const fontSizePx = parseFloat(style.fontSize) || 16;
      const isBold = style.fontWeight === '700' || style.fontWeight === 'bold' || parseInt(style.fontWeight, 10) >= 700;
      const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.5 && isBold);
      const minRequiredRatio = isLargeText ? 3.0 : 4.5;

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
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: img.alt ?? '', selector: img.selector }],
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
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: img.alt, selector: img.selector }],
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
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'alt', value: 'null/missing', selector: img.selector }],
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
      const hasText = btn.text !== null && btn.text.trim().length > 0;
      const hasAriaLabel = btn.ariaLabel !== null && btn.ariaLabel.trim().length > 0;

      if (hasText || hasAriaLabel) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 4.1.2 Nombre, función y valor',
          description: `El botón <${btn.tag}> posee un nombre accesible descriptivo: "${btn.ariaLabel || btn.text}".`,
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'aria-label', value: btn.ariaLabel || btn.text || '', selector: btn.selector }],
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
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'aria-label', value: 'missing', selector: btn.selector }],
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

  private analyzeLinks(
    ev: ISnapshotEvidence,
    iter: number,
    url: string,
    screenshotUrl: string,
    findings: DeterministicFinding[],
  ) {
    for (const link of ev.links || []) {
      const fullLinkText = (link.ariaLabel || link.text || '').trim();
      if (fullLinkText.length > 0) {
        findings.push({
          findingGroup: 'accessibility',
          type: 'wcag',
          status: 'PASS',
          severity: 'info',
          confidence: 'high',
          wcagCriterion: 'WCAG 2.4.4 Propósito de los enlaces',
          description: `El enlace en ${link.selector} tiene un propósito identificable: "${fullLinkText}".`,
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'href', value: link.href, selector: link.selector }],
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
          evidence: [{ type: 'DOM_ATTRIBUTE', attribute: 'href', value: link.href, selector: link.selector }],
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
}

export const deterministicAnalyzer = DeterministicAnalyzer.getInstance();
