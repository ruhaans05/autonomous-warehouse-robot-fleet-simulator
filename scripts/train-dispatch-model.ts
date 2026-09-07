import { writeFileSync } from 'node:fs';
import { DISPATCH_FEATURE_NAMES, dispatchFeatureVector, type DispatchFeatures } from '../app/lib/dispatch-features';
import { createDispatchTrainingExamples, type ScaleScenarioId } from '../app/lib/scale-benchmark';
import type { DispatchModelReport } from '../app/lib/dispatch-model';

const SCENARIOS: ScaleScenarioId[] = ['rush-demand', 'aisle-closure', 'high-congestion'];
const SEED_COUNT = 60;
const RIDGE_PENALTY = 0.000001;

type TrainingExample = {
  features: DispatchFeatures;
  target: number;
  group: string;
};

function solveLinearSystem(matrix: number[][], values: number[]) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < augmented.length; column += 1) {
    const pivot = augmented.slice(column).reduce(
      (best, row, offset) => Math.abs(row[column]) > Math.abs(augmented[best][column]) ? column + offset : best,
      column,
    );
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 0.0000001) throw new Error('Dispatch model feature matrix is singular.');
    for (let index = column; index < augmented[column].length; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < augmented.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index < augmented[row].length; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[row.length - 1]);
}

function normalize(examples: TrainingExample[]) {
  const vectors = examples.map((example) => dispatchFeatureVector(example.features));
  const mean = DISPATCH_FEATURE_NAMES.map((_, index) => vectors.reduce((total, vector) => total + vector[index], 0) / vectors.length);
  const std = mean.map((average, index) => Math.max(
    Math.sqrt(vectors.reduce((total, vector) => total + (vector[index] - average) ** 2, 0) / vectors.length),
    0.0001,
  ));
  return { mean, std };
}

function vector(features: DispatchFeatures, normalization: ReturnType<typeof normalize>) {
  return [1, ...dispatchFeatureVector(features).map((value, index) => (value - normalization.mean[index]) / normalization.std[index])];
}

function fit(examples: TrainingExample[], normalization: ReturnType<typeof normalize>) {
  const dimensions = DISPATCH_FEATURE_NAMES.length + 1;
  const gram = Array.from({ length: dimensions }, (_, row) =>
    Array.from({ length: dimensions }, (_, column) => row === column && row !== 0 ? RIDGE_PENALTY : 0),
  );
  const target = Array.from({ length: dimensions }, () => 0);
  for (const example of examples) {
    const values = vector(example.features, normalization);
    for (let row = 0; row < dimensions; row += 1) {
      target[row] += values[row] * example.target;
      for (let column = 0; column < dimensions; column += 1) gram[row][column] += values[row] * values[column];
    }
  }
  return solveLinearSystem(gram, target);
}

function predict(weights: number[], features: DispatchFeatures, normalization: ReturnType<typeof normalize>) {
  return weights.reduce((total, weight, index) => total + weight * vector(features, normalization)[index], 0);
}

const examples = SCENARIOS.flatMap((scenario) =>
  Array.from({ length: SEED_COUNT }, (_, index) => ({ scenario, seed: index + 1 })),
).flatMap(({ scenario, seed }) => createDispatchTrainingExamples(seed, scenario));
const seedForGroup = (group: string) => Number(group.split('-').at(-2));
const training = examples.filter((example) => seedForGroup(example.group) % 5 !== 0);
const holdout = examples.filter((example) => seedForGroup(example.group) % 5 === 0);
const normalization = normalize(training);
const weights = fit(training, normalization);
const meanAbsoluteError = holdout.reduce(
  (total, example) => total + Math.abs(predict(weights, example.features, normalization) - example.target),
  0,
) / holdout.length;
const groups = new Map<string, TrainingExample[]>();
for (const example of holdout) groups.set(example.group, [...(groups.get(example.group) ?? []), example]);
const rankingAgreement = Array.from(groups.values()).filter((group) => {
  const teacherChoice = group.reduce((winner, example) => example.target < winner.target ? example : winner, group[0]);
  const learnedChoice = group.reduce((winner, example) =>
    predict(weights, example.features, normalization) < predict(weights, winner.features, normalization) ? example : winner,
  group[0]);
  return teacherChoice === learnedChoice;
}).length / groups.size;

const report: DispatchModelReport = {
  algorithm: 'Ridge-regression dispatch policy distillation',
  teacherPolicy: 'Traffic-aware congestion heuristic',
  featureNames: [...DISPATCH_FEATURE_NAMES],
  trainingExamples: training.length,
  holdoutExamples: holdout.length,
  holdoutMeanAbsoluteError: Math.round(meanAbsoluteError * 1000000) / 1000000,
  holdoutRankingAgreement: Math.round(rankingAgreement * 1000) / 10,
  normalization,
  weights,
};

console.log(JSON.stringify(report, null, 2));
writeFileSync(
  new URL('../app/data/dispatch-model-report.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
