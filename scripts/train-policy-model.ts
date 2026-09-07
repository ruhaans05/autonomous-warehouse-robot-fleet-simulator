import { writeFileSync } from 'node:fs';
import { POLICY_FEATURE_NAMES, featureVector, type PolicyFeatures } from '../app/lib/policy-features';
import { describeSeededEpisode, runSeededExperiment, type ScaleScenarioId, type ScaleStrategy } from '../app/lib/scale-benchmark';
import type { PolicyModelReport } from '../app/lib/policy-model';

const STRATEGIES: ScaleStrategy[] = ['balanced', 'nearest', 'deadline', 'congestion'];
const SCENARIOS: ScaleScenarioId[] = ['rush-demand', 'aisle-closure', 'high-congestion'];
const SEED_COUNT = 60;
const RIDGE_PENALTY = 0.001;

type Episode = {
  scenario: ScaleScenarioId;
  features: PolicyFeatures;
  utilityByStrategy: Record<ScaleStrategy, number>;
};

function utility(result: ReturnType<typeof runSeededExperiment>) {
  return result.completedOrders * 10 - result.p95Latency * 0.8 - result.congestion * 0.2;
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < augmented.length; column += 1) {
    const pivot = augmented.slice(column).reduce(
      (best, row, offset) => Math.abs(row[column]) > Math.abs(augmented[best][column]) ? column + offset : best,
      column,
    );
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 0.0000001) throw new Error('Policy model feature matrix is singular.');
    for (let index = column; index < augmented[column].length; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < augmented.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index < augmented[row].length; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[row.length - 1]);
}

function normalizeFeatures(episodes: Episode[]) {
  const vectors = episodes.map((episode) => featureVector(episode.features));
  const mean = POLICY_FEATURE_NAMES.map((_, index) => vectors.reduce((total, vector) => total + vector[index], 0) / vectors.length);
  const std = mean.map((average, index) => {
    const variance = vectors.reduce((total, vector) => total + (vector[index] - average) ** 2, 0) / vectors.length;
    return Math.max(Math.sqrt(variance), 0.0001);
  });
  return { mean, std };
}

function normalizedVector(features: PolicyFeatures, normalization: ReturnType<typeof normalizeFeatures>) {
  return [1, ...featureVector(features).map((value, index) => (value - normalization.mean[index]) / normalization.std[index])];
}

function fitRidge(episodes: Episode[], strategy: ScaleStrategy, normalization: ReturnType<typeof normalizeFeatures>) {
  const dimensions = POLICY_FEATURE_NAMES.length + 1;
  const gram = Array.from({ length: dimensions }, (_, row) =>
    Array.from({ length: dimensions }, (_, column) => row === column && row !== 0 ? RIDGE_PENALTY : 0),
  );
  const target = Array.from({ length: dimensions }, () => 0);
  for (const episode of episodes) {
    const vector = normalizedVector(episode.features, normalization);
    for (let row = 0; row < dimensions; row += 1) {
      target[row] += vector[row] * episode.utilityByStrategy[strategy];
      for (let column = 0; column < dimensions; column += 1) gram[row][column] += vector[row] * vector[column];
    }
  }
  return solveLinearSystem(gram, target);
}

function score(weights: number[], features: PolicyFeatures, normalization: ReturnType<typeof normalizeFeatures>) {
  return weights.reduce((total, weight, index) => total + weight * normalizedVector(features, normalization)[index], 0);
}

function bestStrategy(values: Record<ScaleStrategy, number>) {
  return STRATEGIES.reduce((winner, strategy) => values[strategy] > values[winner] ? strategy : winner, STRATEGIES[0]);
}

const episodes: Episode[] = [];
for (const scenario of SCENARIOS) {
  for (let seed = 1; seed <= SEED_COUNT; seed += 1) {
    const utilityByStrategy = Object.fromEntries(
      STRATEGIES.map((strategy) => [strategy, utility(runSeededExperiment(strategy, scenario, seed))]),
    ) as Record<ScaleStrategy, number>;
    episodes.push({ scenario, features: describeSeededEpisode(seed, scenario), utilityByStrategy });
  }
}

const training = episodes.filter((_, index) => (index % 5) !== 4);
const holdout = episodes.filter((_, index) => (index % 5) === 4);
const normalization = normalizeFeatures(training);
const weights = Object.fromEntries(
  STRATEGIES.map((strategy) => [strategy, fitRidge(training, strategy, normalization)]),
) as Record<ScaleStrategy, number[]>;

const residuals = holdout.flatMap((episode) => STRATEGIES.map((strategy) =>
  Math.abs(score(weights[strategy], episode.features, normalization) - episode.utilityByStrategy[strategy]),
));
const correctSelections = holdout.filter((episode) => {
  const predicted = bestStrategy(Object.fromEntries(
    STRATEGIES.map((strategy) => [strategy, score(weights[strategy], episode.features, normalization)]),
  ) as Record<ScaleStrategy, number>);
  return predicted === bestStrategy(episode.utilityByStrategy);
}).length;
const selectionCounts = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, 0])) as Record<ScaleStrategy, number>;
for (const episode of holdout) selectionCounts[bestStrategy(episode.utilityByStrategy)] += 1;
const regimeSelections = SCENARIOS.map((scenario) => {
  const regimeHoldout = holdout.filter((episode) => episode.scenario === scenario);
  const averageUtilities = (selector: (episode: Episode, strategy: ScaleStrategy) => number) =>
    Object.fromEntries(STRATEGIES.map((strategy) => [
      strategy,
      regimeHoldout.reduce((total, episode) => total + selector(episode, strategy), 0) / regimeHoldout.length,
    ])) as Record<ScaleStrategy, number>;
  const predicted = bestStrategy(averageUtilities((episode, strategy) => score(weights[strategy], episode.features, normalization)));
  const observed = bestStrategy(averageUtilities((episode, strategy) => episode.utilityByStrategy[strategy]));
  return { scenario, predicted, observed };
});

const report: PolicyModelReport = {
  algorithm: 'Ridge regression policy scorer',
  objective: '10 x completed orders - 0.8 x p95 latency - 0.2 x congestion',
  featureNames: [...POLICY_FEATURE_NAMES],
  trainingEpisodes: training.length,
  holdoutEpisodes: holdout.length,
  holdoutMeanAbsoluteError: Math.round((residuals.reduce((total, value) => total + value, 0) / residuals.length) * 100) / 100,
  holdoutSelectionAccuracy: Math.round((correctSelections / holdout.length) * 1000) / 10,
  holdoutSelectionCounts: selectionCounts,
  holdoutRegimeSelectionAccuracy: Math.round((regimeSelections.filter((selection) => selection.predicted === selection.observed).length / regimeSelections.length) * 1000) / 10,
  holdoutRegimeSelections: regimeSelections,
  normalization,
  weights,
};

console.log(JSON.stringify(report, null, 2));
writeFileSync(
  new URL('../app/data/policy-model-report.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
