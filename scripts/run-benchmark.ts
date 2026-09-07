import { runBenchmarkSuite } from '../app/lib/scale-benchmark';
import { writeFileSync } from 'node:fs';

const summary = runBenchmarkSuite(100);
console.log(JSON.stringify(summary, null, 2));

const expectedPolicyRuns = summary.runs * 5;

if (summary.zeroCollisionRuns !== expectedPolicyRuns) {
  throw new Error(`Expected ${expectedPolicyRuns} collision-free policy runs, received ${summary.zeroCollisionRuns}.`);
}

if (summary.recoveryRate < 95) {
  throw new Error(`Expected 95% recovery within 10 ticks, received ${summary.recoveryRate}%.`);
}

if (summary.completionLift < 25) {
  throw new Error(`Expected at least 25% traffic-aware completion lift, received ${summary.completionLift}%.`);
}

if (summary.p95Reduction < 30) {
  throw new Error(`Expected at least 30% p95 latency reduction, received ${summary.p95Reduction}%.`);
}

writeFileSync(
  new URL('../app/data/benchmark-report.json', import.meta.url),
  `${JSON.stringify(summary, null, 2)}\n`,
);
