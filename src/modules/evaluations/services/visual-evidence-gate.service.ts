import { PrototypeAuditFinding, VISUAL_PROPERTY_WHITELIST } from '@/modules/ai/contracts/prototype.contracts';
import { STRONG_SPECULATIVE_KEYWORDS, WEAK_SPECULATIVE_KEYWORDS } from './evidence-gate.service';
import { normalizeCriterionKey } from '@/shared/testing/ground-truth-oracle';

/**
 * Gate Rule V5 (P1.6.6.7, diseñada en P1.6.6.4/P1.6.6.5/P1.6.6.6) — para
 * estos 4 criterios WCAG, NINGUNA evidencia visual posible (por buena y
 * estructurada que esté) puede demostrar el criterio completo, en NINGUNA
 * dirección (ni PASS ni FAIL):
 *   - WCAG 1.3.1: la jerarquía VISUAL nunca demuestra la estructura
 *     semántica programática real del documento (h1-h6, landmarks).
 *   - WCAG 1.4.3: el contrato (`NUMERIC_CONTRAST_RATIO_PATTERN` en
 *     `prototype.contracts.ts`) prohíbe explícitamente cualquier medición
 *     numérica para prototipos -- el 100% de la evidencia posible de
 *     `visualContrast` es, por construcción, cualitativa (`appears-low`/
 *     `appears-sufficient`), nunca una verificación de los umbrales WCAG.
 *   - WCAG 1.1.1: la ausencia de texto visible junto a un elemento no
 *     textual nunca demuestra la ausencia de un nombre accesible
 *     programático (alt/aria-label) -- ya reconocido textualmente en
 *     VISUAL EVIDENCE RULES punto 8 del prompt, pero sin enforcement
 *     determinista hasta ahora.
 *   - WCAG 3.3.2: la proximidad (o ausencia de proximidad) VISUAL de una
 *     etiqueta a un campo nunca demuestra su asociación programática real
 *     (`<label for>`, `aria-labelledby`) -- puede existir una etiqueta
 *     visualmente oculta con asociación programática perfecta.
 *
 * P1.6.6.4 confirmó que Gate V4 (arriba) NO resuelve este problema: V4 solo
 * exige evidencia ESTRUCTURADA para un PASS, pero toda la evidencia posible
 * para estos 4 criterios es inherentemente visual (la whitelist de
 * `property` en `prototype.contracts.ts` no contiene ninguna propiedad del
 * DOM) -- tener evidencia bien estructurada NUNCA distingue, para estos 4
 * criterios, "esto demuestra el criterio completo" de "esto es solo una
 * observación visual". P1.6.6.6 confirmó además que el mismo problema
 * aplica igual de grave a FAIL que a PASS (una observación visual
 * desfavorable tampoco demuestra el incumplimiento real), algo que ninguna
 * regla anterior (V0-V4) protegía.
 *
 * Deliberadamente actúa por IDENTIDAD del criterio (`wcagCriterion`
 * normalizado), nunca por `property`/estructura de la evidencia -- a
 * diferencia de V4, esta regla degrada aunque la evidencia tenga
 * `property`+`value`+`elementDescription` perfectamente estructurados
 * (P1.6.6.7 condición 3), porque el problema nunca fue de estructura.
 *
 * Alcance EXACTO y cerrado -- nunca se generaliza a los demás criterios
 * `PARTIALLY_EVALUABLE` del resolver (p. ej. WCAG 2.4.4 queda
 * deliberadamente FUERA: P1.6.6.6 confirmó que SÍ tiene un sub-caso
 * genuinamente demostrable en una sola imagen -- texto del enlace +
 * contexto visible circundante -- y degradarlo categóricamente sería
 * incorrecto, no solo innecesario).
 */
const NON_DEMONSTRABLE_FROM_IMAGE_WCAG_CRITERIA = new Set(
  ['WCAG 1.3.1', 'WCAG 1.4.3', 'WCAG 1.1.1', 'WCAG 3.3.2'].map((code) => normalizeCriterionKey(code)),
);

/**
 * Gate Rule V1 (P1.6.4, corregida en P1.6.4.2) — frases que, en una
 * `description` de FAIL, indican que la conclusión depende de un ESTADO que
 * solo se manifestaría DESPUÉS de una interacción (escribir, enviar,
 * invalidar un campo) que una imagen estática sin interactuar nunca
 * muestra -- nunca de un elemento visual ESTÁTICO (texto, etiqueta,
 * contraste, color, layout), que SÍ sigue siendo evaluable normalmente y no
 * activa esta regla. Deliberadamente PROTOTYPE-only (nunca importado por
 * `evidence-gate.service.ts`/WEB): el flujo WEB sí tiene evidencia real de
 * interacción (snapshots posteriores a cada acción ejecutada por
 * Playwright), así que esta ambigüedad específica de "una sola imagen nunca
 * interactuada" no se presenta ahí.
 *
 * P1.6.4.2 — auditoría adversarial (P1.6.4.1) confirmó dos defectos
 * reproducibles en la v1 de esta regla, ambos corregidos aquí:
 *   - 'validación automática' y 'retroalimentación al usuario' se agregan
 *     tras confirmar, con un fixture real, que la v1 no detectaba estas dos
 *     variantes (falso negativo demostrado, Casos C/D de P1.6.4.1) --
 *     expansión ACOTADA y justificada por un caso reproducible, no
 *     especulativa. Nunca se agregó la palabra suelta "error"/"validación"
 *     (probado que sería demasiado amplia -- ver Caso J abajo).
 *   - La condición de activación ahora EXIGE, además de la frase, que
 *     ningún ítem de evidencia tenga un `property`+`value` estructurado
 *     (whitelist) independiente -- un FAIL con evidencia visual real y
 *     concreta (p. ej. `colorCoding`) nunca se degrada solo porque su
 *     descripción incluya, como aclaración honesta, una duda sobre una
 *     capacidad dinámica (falso positivo demostrado, Caso A de P1.6.4.1).
 *     Limitación aceptada y documentada (no resoluble sin análisis
 *     semántico): esta heurística no verifica que la evidencia estructurada
 *     presente realmente sustente la parte NO dinámica de la descripción --
 *     una respuesta adversarial que "rellene" evidencia estructurada no
 *     relacionada junto a una afirmación dinámica ilegítima podría evadir
 *     la degradación. No se resuelve aquí porque hacerlo requeriría
 *     analizar la relación semántica entre texto y evidencia, fuera del
 *     alcance de una regla determinista de este tipo.
 */
export const DYNAMIC_BEHAVIOR_ABSENCE_PHRASES = [
  'validación en tiempo real',
  'validación dinámica',
  'validación automática',
  'retroalimentación en tiempo real',
  'retroalimentación inmediata',
  'retroalimentación dinámica',
  'retroalimentación al usuario',
  'confirmación de envío',
  'confirmación después del envío',
  'confirmación posterior al envío',
  'confirmación tras el envío',
  'estados de error',
  'manejo de errores',
  'mensajes de error',
  'indicadores de error',
  'indicadores de validación',
];

/**
 * P1.6.4.2 — prefijo determinista aplicado a la `description` de un
 * hallazgo degradado por la Gate Rule V1, para que el texto persistido deje
 * de afirmar como hecho una ausencia funcional nunca demostrada (Regla E).
 * Nunca elimina ni reescribe el texto original de Gemini -- solo lo
 * antecede con una aclaración explícita, consistente con "no elimines
 * evidencia válida ni inventes observaciones".
 */
export const DYNAMIC_BEHAVIOR_NOT_EVALUABLE_PREFIX =
  'No fue posible verificar con la imagen disponible (requiere interacción real, no observable en una captura estática): ';

/**
 * VisualEvidenceGateService (P3, sección 9) — análogo de
 * `EvidenceGateService`/J1 para evidencia visual de prototipos. NO
 * reutiliza `processAiFindings` (los datos no comparten shape: no hay
 * selector CSS en una imagen) -- en su lugar implementa **Gate Rule V0**
 * (K.2/K.2.1/K.2.1.1, nunca modificada): degrada a NOT_EVALUABLE cuando
 * ningún ítem de evidencia tiene `elementDescription`/`context`, o cuando
 * el `region` declarado en `affectedElement.visualReference` contradice a
 * TODOS los ítems de evidencia que sí declaran región (caso de evidencia
 * "ajena"/foránea) -- ausencia de región en cualquiera de los dos lados es
 * simplemente no-verificable, nunca un fallo.
 *
 * Gate Rule 1 (lenguaje especulativo), 1b (PASS sin evidencia), 1c
 * (confidence normalizado en NOT_EVALUABLE) y 2 (limpieza de recomendación)
 * se REUTILIZAN verbatim (mismas listas de keywords importadas, mismo
 * criterio) -- sección 30: "100% reutilizadas" por decisión ya aprobada.
 */
export class VisualEvidenceGateService {
  private static instance: VisualEvidenceGateService;

  private constructor() {}

  public static getInstance(): VisualEvidenceGateService {
    if (!VisualEvidenceGateService.instance) {
      VisualEvidenceGateService.instance = new VisualEvidenceGateService();
    }
    return VisualEvidenceGateService.instance;
  }

  public processPrototypeFindings(rawFindings: PrototypeAuditFinding[]): PrototypeAuditFinding[] {
    let noIdentityCount = 0;
    let foreignEvidenceCount = 0;
    let dynamicBehaviorClaimCount = 0;

    const validated = rawFindings.map((finding) => {
      let status = finding.status || 'FAIL';
      let confidence = finding.confidence || 'high';
      let severity = finding.severity;
      const evidence = finding.evidence || [];

      // Gate Rule V0, parte 1 (sección 9, puntos 1-2 y 6-7): ningún ítem
      // tiene elementDescription/context -- no hay identidad mínima sobre
      // la que razonar. Solo aplica cuando hay evidencia citada Y
      // affectedElement/criterio ya exige algo verificable (status FAIL/PASS).
      if (evidence.length > 0) {
        const anyHasIdentity = evidence.some((item) => !!item.elementDescription || !!item.context);
        if (!anyHasIdentity) {
          noIdentityCount++;
          status = 'NOT_EVALUABLE';
          confidence = 'low';
        }

        // Gate Rule V0, parte 2 (coherencia evidencia-elemento, análogo a la
        // Gate Rule 0b de WEB): si el finding declara una región propia Y
        // AL MENOS un ítem de evidencia también declara región, pero NINGÚN
        // ítem coincide con la región propia -- evidencia 100% "ajena".
        // Ausencia de región en cualquiera de los dos lados nunca penaliza
        // (no-verificable, no es lo mismo que contradictorio).
        //
        // [P7.5.2] Revisión de la excepción de P7.4.3: ese fix introducía un
        // umbral numérico ("≥2 ítems con ≥2 regiones distintas") que, aunque
        // resolvía el caso real observado, no estaba justificado por el
        // contrato ni por el funcionamiento del sistema -- exigir una
        // CANTIDAD no demuestra PERTINENCIA (2 citas igualmente ajenas
        // habrían superado el umbral igual que 2 citas genuinas), y
        // rechazaba sin justificación casos legítimos de un solo dato o de
        // dos datos en la misma región.
        //
        // El contrato YA distingue, sin necesidad de ampliarlo, entre el
        // ALCANCE declarado del finding (`affectedElement.visualReference.
        // region`) y la UBICACIÓN de cada ítem de evidencia (`evidence[].
        // region`) -- ambos usan el mismo enum (VisualRegionSchema,
        // VISUAL_REGIONS), así que un ítem de evidencia SÍ puede declarar
        // literalmente 'full-screen' cuando la observación en sí es de
        // alcance agregado (caso real observado: un ítem con
        // `context:"la interfaz no muestra botones... en ninguna parte de
        // la pantalla visible"` y `region:'full-screen'`, dato histórico de
        // P7.1). Eso no cambia la conclusión: ya sea que un ítem cite una
        // región puntual o 'full-screen', su región está, por construcción,
        // CONTENIDA en 'full-screen' (que es la unión de las 9 regiones
        // puntuales) -- nunca puede haber evidencia "ajena" a un alcance que
        // las abarca todas. La coincidencia literal (pensada para alcance
        // PUNTUAL, donde solo una región satisface la contención) simplemente
        // no es la pregunta correcta cuando el alcance ya es agregado.
        //
        // Esto NO abre la puerta a "aceptar cualquier evidencia": la
        // defensa contra evidencia insuficiente o sin sustento sigue siendo
        // la parte 1 de esta misma regla (identidad obligatoria -- sin
        // elementDescription/context no hay nada verificable, full-screen o
        // no) más las demás protecciones ya existentes (whitelist,
        // consistencia, cardinalidad). Lo único que cambia es que la
        // revisión de REGIÓN deja de aplicar un criterio (coincidencia
        // literal) que nunca tuvo un modo de fallo significativo para un
        // alcance agregado. Ninguna región puntual cambia de comportamiento:
        // la coincidencia literal exacta sigue siendo la única regla para
        // cualquier valor de `ownRegion` distinto de 'full-screen'.
        const ownRegion = finding.affectedElement?.visualReference?.region;
        const itemsWithRegion = evidence.filter((item) => !!item.region);
        if (ownRegion && itemsWithRegion.length > 0) {
          const anyAgrees =
            ownRegion === 'full-screen' ? true : itemsWithRegion.some((item) => item.region === ownRegion);
          if (!anyAgrees) {
            foreignEvidenceCount++;
            status = 'NOT_EVALUABLE';
            confidence = 'low';
          }
        }
      }

      const descLower = (finding.description || '').toLowerCase();

      // Gate Rule V1 (P1.6.4) — comportamiento dinámico/interactivo no
      // verificable desde una única imagen estática sin interactuar.
      // Hallazgo real confirmado en auditoría post-piloto (N-05, evaluación
      // `6ae548f689d540e053c65d34`): Gemini concluyó "el formulario carece
      // de validación en tiempo real" únicamente porque no se observaban
      // mensajes de error/advertencia en la captura -- una ausencia de
      // ESTADO (que nunca se mostraría en un frame sin interactuar,
      // exista o no la funcionalidad) confundida con ausencia de
      // FUNCIONALIDAD. Deliberadamente NO atado a ningún heuristicCode/
      // wcagCriterion (podría ocurrir bajo cualquiera) -- actúa solo sobre
      // el texto de `description`, mismo mecanismo que la Gate Rule 1 de
      // lenguaje especulativo (lista de frases, nunca un parser semántico).
      // Nunca degrada una observación legítimamente estática (contraste,
      // ausencia de etiquetas, jerarquía visual, control visualmente
      // ausente) -- las frases listadas describen específicamente un
      // ESTADO que solo se manifiesta tras una interacción que esta imagen,
      // por construcción, nunca muestra.
      // P1.6.4.2 (Regla A, Caso A de la auditoría adversarial P1.6.4.1): un
      // FAIL con AL MENOS un ítem de evidencia con `property`+`value`
      // estructurado (whitelist) real está anclado a una observación visual
      // concreta e independiente -- una frase de la lista aparecida como
      // aclaración honesta de incertidumbre (p. ej. "...pero no se puede
      // determinar si también dispone de validación en tiempo real") NUNCA
      // debe degradar ese hallazgo completo. Sin evidencia estructurada
      // (el caso real de N-05: solo `context`, nunca `property`/`value`),
      // la frase sí degrada, igual que antes.
      const hasIndependentStructuredVisualEvidence = evidence.some(
        (item) => !!item.property && item.value !== undefined,
      );
      const hasDynamicBehaviorAbsenceClaim = DYNAMIC_BEHAVIOR_ABSENCE_PHRASES.some((phrase) => descLower.includes(phrase));
      let degradedByDynamicBehaviorRule = false;
      if (status === 'FAIL' && hasDynamicBehaviorAbsenceClaim && !hasIndependentStructuredVisualEvidence) {
        dynamicBehaviorClaimCount++;
        status = 'NOT_EVALUABLE';
        confidence = 'low';
        degradedByDynamicBehaviorRule = true;
      }

      // Gate Rule 1 (reutilizada verbatim) — lenguaje especulativo.
      const hasStrongSpeculativeLanguage = STRONG_SPECULATIVE_KEYWORDS.some((kw) => descLower.includes(kw));
      const hasWeakSpeculativeLanguage = WEAK_SPECULATIVE_KEYWORDS.some((kw) => descLower.includes(kw));
      const hasRealEvidence = evidence.length > 0;
      const isSpeculative = hasStrongSpeculativeLanguage || (hasWeakSpeculativeLanguage && (!hasRealEvidence || confidence === 'low'));

      if (status === 'FAIL' && (isSpeculative || confidence === 'low' || evidence.length === 0)) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // Gate Rule V2 (P1.6.5.1) — una impresión visual CUALITATIVA de
      // contraste (`property: 'visualContrast'`, `value: 'appears-low'`)
      // nunca justifica `confidence: 'high'` por sí sola: no hay ninguna
      // medición de luminancia real detrás, solo una apreciación visual de
      // Gemini (confirmado en la auditoría P1.6.5: 10/10 hallazgos reales de
      // este tipo llevaban `confidence: 'high'`, sin ninguna excepción).
      // Basada EXCLUSIVAMENTE en evidencia estructurada de ESTE hallazgo
      // (nunca en texto de `description`, a diferencia de la Gate Rule V1) --
      // nunca se activa por la sola palabra "contraste" en el texto, ni por
      // cualquier otro valor de `visualContrast` (p. ej. "appears-sufficient"
      // queda intacto). Nunca toca `status`/`severity`/`description`/
      // `recommendation`/`evidence` -- solo seleccionar el techo de
      // `confidence`, igual que todas las demás reglas de esta función.
      // Colocada DESPUÉS de la Gate Rule 1 (para no elevar una confidence que
      // esa regla ya bajó a 'low' por lenguaje especulativo) y ANTES de la
      // Gate Rule 1c (que, si el hallazgo termina NOT_EVALUABLE por
      // cualquier otra razón, tiene la última palabra y vuelve a bajar a
      // 'low' sin que este techo de 'medium' pueda interferir).
      const hasQualitativeLowContrastEvidence = evidence.some(
        (item) => item.property === 'visualContrast' && item.value === 'appears-low',
      );
      if (hasQualitativeLowContrastEvidence && confidence === 'high') {
        confidence = 'medium';
      }

      // Gate Rule 1b (reutilizada) — PASS sin evidencia.
      if (status === 'PASS' && evidence.length === 0) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // Gate Rule V4 (P1.6.6.3) — enforcement determinístico de la POSITIVE
      // COMPLIANCE RULE del prompt: un PASS solo es aceptable cuando AL
      // MENOS un ítem de evidencia aporta, en el MISMO objeto, `property` Y
      // `value` (evidencia estructurada) -- nunca basta con que el PASS
      // tenga evidencia no vacía (eso ya lo cubre la Gate Rule 1b de arriba)
      // ni con que `property` y `value` aparezcan repartidos en ítems
      // distintos. Auditoría P1.6.6.2: ni Zod (`PrototypeAuditFindingSchema`
      // solo exige evidencia+recomendación para FAIL, nunca para PASS) ni
      // Gate Rule 1b (solo verifica `evidence.length>0`) ni
      // `visual-evidence-consistency.service.ts` (trata evidencia 100%
      // `context`-only como vacuamente CONSISTENT) detectan un PASS
      // respaldado únicamente por una frase narrativa -- esta regla cierra
      // exactamente ese hueco. Reutiliza `hasIndependentStructuredVisualEvidence`
      // (ya calculada arriba para la Gate Rule V1, mismo predicado exacto:
      // `property` y `value` en el mismo ítem) en vez de recalcularla.
      // Nunca toca FAIL ni NOT_EVALUABLE, y nunca exige que TODOS los ítems
      // de evidencia sean estructurados -- con uno solo basta.
      if (status === 'PASS' && !hasIndependentStructuredVisualEvidence) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // Gate Rule V5 (P1.6.6.7) — ver docstring de
      // `NON_DEMONSTRABLE_FROM_IMAGE_WCAG_CRITERIA` arriba. Colocada
      // DESPUÉS de V4 (que ya resolvió el caso "PASS sin estructura") y
      // ANTES de la Gate Rule 1c/V3 (que normalizan confidence/severity
      // para CUALQUIER NOT_EVALUABLE final, incluido el de esta regla, sin
      // necesidad de duplicar esa normalización aquí) para que ninguna
      // regla posterior pueda volver a convertir el resultado en PASS/FAIL
      // -- en este punto del pipeline no queda ninguna regla que cambie
      // `status` de nuevo. Actúa únicamente sobre `wcagCriterion`
      // (`heuristicCode`/Nielsen nunca coincide con este Set, por
      // construcción de `normalizeCriterionKey`). Nunca toca `evidence` ni
      // `description` -- la observación visual original de Gemini se
      // conserva íntegra, solo cambia su clasificación de conformidad.
      const criterionKey = normalizeCriterionKey(finding.wcagCriterion || undefined);
      if ((status === 'PASS' || status === 'FAIL') && NON_DEMONSTRABLE_FROM_IMAGE_WCAG_CRITERIA.has(criterionKey)) {
        status = 'NOT_EVALUABLE';
        confidence = 'low';
      }

      // Gate Rule 1c (reutilizada) — normaliza confidence en cualquier NOT_EVALUABLE.
      if (status === 'NOT_EVALUABLE') {
        confidence = 'low';
      }

      // Gate Rule V3 (P1.6.5.1) — severity se normaliza a 'info' cuando el
      // ESTADO FINAL (ya decidido por todas las reglas anteriores, V0 a 1c)
      // es NOT_EVALUABLE: una severidad `medium`/`high`/`critical` sobre un
      // hallazgo cuya propia evaluabilidad es incierta transmite una alarma
      // que la evidencia no sostiene (confirmado en P1.6.5: 4 de 7
      // NOT_EVALUABLE reales llevaban severity no-neutral). Deliberadamente
      // colocada DESPUÉS de la 1c (que ya fijó el `status` final de forma
      // definitiva) para no normalizar prematuramente la severidad de un
      // hallazgo que todavía podría degradarse más adelante en la función --
      // en este punto del pipeline no hay ninguna regla posterior que vuelva
      // a cambiar `status`. Nunca toca `status`/`confidence`/`description`/
      // `recommendation`/`evidence`; PASS y FAIL conservan su severity tal
      // cual la declaró Gemini.
      if (status === 'NOT_EVALUABLE') {
        severity = 'info';
      }

      // Gate Rule 2 (reutilizada) — limpieza de recomendación copiada del heurístico.
      let recommendation = finding.recommendation;
      if (recommendation) {
        const recTrim = recommendation.trim();
        if (
          (finding.heuristicCode && recTrim === finding.heuristicCode.trim()) ||
          (finding.heuristicName && recTrim === finding.heuristicName.trim())
        ) {
          recommendation = `Proporcionar una solución visual concreta para ${finding.heuristicName || finding.heuristicCode || 'el criterio observado'}.`;
        }
      }

      // Defensa adicional (redundante con el schema Zod, nunca confía
      // únicamente en la validación upstream): descarta cualquier `property`
      // fuera de la whitelist que hubiera llegado de algún modo.
      const sanitizedEvidence = evidence.map((item) =>
        item.property && !VISUAL_PROPERTY_WHITELIST.includes(item.property as any)
          ? { ...item, property: undefined, value: undefined }
          : item,
      );

      // P1.6.4.2 (Regla E, Caso H de la auditoría adversarial) — la
      // `description` original nunca se borra ni se reescribe, solo se
      // antecede con una aclaración explícita cuando ESTA regla (no V0, no
      // lenguaje especulativo) fue la que degradó el hallazgo -- esas otras
      // degradaciones ya existían antes de P1.6.4 y no forman parte de este
      // cambio acotado.
      const description = degradedByDynamicBehaviorRule
        ? `${DYNAMIC_BEHAVIOR_NOT_EVALUABLE_PREFIX}${finding.description}`
        : finding.description;

      return {
        ...finding,
        status,
        confidence,
        severity,
        evidence: sanitizedEvidence,
        description,
        recommendation: status === 'FAIL' ? recommendation : null,
      };
    });

    console.log(
      `[VisualEvidenceGateAudit] total=${rawFindings.length} noIdentity=${noIdentityCount} foreignEvidence=${foreignEvidenceCount} dynamicBehaviorClaim=${dynamicBehaviorClaimCount}`,
    );

    return validated;
  }
}

export const visualEvidenceGateService = VisualEvidenceGateService.getInstance();
