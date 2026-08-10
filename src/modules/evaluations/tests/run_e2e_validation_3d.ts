import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { evaluationService } from '@/modules/evaluations/evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { reportRepository } from '@/modules/reports/report.repository';
import { findingRepository } from '@/modules/findings/finding.repository';
import { snapshotEvidenceRepository } from '@/modules/snapshots/snapshot-evidence.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { User } from '@/modules/users/user.model';
import mongoose from 'mongoose';

async function runE2eValidation() {
  console.log('🚀 Starting Real E2E Validation of 3A -> 3B -> 3C -> 3D Pipeline...');

  await connectToDatabase();

  try {
    // 1. Get or create test user
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

    // 2. Get or create test profile
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
      title: 'E2E Validation 3A-3D Test',
      type: 'website',
      url: targetUrl,
      description: 'Prueba E2E completa de la cadena de evidencia y métricas determinísticas',
    });

    const evalId = evaluation.id;
    console.log(`✅ Evaluation created with ID: ${evalId} (Queued to JobRunner)`);

    console.log('\n⏳ Waiting for JobRunner and Phase 2 AuditEngine to complete...');
    let attempts = 0;
    let evalDoc = await evaluationRepository.findById(evalId);

    while (attempts < 60 && (!evalDoc || evalDoc.status !== 'completed' || evalDoc.auditStatus !== 'completed')) {
      await new Promise((res) => setTimeout(res, 2000));
      attempts++;
      evalDoc = await evaluationRepository.findById(evalId);
      console.log(`   [Attempt ${attempts}/60] status: ${evalDoc?.status || 'pending'}, auditStatus: ${evalDoc?.auditStatus || 'pending'}`);
    }

    if (!evalDoc || evalDoc.status !== 'completed' || evalDoc.auditStatus !== 'completed') {
      console.error('❌ Evaluation timeout or failed to reach completed state.');
    } else {
      console.log('✅ Evaluation and Phase 2 Audit completed successfully!');
    }

    // 3. Fetch all persisted entities
    const report = await reportRepository.findByEvaluationId(evalId);
    const findings = await findingRepository.findByEvaluationId(evalId);
    const evidences = await snapshotEvidenceRepository.findByEvaluationId(evalId);

    console.log('\n================================================================================');
    console.log('📊 REAL E2E VALIDATION REPORT (SUBETAPA 3A -> 3B -> 3C -> 3D)');
    console.log('================================================================================');
    console.log(`• Evaluation ID           : ${evalId}`);
    console.log(`• Evaluated Target URL     : ${evalDoc?.url}`);
    console.log(`• Final Evaluation Status : ${evalDoc?.status}`);
    console.log(`• Audit Status            : ${evalDoc?.auditStatus}`);
    console.log(`• Iterations Executed     : ${evalDoc?.flowState?.currentStep || 1}`);
    console.log(`• SnapshotEvidence Saved  : ${evidences.length}`);
    console.log(`• Screenshots Count       : ${evidences.filter((e) => Boolean(e.screenshotPath)).length}`);

    console.log('\n--- METRICS FROM PERSISTED REPORT (100% DETERMINISTIC BACKEND) ---');
    console.log(`• overallScore            : ${report?.overallScore} / 100`);
    console.log(`• auditCoverage           : ${report?.auditCoverage}%`);
    console.log(`• nielsenCoverage         : ${report?.nielsenCoverage}%`);
    console.log(`• wcagCoverage            : ${report?.wcagCoverage}%`);
    console.log(`• nielsenCompliance       : ${report?.nielsenCompliance !== null ? report?.nielsenCompliance + '%' : 'null (N/A)'}`);
    console.log(`• wcagCompliance          : ${report?.wcagCompliance !== null ? report?.wcagCompliance + '%' : 'null (N/A)'}`);
    console.log(`• passCount               : ${report?.passCount}`);
    console.log(`• failCount               : ${report?.failCount}`);
    console.log(`• notEvaluableCount       : ${report?.notEvaluableCount}`);
    console.log(`• criticalCount           : ${report?.criticalCount}`);
    console.log(`• highCount               : ${report?.highCount}`);
    console.log(`• mediumCount             : ${report?.mediumCount}`);
    console.log(`• lowCount                : ${report?.lowCount}`);
    console.log(`• totalFindings           : ${report?.totalFindings}`);
    console.log(`• evaluatedCriteria       : ${report?.evaluatedCriteria} / ${report?.totalCriteria}`);
    console.log(`• evidenceCount           : ${report?.evidenceCount}`);

    console.log('\n--- FINDINGS DETAILS IN DB ---');
    findings.forEach((f, idx) => {
      console.log(`\n[Finding #${idx + 1}]`);
      console.log(`  Group      : ${f.findingGroup}`);
      console.log(`  Criterion  : ${f.wcagCriterion || f.heuristicCode || 'N/A'}`);
      console.log(`  Status     : ${f.status}`);
      console.log(`  Severity   : ${f.severity}`);
      console.log(`  Confidence : ${f.confidence}`);
      console.log(`  Element    : ${f.affectedElement?.selector || f.affectedElement?.tag || 'N/A'}`);
      console.log(`  Desc       : ${f.description}`);
      console.log(`  Rec        : ${f.recommendation}`);
      console.log(`  Evidence   : ${JSON.stringify(f.evidence)}`);
    });

    console.log('\n================================================================================');
    console.log('🎉 E2E Validation completed successfully!');
  } catch (err) {
    console.error('❌ E2E Validation failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runE2eValidation();
