export const DISPATCH_FEATURE_NAMES = [
  'pickupDistance',
  'dropDistance',
  'localDemand',
  'urgency',
  'priority',
] as const;

export type DispatchFeatureName = (typeof DISPATCH_FEATURE_NAMES)[number];
export type DispatchFeatures = Record<DispatchFeatureName, number>;

export function dispatchFeatureVector(features: DispatchFeatures) {
  return DISPATCH_FEATURE_NAMES.map((name) => features[name]);
}

export function trafficAwareScore(features: DispatchFeatures) {
  return features.pickupDistance * 0.42
    + features.dropDistance * 0.58
    + features.localDemand * 0.06
    + features.urgency * 0.03
    - features.priority * 7;
}
