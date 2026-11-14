import { aiService } from '../ai.service';
import { resolveApplicablePrototypeCriteria } from '@/modules/evaluations/services/prototype-criteria-resolver';
import { PrototypeAuditFindingSchema, VisualEvidenceItemSchema } from '../contracts/prototype.contracts';

/**
 * Suite determinística de verificación para la calibración del criterio N-08 (CRI-33 / CRI-18).
 *
 * Valida los 6 requisitos de calibración post-auditoría:
 * 1. El prompt PROTOTIPO ya no exige que el desorden visual sea "severe".
 * 2. Permite identificar problemas visuales moderados cuando exista evidencia concreta de competencia con el contenido principal (CRI-33).
 * 3. Una interfaz visualmente densa pero bien organizada no debe recibir FAIL automáticamente.
 * 4. La coincidencia entre label y placeholder no debe generar FAIL por sí sola.
 * 5. Una observación estética subjetiva sin evidencia no debe producir FAIL.
 * 6. Se conservan los contratos de evidencia visual y la clasificación de resultados existente.
 * 7. El prompt WEB contiene la calibración alineada sin el término "severe".
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

async function runTests() {
  console.log('🧪 Iniciando pruebas determinísticas de calibración de N-08 en prompts...\n');

  const applicableCriteria = resolveApplicablePrototypeCriteria();

  const mockPrototypeInput: any = {
    title: 'Prototipo de prueba',
    description: 'Prototipo de pantalla de contacto y checkout',
    archetype: {
      fullName: 'Laura Martínez',
      archetype: 'Profesional Orientada a Resultados',
      profession: 'Arquitecta',
      phrase: 'Eficiencia y claridad visual',
      age: 32,
      biography: 'Usuario profesional con alta atención al detalle visual.',
      goals: ['Navegar sin distracciones'],
      frustrations: ['Desorden visual innecesario'],
      techSavviness: 'high',
      accessibilityNeeds: [],
      preferredDevice: 'desktop',
    },
  };

  const prototypePrompt: string = (aiService as any).buildPrototypeAuditPrompt(
    mockPrototypeInput,
    applicableCriteria,
  );

  // -----------------------------------------------------------------
  // Prueba 1: El prompt PROTOTIPO ya no exige que el desorden sea "severe"
  // -----------------------------------------------------------------
  console.log('--- Prueba 1: Eliminación del término "severe" en N-08 PROTOTIPO ---');
  {
    assert(
      !prototypePrompt.includes('severe visual clutter'),
      'El prompt PROTOTIPO ya no contiene la frase "severe visual clutter"',
    );
    assert(
      !prototypePrompt.includes('ONLY when there is concrete visual evidence of severe'),
      'El prompt PROTOTIPO ya no condiciona el FAIL a gravedad "severe"',
    );
  }

  // -----------------------------------------------------------------
  // Prueba 2: Alineación con Anexo C (CRI-33) y admisión de problemas moderados con evidencia
  // -----------------------------------------------------------------
  console.log('\n--- Prueba 2: Alineación metodológica con Anexo C (CRI-33) ---');
  {
    assert(
      prototypePrompt.includes('CRI-33'),
      'El prompt referencia explícitamente el criterio metodológico CRI-33 del Anexo C',
    );
    assert(
      prototypePrompt.includes("does not need to be 'severe'"),
      'Indica explícitamente que el problema no requiere ser "severe" para emitir FAIL',
    );
    assert(
      prototypePrompt.includes('compete unnecessarily with primary content') ||
      prototypePrompt.includes('compete unnecessarily with the primary content') ||
      prototypePrompt.includes('compitan innecesariamente con el contenido principal'),
      'Evalúa si los elementos visuales compiten innecesariamente con el contenido principal',
    );
    assert(
      prototypePrompt.includes('moderate clutter') || prototypePrompt.includes('moderate visual clutter'),
      'Permite emitir FAIL ante desorden visual o competencia moderada cuando exista evidencia concreta',
    );
  }

  // -----------------------------------------------------------------
  // Prueba 3: Interfaces densas bien organizadas no reciben FAIL automáticamente
  // -----------------------------------------------------------------
  console.log('\n--- Prueba 3: Protección contra falsos positivos en interfaces densas ---');
  {
    assert(
      prototypePrompt.includes('visually dense interface is NOT automatically a failure') ||
      prototypePrompt.includes('dense interface is NOT automatically a failure'),
      'Instruye que una interfaz densa no es automáticamente FAIL si mantiene orden y jerarquía',
    );
    assert(
      prototypePrompt.includes('visual hierarchy') && prototypePrompt.includes('organization'),
      'Enfatiza la jerarquía visual y la organización como mitigantes de densidad',
    );
  }

  // -----------------------------------------------------------------
  // Prueba 4: Coincidencia entre label y placeholder no genera FAIL por sí sola
  // -----------------------------------------------------------------
  console.log('\n--- Prueba 4: Protección contra falsos positivos en labels/placeholders ---');
  {
    assert(
      (prototypePrompt.includes('do NOT constitute an N-08 violation') ||
       prototypePrompt.includes('does NOT automatically constitute an N-08')) &&
      prototypePrompt.includes('placeholder'),
      'La coexistencia de label y placeholder idénticos no constituye por sí sola un FAIL',
    );
    assert(
      prototypePrompt.includes('Clean forms with matching placeholders do NOT warrant a FAIL') ||
      prototypePrompt.includes('Clean, well-spaced forms with matching placeholders do NOT warrant a FAIL'),
      'Formularios limpios con placeholders coincidentes no reciben FAIL',
    );
  }

  // -----------------------------------------------------------------
  // Prueba 5: Preferencias estéticas subjetivas sin evidencia no producen FAIL
  // -----------------------------------------------------------------
  console.log('\n--- Prueba 5: Exclusión de preferencias estéticas subjetivas ---');
  {
    assert(
      prototypePrompt.includes('Do NOT penalize subjective aesthetic choices') ||
      prototypePrompt.includes('stylistic preferences'),
      'Prohíbe penalizar decisiones estéticas subjetivas o preferencias de estilo sin evidencia',
    );
    assert(
      prototypePrompt.includes('identifiable visual evidence'),
      'Exige evidencia visual identificable para sustentar cualquier hallazgo de incumplimiento',
    );
  }

  // -----------------------------------------------------------------
  // Prueba 6: Calibración en prompt WEB alineada sin "severe"
  // -----------------------------------------------------------------
  console.log('\n--- Prueba 6: Coherencia en prompt WEB (CRI-18) ---');
  {
    const mockWebInput: any = {
      title: 'Auditoría Web E-commerce',
      url: 'https://example.com',
      archetype: {
        fullName: 'Laura Martínez',
        archetype: 'Profesional Orientada a Resultados',
        profession: 'Arquitecta',
        phrase: 'Eficiencia y claridad visual',
        goals: ['Navegar sin distracciones'],
        frustrations: ['Desorden visual innecesario'],
      },
      completedSteps: ['Inicio', 'Catálogo'],
      previousActions: [],
      snapshotsCount: 2,
      evidencesSummary: [],
    };
    const webPrompt: string = (aiService as any).buildV2AuditPrompt(mockWebInput);

    const n08Start = webPrompt.indexOf('N-08 (Diseño estético y minimalista');
    const n08End = webPrompt.indexOf('WCAG 1.3.1');
    const n08Section = webPrompt.slice(n08Start, n08End);

    assert(
      !n08Section.includes('severe visual clutter') && !n08Section.includes('severe clutter'),
      'La calibración N-08 en el prompt WEB no exige desorden "severe"',
    );
    assert(
      webPrompt.includes('CRI-18') && webPrompt.includes('N-08'),
      'El prompt WEB referencia CRI-18 y N-08',
    );
    assert(
      webPrompt.includes('compete unnecessarily with primary content'),
      'El prompt WEB evalúa competencia innecesaria con contenido principal',
    );
  }

  // -----------------------------------------------------------------
  // Prueba 7: Preservación de contratos de evidencia y esquemas
  // -----------------------------------------------------------------
  console.log('\n--- Prueba 7: Preservación de contratos Zod de evidencia visual ---');
  {
    // Validar que un finding N-08 moderado con evidencia visual estructurada pasa el schema
    const moderateN08Finding = PrototypeAuditFindingSchema.safeParse({
      findingGroup: 'ux',
      type: 'usability',
      status: 'FAIL',
      severity: 'medium',
      confidence: 'high',
      heuristicCode: 'N-08',
      heuristicName: 'Diseño estético y minimalista',
      description: 'Elementos decorativos redundantes en la barra lateral compiten visualmente con el formulario principal de checkout.',
      evidence: [
        {
          type: 'VISUAL_OBSERVATION',
          elementDescription: 'Banners promocionales en lateral derecho',
          region: 'middle-right',
          property: 'layout',
          value: 'crowded lateral banners competing with checkout form',
          context: 'Los banners ocupan el 40% del ancho del viewport sin separación respecto al formulario.',
        },
      ],
      recommendation: 'Eliminar o reducir el tamaño de los elementos decorativos para permitir concentración en el formulario.',
    });

    assert(
      moderateN08Finding.success === true,
      'Un finding N-08 de severidad medium con evidencia visual estructurada cumple estrictamente el schema PrototypeAuditFindingSchema',
    );

    // Validar que un ítem de evidencia visual individual sigue pasando VisualEvidenceItemSchema
    const visualItem = VisualEvidenceItemSchema.safeParse({
      type: 'VISUAL_OBSERVATION',
      elementDescription: 'Contenedor de filtros con espaciado denso',
      region: 'middle-left',
      property: 'visualHierarchy',
      value: 'secondary-elements-competing-with-main-content',
      context: 'Densidad visual que compite con la lista de productos.',
    });

    assert(
      visualItem.success === true,
      'Ítem de evidencia visual para N-08 cumple VisualEvidenceItemSchema',
    );
  }

  console.log('\n========================================');
  console.log('Results: All 7 N-08 prompt calibration test scenarios passed successfully!');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Error en test suite de N-08 prompt calibration:', err);
  process.exit(1);
});
