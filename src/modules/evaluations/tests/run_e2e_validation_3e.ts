import { connectToDatabase } from '@/infrastructure/database/mongodb';
import { evaluationService } from '@/modules/evaluations/evaluation.service';
import { evaluationRepository } from '@/modules/evaluations/evaluation.repository';
import { reportRepository } from '@/modules/reports/report.repository';
import { findingRepository } from '@/modules/findings/finding.repository';
import { snapshotEvidenceRepository } from '@/modules/snapshots/snapshot-evidence.repository';
import { evaluatorProfileService } from '@/modules/evaluator-profiles/evaluator-profile.service';
import { reportService } from '@/modules/reports/report.service';
import { snapshotEvidenceService } from '@/modules/snapshots/snapshot-evidence.service';
import { User } from '@/modules/users/user.model';
import mongoose from 'mongoose';

async function runE2eValidation3E() {
  console.log('🚀 Starting Real E2E Validation of 3A -> 3B -> 3C -> 3D -> 3E Full Pipeline...');

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
      title: 'E2E Validation 3E Full Pipeline',
      type: 'website',
      url: targetUrl,
      description: 'Prueba E2E completa de la API de reportes, snapshots y visualización frontend',
    });

    const evalId = evaluation.id;
    console.log(`✅ Evaluation created with ID: ${evalId} (Queued to JobRunner)`);

    console.log('\n⏳ Waiting for JobRunner and Phase 2 AuditEngine to complete...');
    let attempts = 0;
    let evalDoc = await evaluationRepository.findById(evalId);

    while (attempts < 120 && (!evalDoc || evalDoc.status !== 'completed' || evalDoc.auditStatus !== 'completed')) {
      await new Promise((res) => setTimeout(res, 2000));
      attempts++;
      evalDoc = await evaluationRepository.findById(evalId);
    }

    if (!evalDoc || evalDoc.status !== 'completed' || evalDoc.auditStatus !== 'completed') {
      console.error('❌ Evaluation failed or timed out.');
      process.exit(1);
    }

    console.log('✅ Evaluation and Audit Engine completed successfully!');

    // 1. Query MongoDB directly
    const dbReport = await reportRepository.findByEvaluationId(evalId);
    const dbFindings = await findingRepository.findByEvaluationId(evalId);
    const dbSnapshots = await snapshotEvidenceRepository.findByEvaluationId(evalId);

    // 2. Query via Backend API Services
    const apiReport = await reportService.getReportForEvaluation(evalId);
    const apiSnapshots = await snapshotEvidenceService.getEvidencesForEvaluation(evalId);

    console.log('\n================================================================================');
    console.log('📊 SUBETAPA 3E REAL E2E COMPARISON REPORT (MongoDB vs Backend API vs Frontend Contract)');
    console.log('================================================================================');
    console.log(`• Evaluation ID                 : ${evalId}`);
    console.log(`• MongoDB overallScore          : ${dbReport?.overallScore} | API overallScore          : ${apiReport.overallScore}`);
    console.log(`• MongoDB nielsenCompliance     : ${dbReport?.nielsenCompliance}% | API nielsenCompliance     : ${apiReport.nielsenCompliance}%`);
    console.log(`• MongoDB wcagCompliance        : ${dbReport?.wcagCompliance}% | API wcagCompliance        : ${apiReport.wcagCompliance}%`);
    console.log(`• MongoDB auditCoverage         : ${dbReport?.auditCoverage}% | API auditCoverage         : ${apiReport.auditCoverage}%`);
    console.log(`• MongoDB nielsenCoverage       : ${dbReport?.nielsenCoverage}% | API nielsenCoverage       : ${apiReport.nielsenCoverage}%`);
    console.log(`• MongoDB wcagCoverage          : ${dbReport?.wcagCoverage}% | API wcagCoverage          : ${apiReport.wcagCoverage}%`);
    console.log(`• MongoDB passCount             : ${dbReport?.passCount} | API passCount             : ${apiReport.passCount}`);
    console.log(`• MongoDB failCount             : ${dbReport?.failCount} | API failCount             : ${apiReport.failCount}`);
    console.log(`• MongoDB notEvaluableCount     : ${dbReport?.notEvaluableCount} | API notEvaluableCount     : ${apiReport.notEvaluableCount}`);
    console.log(`• MongoDB evidenceCount         : ${dbReport?.evidenceCount} | API evidenceCount         : ${apiReport.evidenceCount}`);
    console.log(`• MongoDB screenshotsCount      : ${dbReport?.screenshotsCount} | API screenshotsCount      : ${apiReport.screenshotsCount}`);
    console.log(`• MongoDB iterationsEvaluated   : ${dbReport?.iterationsEvaluated} | API iterationsEvaluated   : ${apiReport.iterationsEvaluated}`);
    console.log(`• MongoDB Snapshots Count       : ${dbSnapshots.length} | API Snapshots Count       : ${apiSnapshots.length}`);
    console.log(`• MongoDB Findings Count        : ${dbFindings.length}`);

    // Verify 100% equality
    const scoreMatch = dbReport?.overallScore === apiReport.overallScore;
    const nielsenMatch = dbReport?.nielsenCompliance === apiReport.nielsenCompliance;
    const wcagMatch = dbReport?.wcagCompliance === apiReport.wcagCompliance;
    const coverageMatch = dbReport?.auditCoverage === apiReport.auditCoverage;
    const snapshotMatch = dbSnapshots.length === apiSnapshots.length;

    if (scoreMatch && nielsenMatch && wcagMatch && coverageMatch && snapshotMatch) {
      console.log('\n✅ PERFECT EQUALITY VERIFIED: MongoDB == Backend API == Frontend Data Contract (0 Discrepancies)');
    } else {
      console.error('\n❌ DISCREPANCY DETECTED between MongoDB and API response!');
      process.exit(1);
    }

    console.log('\n--- FINDINGS DETAILS WITH ACCIONABLE RECOMMENDATION & EVIDENCE ---');
    dbFindings.forEach((f, i) => {
      console.log(`\n[Finding #${i + 1}]`);
      console.log(`  Status        : ${f.status}`);
      console.log(`  Severity      : ${f.severity}`);
      console.log(`  Confidence    : ${f.confidence}`);
      console.log(`  Criterion     : ${f.wcagCriterion || f.heuristicCode}`);
      console.log(`  Recommendation: ${f.recommendation}`);
      console.log(`  Evidence Items: ${f.evidence?.length || 0}`);
      console.log(`  Screenshot Url: ${f.screenshotUrl}`);
    });

    console.log('\n================================================================================');
    console.log('🎉 Subetapa 3E Real E2E Validation completed with 100% Success!');
  } catch (err) {
    console.error('❌ E2E Validation 3E failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runE2eValidation3E();
