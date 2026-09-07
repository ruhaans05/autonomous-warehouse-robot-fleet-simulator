import { featureVector, type PolicyFeatures } from './policy-features';

export type PolicyStrategy = 'balanced' | 'nearest' | 'deadline' | 'congestion';

export type PolicyModelReport = {
  algorithm: string;
  objective: string;
  featureNames: string[];
  trainingEpisodes: number;
  holdoutEpisodes: number;
  holdoutMeanAbsoluteError: number;
  holdoutSelectionAccuracy: number;
  holdoutSelectionCounts?: Partial<Record<PolicyStrategy, number>>;
  holdoutRegimeSelectionAccuracy?: number;
  holdoutRegimeSelections?: Array<{
    scenario: string;
    predicted: PolicyStrategy;
    observed: PolicyStrategy;
  }>;
  normalization: {
    mean: number[];
    std: number[];
  };
  weights: Record<PolicyStrategy, number[]>;
};

export type PolicyPrediction = {
  strategy: PolicyStrategy;
  score: number;
};

export function predictPolicies(model: PolicyModelReport, features: PolicyFeatures) {
  const normalized = featureVector(features).map(
    (value, index) => (value - model.normalization.mean[index]) / Math.max(model.normalization.std[index], 0.0001),
  );
  const vector = [1, ...normalized];
  const predictions = (Object.keys(model.weights) as PolicyStrategy[])
    .map((strategy) => ({
      strategy,
      score: model.weights[strategy].reduce((total, weight, index) => total + weight * vector[index], 0),
    }))
    .sort((a, b) => b.score - a.score);
  const margin = predictions[0].score - predictions[1].score;

  return { predictions, recommended: predictions[0], margin };
}
