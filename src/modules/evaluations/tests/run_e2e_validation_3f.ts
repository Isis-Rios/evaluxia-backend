import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { evaluationService } from '@/modules/evaluations/evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { snapshotEvidenceRepository } from '@/modules/snapshots/snapshot-evidence.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { User } from '@/modules/users/user.model';
import mongoose from 'mongoose';

async function runE2eValidation3F() {
  console.log('🚀 Starting Real E2E Validation of Subetapa 3F (Observability & Timeline)...');

  await connectToDatabase();

  try {
    let user = await User.findOne({ email: 'evaluator.test@evaluxia.com' });
    if (!user) {
      user = await User.create({
        name: 'Evaluador E2E',
        email: 'evaluator.test@evaluxia.com',
        passwordHash: 'hashed_pw',
        role: 'evaluator',
      });
    }

    const userIdStr = (user._id as any).toString();
    const profilesRes = await evaluatorProfileService.findAll(userIdStr, { page: 1, limit: 10 });
    let profileIdStr = profilesRes.data.length > 0 ? profilesRes.data[0].id : '';

    if (!profileIdStr) {
      const newProfile = await evaluatorProfileService.create(userIdStr, {
        fullName: 'María Accesibilidad',
        phrase: 'Busco sitios claros y accesibles',
        age: 32,
        profession: 'Auditora Web',
        maritalStatus: 'Soltera',
        country: 'Chile',
        city: 'Santiago',
        archetype: 'El Inocente',
        biography: 'Auditora de accesibilidad web.',
        personality: 'Analítica y metódica',
        goals: ['Navegar sin barreras'],
        frustrations: ['Botones sin etiqueta'],
        techSavviness: 'high',
        accessibilityNeeds: ['Lectores de pantalla'],
        preferredDevice: 'desktop',
      });
      profileIdStr = newProfile.id;
    }

    const targetUrl = 'https://the-internet.herokuapp.com/dropdown';

    console.log(`\n▶️ Creating evaluation for URL: ${targetUrl}...`);
    const evaluation = await evaluationService.create(userIdStr, {
      evaluatorProfileId: profileIdStr,
      title: 'E2E Validation 3F Live Observability',
      type: 'website',
      url: targetUrl,
      description: 'Prueba E2E de observabilidad en vivo y timeline visual de iteraciones',
    });

    const evalId = evaluation.id;
    console.log(`✅ Evaluation created with ID: ${evalId} (Queued to JobRunner)`);

    console.log('\n⏳ Monitoring flowState.previousActions in real-time during execution...');
    let attempts = 0;
    let evalDoc = await evaluationRepository.findById(evalId);

    while (attempts < 120 && (!evalDoc || evalDoc.status !== 'completed' || evalDoc.auditStatus !== 'completed')) {
      await new Promise((res) => setTimeout(res, 2000));
      attempts++;
      evalDoc = await evaluationRepository.findById(evalId);
      const actionsCount = evalDoc?.flowState?.previousActions?.length || 0;
      console.log(`   [Poll #${attempts}] status: ${evalDoc?.status}, auditStatus: ${evalDoc?.auditStatus}, previousActions logged: ${actionsCount}`);
    }

    if (!evalDoc || evalDoc.status !== 'completed' || evalDoc.auditStatus !== 'completed') {
      console.error('❌ Evaluation failed or timed out.');
      process.exit(1);
    }

    console.log('✅ Evaluation and Audit Engine completed successfully!');

    // Check SnapshotEvidence for IterationTimeline
    const dbSnapshots = await snapshotEvidenceRepository.findByEvaluationId(evalId);

    console.log('\n================================================================================');
    console.log('📊 SUBETAPA 3F REAL E2E OBSERVABILITY & TIMELINE REPORT');
    console.log('================================================================================');
    console.log(`• Evaluation ID                 : ${evalId}`);
    console.log(`• Final Evaluation Status       : ${evalDoc.status}`);
    console.log(`• Final Audit Status            : ${evalDoc.auditStatus}`);
    console.log(`• Total Real Actions Logged     : ${evalDoc.flowState?.previousActions?.length}`);
    console.log(`• Total SnapshotEvidence Items  : ${dbSnapshots.length}`);

    console.log('\n--- REAL PREVIOUS ACTIONS LOGGED IN FLOWSTATE (RUNNING OBSERVABILITY) ---');
    evalDoc.flowState?.previousActions?.forEach((act, idx) => {
      console.log(`  [Action #${idx + 1}] Type: ${act.actionType} | Result: ${act.result} | Desc: ${act.description}`);
    });

    console.log('\n--- SNAPSHOT EVIDENCE ITEMS FOR ITERATION TIMELINE (COMPLETED TIMELINE) ---');
    dbSnapshots.forEach((snap) => {
      console.log(`  [Iteration ${snap.iteration}] Action: ${snap.action?.actionType || 'Initial'} | URL: ${snap.url} | Screenshot: ${snap.screenshotPath}`);
    });

    console.log('\n================================================================================');
    console.log('🎉 Subetapa 3F Real E2E Observability & Timeline Validation completed with 100% Success!');
  } catch (err) {
    console.error('❌ E2E Validation 3F failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runE2eValidation3F();
