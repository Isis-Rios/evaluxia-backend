import { aiService } from '../ai.service';
import {
  V2AIOutputDecisionSchema,
  V2AuditOutputSchema,
} from '../contracts/ai.contracts';
import { PrototypeAuditOutputSchema } from '../contracts/prototype.contracts';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';

/**
 * Suite determinística local de verificación de la regla de Neutralidad Lingüística
 * incorporada en los prompts de EvalUXIA (`buildV2DecisionPrompt`,
 * `buildV2AuditPrompt` y `buildPrototypeAuditPrompt`).
 *
 * IMPORTANTE — alcance metodológico de esta suite:
 * - Verifica que las instrucciones de neutralidad lingüística y de idioma de salida
 *   flexible están presentes, bien ubicadas, sin duplicaciones, sin ampliar el contexto
 *   dinámico y sin alterar los contratos JSON ni reglas existentes.
 * - NO demuestra ni puede demostrar el comportamiento efectivo de Gemini en producción;
 *   el acatamiento semántico del modelo solo puede comprobarse mediante una evaluación
 *   real posterior con Gemini (fuera del alcance de esta suite).
 *
 * Cero llamadas reales a Gemini, cero consumo de créditos, cero MongoDB.
 */
function assert(condition: boolean, msg: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ FAILED: ${msg}`);
    if (detail !== undefined) console.error('     detail:', detail);
    process.exit(1);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function runTests() {
  console.log('🧪 Iniciando pruebas locales de Neutralidad Lingüística en prompts...\n');

  // ── Fixtures mínimos (sin llamar a Gemini ni BD) ──────────────────────────
  const mockDecisionInput: any = {
    metadata: {
      evaluationId: 'test-eval-lang-nav',
      timestamp: '2026-11-25T00:00:00.000Z',
      iteration: 1,
    },
    flowDefinition: {
      flowDescription: 'Explorar tablero de administración en inglés',
      currentStepObjective: 'Identificar la navegación principal',
      totalStepsEstimated: 3,
    },
    flowState: {
      currentStep: 1,
      completedSteps: [],
      previousActions: [],
      blockingError: null,
    },
    userArchetype: {
      fullName: 'Laura Martínez',
      phrase: 'Quiero terminar mi tarea rápido y sin complicaciones.',
      age: 32,
      profession: 'Administradora de empresas',
      maritalStatus: 'Casado/a',
      country: 'Colombia',
      city: 'Bogotá',
      archetype: 'El amigo',
      biography: 'Usuaria con conocimientos tecnológicos intermedios.',
      personality: 'Práctica y organizada.',
      goals: ['Completar tareas rápidamente'],
      frustrations: ['Botones poco claros'],
    },
    technicalContext: {
      url: 'https://example.com/dashboard',
      requiresAuthentication: false,
      authenticationStatus: 'unauthenticated',
      visibleDOMSummary: [
        {
          type: 'link',
          text: 'Orders',
          ariaLabel: null,
          role: 'link',
          isDisabled: false,
          isPrimary: true,
        },
      ],
    },
    constraints: {
      doNotAssumeHiddenElements: true,
      doNotInventActions: true,
      maxOneActionPerIteration: true,
    },
  };

  const mockWebAuditInput: any = {
    evaluationId: 'test-eval-lang-web',
    title: 'WEB-XX Portal en inglés (Laura)',
    url: 'https://example.com',
    archetype: {
      fullName: 'Laura Martínez',
      archetype: 'El amigo',
      profession: 'Administradora de empresas',
      phrase: 'Quiero terminar mi tarea rápido y sin complicaciones.',
      goals: ['Completar tareas rápidamente'],
      frustrations: ['Botones poco claros'],
    },
    completedSteps: ['Navegar a la URL objetivo'],
    previousActions: [
      { actionType: 'NAVIGATE', description: 'Navegar a https://example.com', result: 'success' },
    ],
    snapshotsCount: 1,
    evidencesSummary: [],
  };

  const mockPrototypeInput: any = {
    evaluationId: 'test-eval-lang-proto',
    title: 'PRO-04 Dashboard de administración (Laura)',
    description:
      'Tablero de administración logística para supervisar pedidos, envíos, inventario y almacenes.',
    archetype: {
      fullName: 'Laura Martínez',
      archetype: 'El amigo',
      profession: 'Administradora de empresas',
      phrase: 'Quiero terminar mi tarea rápido y sin complicaciones.',
      goals: ['Completar tareas rápidamente'],
      frustrations: ['Botones poco claros'],
      techSavviness: 'medium',
      accessibilityNeeds: [],
      preferredDevice: 'desktop',
      biography: 'Usuaria con conocimientos tecnológicos intermedios.',
    },
    imageMimeType: 'image/jpeg',
    imageBase64: '',
  };

  const applicableCriteria = resolveApplicablePrototypeCriteria();

  const navPrompt: string = (aiService as any).buildV2DecisionPrompt(mockDecisionInput);
  const webPrompt: string = (aiService as any).buildV2AuditPrompt(mockWebAuditInput);
  const protoPrompt: string = (aiService as any).buildPrototypeAuditPrompt(
    mockPrototypeInput,
    applicableCriteria,
  );

  // -------------------------------------------------------------------------
  // 1. Inclusión de la regla en el análisis de prototipos
  // -------------------------------------------------------------------------
  console.log('--- 1. Regla de neutralidad lingüística en prompt de PROTOTIPOS ---');
  {
    assert(
      protoPrompt.includes('### LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE:'),
      'El prompt de prototipos incluye la sección LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE',
    );
    assert(
      countOccurrences(protoPrompt, '### LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE:') === 1,
      'La regla aparece exactamente una vez en el prompt de prototipos (sin duplicación)',
    );
    assert(
      protoPrompt.indexOf('### LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE:') <
        protoPrompt.indexOf('### PROTOTYPE CONTEXT:'),
      'La regla aparece con prioridad metodológica antes del contexto del prototipo',
    );
    assert(
      /persona or prototype description is NOT a localization requirement/.test(protoPrompt),
      'Establece que el idioma del perfil y de la descripción no constituyen requisito de localización',
    );
    assert(
      /never infer language proficiency from name, country, city, age, or profession/.test(protoPrompt),
      'Prohíbe inferir competencia lingüística desde nombre, país, ciudad, edad o profesión',
    );
    assert(
      /Do NOT mark an English UI as FAIL because the persona\/description is in Spanish \(nor vice versa\)/.test(
        protoPrompt,
      ),
      'Impide marcar FAIL solo por diferencia español/inglés en ambas direcciones',
    );
    assert(
      /description clarifies product function without replacing or reinterpreting visible labels/.test(protoPrompt),
      'Aclara que la descripción ayuda a entender la función sin sustituir etiquetas visibles',
    );
    assert(
      /apply abstention \(NOT_EVALUABLE\) when evidence is insufficient/.test(protoPrompt),
      'Remite a la política de abstención (NOT_EVALUABLE) cuando la evidencia es insuficiente',
    );
    assert(
      !protoPrompt.includes('Colombia') && !protoPrompt.includes('Bogotá'),
      'No se amplió el contexto dinámico de prototipos con país/ciudad',
    );
  }

  // -------------------------------------------------------------------------
  // 2. Inclusión de la regla en el análisis WEB (Fase 2)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Regla de neutralidad lingüística en prompt de ANÁLISIS WEB ---');
  {
    assert(
      webPrompt.includes('### LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE:'),
      'El prompt WEB incluye la sección LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE',
    );
    assert(
      countOccurrences(webPrompt, '### LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE:') === 1,
      'La regla aparece exactamente una vez en el prompt WEB (sin duplicación)',
    );
    assert(
      webPrompt.indexOf('### LINGUISTIC NEUTRALITY & OUTPUT LANGUAGE:') <
        webPrompt.indexOf('### EVALUATION SESSION CONTEXT:'),
      'La regla aparece con prioridad metodológica junto a ABSOLUTE AUDIT RULE',
    );
    assert(
      /persona or session context is NOT a localization requirement/.test(webPrompt),
      'Establece que el idioma del perfil/contexto de sesión no es requisito de localización',
    );
    assert(
      /never infer language proficiency from name, country, city, age, or profession/.test(webPrompt),
      'Prohíbe inferir competencia lingüística desde atributos demográficos o profesionales',
    );
    assert(
      /Do NOT mark an English UI as FAIL because the persona is in Spanish \(nor vice versa\)/.test(webPrompt),
      'Impide marcar FAIL solo por diferencia español/inglés en ambas direcciones',
    );
    assert(
      /Judge strictly from observed DOM texts, structures, properties, and behaviors/.test(webPrompt),
      'Prioriza textos, estructuras, propiedades y comportamientos observados en DOM',
    );
    assert(
      /apply abstention \(NOT_EVALUABLE\) when evidence is insufficient/.test(webPrompt),
      'Mantiene la política de abstención cuando falta evidencia',
    );
  }

  // -------------------------------------------------------------------------
  // 3. Navegación (Fase 1) no presupone preferencia lingüística por el perfil
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Neutralidad lingüística en prompt de NAVEGACIÓN (Fase 1) ---');
  {
    assert(
      navPrompt.includes('3. Linguistic Neutrality:'),
      'El prompt de navegación Fase 1 incluye la restricción de Linguistic Neutrality',
    );
    assert(
      countOccurrences(navPrompt, 'Linguistic Neutrality:') === 1,
      'La regla aparece exactamente una vez en el prompt de navegación',
    );
    assert(
      /persona\/flow wording language is NOT a user language preference or proficiency limit/.test(navPrompt),
      'Aclara que el idioma de redacción del perfil/flujo no es preferencia ni límite lingüístico',
    );
    assert(
      /never infer language competence from name, country, city, age, or profession/.test(navPrompt),
      'Prohíbe inferir competencia lingüística desde datos demográficos del perfil',
    );
    assert(
      /do not switch UI language unless required by the flow or a multilingual entry gate/.test(navPrompt),
      'Evita cambios innecesarios de idioma de interfaz salvo flujo explícito o portada multilingüe',
    );
    assert(
      !navPrompt.includes('Colombia') && !navPrompt.includes('Bogotá'),
      'No se amplió el contexto dinámico de navegación con campos adicionales',
    );
  }

  // -------------------------------------------------------------------------
  // 4. Permite identificar inconsistencias lingüísticas internas reales
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Preservación de detección de inconsistencias lingüísticas internas reales ---');
  {
    const internalPattern =
      /Still report genuine internal language inconsistencies \(e\.g\. mixed languages within the same (?:UI|screen)\), terminology errors, or barriers backed by explicit language requirements/;
    assert(
      internalPattern.test(webPrompt),
      'El prompt WEB permite reportar mezclas idiomáticas internas, errores terminológicos y barreras explícitas',
    );
    assert(
      internalPattern.test(protoPrompt),
      'El prompt de PROTOTIPOS permite reportar mezclas idiomáticas internas, errores terminológicos y barreras explícitas',
    );
  }

  // -------------------------------------------------------------------------
  // 5. Idioma de salida flexible y preservación literal de evidencias
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Idioma de respuesta flexible y preservación literal de evidencias ---');
  {
    for (const [label, prompt] of [
      ['WEB', webPrompt],
      ['PROTOTIPO', protoPrompt],
    ] as const) {
      assert(
        /predominant language of the persona's descriptive texts/.test(prompt) &&
          /without enforcing a fixed global language/.test(prompt),
        `${label}: mantiene idioma de respuesta flexible basado en el perfil/contexto sin idioma global fijo`,
      );
      assert(
        /verbatim in evidence \(never translate evidence away from the original/.test(prompt),
        `${label}: exige conservar literalmente textos/etiquetas/valores originales como evidencia sin traducirlos`,
      );
      assert(
        /Report wording must never influence PASS\/FAIL\/NOT_EVALUABLE classification/.test(prompt),
        `${label}: separa el idioma del informe de la clasificación PASS/FAIL/NOT_EVALUABLE`,
      );
    }

    assert(
      /Write 'rationale' in the persona\/flow's predominant language while keeping selectors and referenced UI texts verbatim/.test(
        navPrompt,
      ),
      'NAVEGACIÓN: conserva selectores y textos de UI literalmente al redactar rationale',
    );
  }

  // -------------------------------------------------------------------------
  // 6. El contrato JSON permanece intacto en ambos idiomas de salida (ES y EN)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Compatibilidad de contratos JSON con salida en español y en inglés ---');
  {
    // Phase 1 decision (EN rationale + verbatim selector)
    const decEn = V2AIOutputDecisionSchema.safeParse({
      evaluationSummary: { flowCanContinue: true },
      suggestedAction: {
        actionType: 'CLICK',
        targetElement: { matchStrategy: 'CSS', value: 'nav a.orders' },
        inputData: null,
        rationale: "Navigate directly to 'Orders' to inspect active shipments.",
        confidence: 'high',
      },
      flowControl: {
        isStopper: false,
        stopperReason: null,
        recommendedNextStep: 'executeSuggestedAction',
      },
    });
    assert(decEn.success, 'V2AIOutputDecisionSchema valida correctamente una decisión redactada en inglés');

    // Phase 2 web audit (ES narrative + verbatim EN evidence)
    const webEsWithEnEv = V2AuditOutputSchema.safeParse({
      overallScore: 70,
      executiveSummary: 'La interfaz en inglés presenta una mezcla interna real con texto en árabe.',
      findings: [
        {
          findingGroup: 'ux',
          type: 'content',
          status: 'FAIL',
          severity: 'medium',
          confidence: 'high',
          heuristicCode: 'N-04',
          heuristicName: 'Consistencia y estándares',
          wcagCriterion: 'WCAG 2.4.6 Encabezados y etiquetas',
          description: "Bajo la ruta '/en-US' aparecen encabezados en árabe mezclados con etiquetas en inglés.",
          evidence: [{ type: 'HEADING_STRUCTURE', property: 'text', value: 'مقرر', selector: 'h3' }],
          affectedElement: { tag: 'h3', text: 'مقرر', selector: 'h3', role: 'heading' },
          impact: 'Genera confusión por mezcla idiomática interna.',
          recommendation: 'Sincronizar todas las cadenas del locale en-US al inglés.',
        },
      ],
    });
    assert(
      webEsWithEnEv.success,
      'V2AuditOutputSchema valida correctamente salida narrativa en español con evidencia literal original',
    );

    // Phase 2 prototype audit (EN narrative + verbatim EN evidence)
    const protoEn = PrototypeAuditOutputSchema.safeParse({
      overallScore: 60,
      executiveSummary: 'Consistent English logistics dashboard with one internal calendar spelling error.',
      findings: [
        {
          findingGroup: 'ux',
          type: 'usability',
          status: 'FAIL',
          severity: 'low',
          confidence: 'high',
          heuristicCode: 'N-04',
          heuristicName: 'Consistencia y estándares',
          wcagCriterion: null,
          description: "The calendar header displays 'Agustus 2024' inside an otherwise English interface.",
          evidence: [
            {
              type: 'VISUAL_OBSERVATION',
              elementDescription: 'Monthly calendar header',
              region: 'top-center',
              property: 'visibleText',
              value: 'Agustus 2024',
              context: null,
            },
          ],
          affectedElement: {
            visualReference: { description: 'Calendar month label', region: 'top-center' },
          },
          impact: 'Introduces minor internal language inconsistency.',
          recommendation: "Change 'Agustus 2024' to 'August 2024'.",
        },
      ],
    });
    assert(
      protoEn.success,
      'PrototypeAuditOutputSchema valida correctamente salida en inglés con evidencia literal sin cambios de contrato',
    );

    // Regresión de estructura JSON en los tres prompts
    assert(
      navPrompt.includes('"suggestedAction": {') &&
        webPrompt.includes('"findings": [') &&
        protoPrompt.includes('"findings": ['),
      'Los tres prompts conservan intactos sus bloques de contrato JSON de salida',
    );
  }

  // -------------------------------------------------------------------------
  // 7. Reporte local de tamaño de prompts (estimación orientativa, NO consumo real)
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Medición local de tamaño actual de prompts (solo referencia estimada) ---');
  for (const [name, prompt] of [
    ['Phase 1 Navigation (buildV2DecisionPrompt)', navPrompt],
    ['Phase 2 Web Audit (buildV2AuditPrompt)', webPrompt],
    ['Phase 2 Prototype Audit (buildPrototypeAuditPrompt)', protoPrompt],
  ] as const) {
    console.log(
      `  📏 ${name}: ${prompt.length} chars (~${Math.ceil(prompt.length / 4)} est. tokens a ~4 chars/token)`,
    );
  }

  console.log('\n🎉 Todas las pruebas locales de Neutralidad Lingüística pasaron exitosamente.');
  console.log(
    'ℹ️  Nota: esta suite verifica presencia estructural en prompts y compatibilidad de contratos, no comportamiento real de Gemini.',
  );
  process.exit(0);
}

runTests();
