import { SyntheticLink, SyntheticButton } from './synthetic-mongoose-evidence';

/**
 * Fase F — parametric stress generators (testing-only module).
 *
 * Every function here is a GENERATOR, not a static fixture: it takes a
 * volume/shape parameter (n, depth, chars) and produces HTML or synthetic
 * evidence deterministically from it. This is what makes each Fase F
 * scenario a real curve (measured at several parameter values) instead of
 * one arbitrarily-sized blob — see the Fase F plan, section 1 ("cómo se
 * evita el HTML gigante sin valor diagnóstico").
 */

// ---------------------------------------------------------------------------
// F1 / F6 — catalog of N structurally-similar but DISTINCT links (the
// realistic "large product listing" case: same markup pattern, unique
// identity per item). Extends T3's 100-card scenario to stress volume.
// ---------------------------------------------------------------------------
export function buildCatalogLinks(n: number, opts?: { textChars?: number }): SyntheticLink[] {
  const textChars = opts?.textChars ?? 0;
  const padding = textChars > 0 ? ' ' + 'x'.repeat(Math.max(0, textChars - 20)) : '';
  const links: SyntheticLink[] = [];
  for (let i = 0; i < n; i++) {
    links.push({
      selector: `article:nth-of-type(${i + 1}) > a`,
      text: `Producto ${i}${padding}`,
      href: `/productos/${i}`,
      ariaLabel: null,
      role: null,
      isExternal: false,
    });
  }
  return links;
}

export function buildCatalogButtons(n: number): SyntheticButton[] {
  const buttons: SyntheticButton[] = [];
  for (let i = 0; i < n; i++) {
    buttons.push({
      selector: `article:nth-of-type(${i + 1}) > button`,
      tag: 'button',
      text: 'Añadir al carrito',
      ariaLabel: null,
      role: null,
      isDisabled: false,
      isPrimary: false,
    });
  }
  return buttons;
}

// ---------------------------------------------------------------------------
// F2 — a single oversized field (heading / link / button text), real HTML.
// ---------------------------------------------------------------------------
export function buildOversizedFieldHtml(kind: 'heading' | 'link' | 'button', chars: number): string {
  const filler = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(Math.ceil(chars / 57)).slice(0, chars);
  const heading = kind === 'heading' ? filler : 'Título normal';
  const linkText = kind === 'link' ? filler : 'Enlace normal';
  const buttonText = kind === 'button' ? filler : 'Botón normal';
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body>
  <h1>${heading}</h1>
  <a href="/destino">${linkText}</a>
  <button type="button">${buttonText}</button>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// F3 — N paragraphs (candidates for computedStyles capture, capped at 50 in
// production — see automation.service.ts `.slice(0, 50)`) plus ONE real CTA
// button, whose DOM position is configurable to probe whether it falls
// inside or outside the first-50-in-DOM-order cap.
// ---------------------------------------------------------------------------
export function buildStyledElementsHtml(n: number, ctaPosition: 'within-cap' | 'beyond-cap'): string {
  const ctaIndex = ctaPosition === 'within-cap' ? 10 : n + 10; // cap is 50; 10 < 50, n+10 > 50 for any n >= 41
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i === ctaIndex) {
      parts.push(`<button type="button" aria-label="Comprar ahora" data-t="cta">Comprar ahora</button>`);
    }
    parts.push(`<p>Párrafo de relleno número ${i} con contenido de texto variable.</p>`);
  }
  if (ctaIndex >= n) {
    parts.push(`<button type="button" aria-label="Comprar ahora" data-t="cta">Comprar ahora</button>`);
  }
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body>
  <h1>Página con muchos párrafos</h1>
  ${parts.join('\n  ')}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// F4 — deeply nested, single-child wrapper chains ending in a leaf <a>,
// replicated across `branches` top-level siblings (parametrized version of
// the existing stress/deeply-nested-noisy-dom.html pattern, which fixed
// depth=5/branches=8).
// ---------------------------------------------------------------------------
export function buildDeepChainHtml(depth: number, branches: number): string {
  const branchesHtml = Array.from({ length: branches })
    .map((_, i) => {
      let inner = `<a href="/deep/branch-${i}" data-t="leaf-${i}">Enlace profundo ${i}</a>`;
      for (let d = 0; d < depth; d++) {
        inner = `<div>${inner}</div>`;
      }
      return `<div class="branch">${inner}</div>`;
    })
    .join('\n  ');
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body>
  <h1>Deep Chain Stress</h1>
  ${branchesHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// F5 — evolving-session iteration builder, two modes:
//  - 'realistic': a fixed set of repeated landmark links (nav/footer, stay
//    IDENTICAL every iteration -> dedup collapses them) plus a SMALL number
//    of genuinely new links per iteration (models real exploration
//    progress, e.g. newly-discovered page links).
//  - 'no-dedup-benefit': EVERY link is unique to its iteration (worst case
//    for the dedup mechanism -- nothing to collapse), to see how close the
//    real measured payload gets to the analytical worst-case model.
// ---------------------------------------------------------------------------
export function buildEvolvingIterationLinks(
  iteration: number,
  mode: 'realistic' | 'no-dedup-benefit',
  opts: { fixedCount: number; novelPerIteration: number },
): SyntheticLink[] {
  const links: SyntheticLink[] = [];
  if (mode === 'realistic') {
    for (let i = 0; i < opts.fixedCount; i++) {
      links.push({ selector: `nav a:nth-of-type(${i})`, text: `Nav ${i}`, href: `/nav-${i}`, ariaLabel: null, role: null, isExternal: false });
    }
    for (let i = 0; i < opts.novelPerIteration; i++) {
      links.push({
        selector: `main a:nth-of-type(${i})`,
        text: `Descubierto en paso ${iteration} #${i}`,
        href: `/explorado/${iteration}/${i}`,
        ariaLabel: null,
        role: null,
        isExternal: false,
      });
    }
  } else {
    // no-dedup-benefit: fixedCount + novelPerIteration, but ALL unique to this iteration.
    const total = opts.fixedCount + opts.novelPerIteration;
    for (let i = 0; i < total; i++) {
      links.push({
        selector: `main a:nth-of-type(${i})`,
        text: `Iteración ${iteration} enlace ${i}`,
        href: `/iter-${iteration}/enlace-${i}`,
        ariaLabel: null,
        role: null,
        isExternal: false,
      });
    }
  }
  return links;
}

/**
 * Formula-based prediction (not a fixed guess): measures ONE representative
 * serialized sample and extrapolates linearly. Used by every F-test to state
 * an expected value BEFORE running, per the Fase F anti-"HTML gigante"
 * principle.
 */
export function predictLinearChars(sampleSerializedChars: number, n: number, fixedOverheadChars = 0): number {
  return sampleSerializedChars * n + fixedOverheadChars;
}
