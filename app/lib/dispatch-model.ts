import report from '../data/dispatch-model-report.json';
import { dispatchFeatureVector, type DispatchFeatures } from './dispatch-features';

export type DispatchModelReport = {
  algorithm: string;
  teacherPolicy: string;
  featureNames: string[];
  trainingExamples: number;
  holdoutExamples: number;
  holdoutMeanAbsoluteError: number;
  holdoutRankingAgreement: number;
  normalization: { mean: number[]; std: number[] };
  weights: number[];
};

export const dispatchModelReport = report as DispatchModelReport;

export function learnedDispatchScore(features: DispatchFeatures) {
  const normalized = dispatchFeatureVector(features).map(
    (value, index) => (value - dispatchModelReport.normalization.mean[index]) / Math.max(dispatchModelReport.normalization.std[index], 0.0001),
  );
  return dispatchModelReport.weights.reduce(
    (total, weight, index) => total + weight * (index === 0 ? 1 : normalized[index - 1]),
    0,
  );
}
