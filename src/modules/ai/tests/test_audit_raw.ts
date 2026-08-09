import { aiService } from '../ai.service';

async function testAuditRaw() {
  console.log('🚀 Running test_audit_raw.ts to capture real Gemini RAW output...');

  try {
    const result = await aiService.performAuditAnalysis({
      evaluationId: '65f8a201c9d81e0012a4b899',
      title: 'Prueba Audit RAW',
      url: 'https://ejemplo.com',
      archetype: {
        fullName: 'Carlos Ruiz',
        archetype: 'El Inocente',
        profession: 'Jubilado',
        phrase: 'No me hagas pensar mucho.',
        goals: ['Comprar regalos de forma sencilla'],
        frustrations: ['Textos pequeños', 'Flujos confusos'],
      },
      completedSteps: ['Navegar a Home', 'Buscar Zapatos'],
      previousActions: [
        { actionType: 'NAVIGATE', description: 'Navegar a URL inicial', result: 'success' },
        { actionType: 'CLICK', description: 'Click en boton Buscar', result: 'success' }
      ],
      snapshotsCount: 2,
    });

    console.log('✅ Success! Result parsed:', JSON.stringify(result.result, null, 2));
  } catch (err: any) {
    console.error('❌ Error caught during audit analysis call:');
    console.error(err.message || err);
  }
}

testAuditRaw();
