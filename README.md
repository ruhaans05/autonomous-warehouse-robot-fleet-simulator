# Autonomous Warehouse Robot Fleet Simulator

Modern fulfillment centers succeed or fail on coordination: a locally sensible robot decision can turn into blocked aisles, missed order windows, and cascading delays once dozens of robots share the same floor. This project is a deterministic warehouse digital twin for testing that coordination layer before it reaches a live fleet.

It models the decisions that turn a task queue into reliable physical execution: dispatching work across competing robots, reserving moves, preventing collisions, rerouting around aisle closures, and proving with repeatable evaluation whether a policy improves throughput or latency. The checked-in scale harness runs 50 robots against 500-order waves over 100 fixed seeds, so changes are judged by measured outcomes rather than a single attractive playback.

The browser app is a control-room style simulator. You can add orders, block an aisle, switch dispatch policies, pause the fleet, and export a run report.

## Try it

- Live demo: https://autonomous-warehouse-robot-fleet-simulator.srazz05.chatgpt.site
- Screenshot walkthrough: [DEMO.md](./DEMO.md)

## Run it locally

You only need a recent version of Node.js (22 or newer) and a terminal.

1. Download or clone this repository.
2. In the project folder, install the packages:

```bash
npm install
```

3. Start the app:

```bash
npm run dev
```

4. Open the local URL printed in the terminal. It is usually http://localhost:3000.

For a quick first run, leave the **Baseline flow** scenario selected, click **Run**, then click **Block aisle** once the robots are moving. Try the dispatch buttons above the map to see how the routing choices differ. **Export run** downloads the current simulator state as JSON.

If another app is already using port 3000, start this app on a different port instead:

```bash
npm run dev -- --port 3001
```

## What is in the project

- A 16 x 12 warehouse grid with racks, pack stations, and temporary aisle closures.
- Pick-to-pack order state transitions: queued, assigned, picked, complete, and failed.
- Four dispatch policies: balanced, nearest-robot, deadline-first, and traffic-aware.
- BFS routing with a reservation pass that prevents two robots from claiming the same move.
- Safe chain movement for multi-robot traffic, while two-robot swaps are rejected.
- Deterministic rerouting when a closure intersects an active route.
- A readable 5-robot visual playback in the UI, plus a separate 50-robot scale harness for evaluation.
- Exportable JSON run reports for the interactive simulator.

## Scale benchmark

The benchmark is intentionally deterministic. Every run starts from a fixed seed, uses a 500-order wave, and introduces one of three disruption profiles: rush demand, aisle closure, or high congestion. This makes policy changes comparable instead of anecdotal.

```bash
npm run benchmark
```

That command runs 100 seed bundles for each of the four policies, writes the checked-in benchmark report used by the dashboard, and fails if the core guarantees regress.

Current verified results:

- 50 robots, 500 orders per wave, 100 seed bundles, and 400 policy/scenario runs.
- 400 of 400 runs completed without a position collision.
- 100% of routes affected by modeled aisle closures were rerouted within 10 simulation ticks.
- The traffic-aware policy completed 185% more orders than nearest-robot dispatch in the seeded workload.
- Traffic-aware dispatch had 64.3% lower p95 fulfillment latency than the deadline-first baseline.

Those policy comparisons are called out separately on purpose: nearest-robot is the throughput baseline, while deadline-first is the latency baseline for this workload.

## How it is organized

```text
app/page.tsx                   Interactive control-plane UI
app/lib/scale-benchmark.ts     Deterministic scale simulation and policy evaluator
app/data/benchmark-report.json Checked-in result from the benchmark command
scripts/run-benchmark.ts       Regression gate and report generator
```

## A few implementation notes

The visual layer is not pretending to be a physics engine. It is a discrete-time fleet model. Robots move one cell per tick, plan paths with BFS, submit their next cell to a reservation pass, and yield when a move is not safe. The scale harness keeps the same discrete model but runs it at a workload that would be too noisy to inspect on a single 192-cell map.

The natural-language task box is deliberately narrow. It turns a warehouse goal into a deterministic batch by extracting quantity and urgency; the routing and evaluation path remains inspectable and repeatable.

## Stack

TypeScript, React, Vinext/Vite, Tailwind CSS, lucide-react, and a small Node-based TypeScript benchmark runner.

## Next things I would build

- Move the scale harness to a Web Worker so users can launch custom experiments without blocking the UI.
- Add scenario files and a results history instead of keeping the latest report in the repository.
- Add a more sophisticated multi-agent planner such as cooperative A* or time-expanded reservations.
- Persist saved layouts and reports with a small database layer.
