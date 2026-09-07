export const POLICY_FEATURE_NAMES = [
  'rushDemand',
  'aisleClosure',
  'closureIntensity',
  'closureEarlyness',
  'hotZoneShare',
  'urgentShare',
  'meanDeadlineSlack',
  'peakDemandShare',
] as const;

export type PolicyFeatureName = (typeof POLICY_FEATURE_NAMES)[number];

export type PolicyFeatures = Record<PolicyFeatureName, number>;

export function featureVector(features: PolicyFeatures) {
  return POLICY_FEATURE_NAMES.map((name) => features[name]);
}
