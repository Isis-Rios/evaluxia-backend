import { Router } from 'express';
import { reportService } from './report.service';
import { authenticate } from '@/shared/middleware/authenticate.middleware';

const router = Router();

/**
 * GET /api/v1/reports/evaluation/:evaluationId
 * Retorna el reporte consolidado de una evaluación incluyendo las métricas reales de tokens y costos.
 */
router.get('/evaluation/:evaluationId', authenticate, async (req, res, next) => {
  try {
    const evaluationId = req.params.evaluationId as string;
    const report = await reportService.getReportForEvaluation(evaluationId);
    res.status(200).json({ status: 'success', data: report });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/reports/metrics/cumulative
 * Retorna el panel de métricas acumuladas del backend (costos en USD, tokens de entrada/salida y llamadas).
 */
router.get('/metrics/cumulative', authenticate, (_req, res) => {
  const metrics = reportService.getCumulativeMetrics();
  res.status(200).json({ status: 'success', data: metrics });
});

export { router as reportsRoutes };
