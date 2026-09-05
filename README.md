# Autonomous Warehouse Robot Fleet Simulator

A web-based simulator for multi-robot warehouse fulfillment. It models a fleet of autonomous robots assigning incoming orders, planning routes through a rack-heavy warehouse, avoiding collisions, reacting to blocked aisles, and reporting operational metrics in a dense robotics control-plane UI.

## What it demonstrates

- Multi-agent task assignment with selectable strategies: balanced, nearest-robot, and deadline-first.
- Grid-based path planning with static rack obstacles and dynamic aisle closures.
- Collision avoidance through movement proposals, reservation checks, robot yielding, and replanning.
- Order lifecycle tracking from queued to assigned, picked, packed, completed, or failed.
- Operational observability for throughput, route efficiency, congestion, utilization, recovery events, failed tasks, and average fulfillment latency.
- A lightweight AI planning layer that converts natural-language warehouse goals into deterministic task batches for repeatable simulation and evaluation.
- Policy evaluation snapshot for comparing fulfillment strategies and explaining optimization tradeoffs.

## Resume framing

Built a simulated multi-robot warehouse system where AI agents assign tasks, plan paths, avoid collisions, and optimize order fulfillment across dynamic layouts. Added evaluation metrics for throughput, congestion, route efficiency, robot utilization, task failure recovery, and average fulfillment latency.

## Tech stack

- TypeScript
- React
- Vinext / Vite
- Tailwind CSS
- lucide-react icons

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`.

## Core simulation model

The simulator keeps the core behavior deterministic and testable. Robots are assigned queued tasks based on the selected strategy, plan paths with grid search around blocked cells, reserve next moves, yield when collisions are detected, and replan when routes become invalid. Metrics are derived directly from simulation state rather than mocked.

## Suggested next extensions

- Add seeded scenario playback and exportable run reports.
- Add a dedicated test suite for pathfinding, assignment, and collision resolution.
- Persist scenario configurations and benchmark results.
- Add Web Worker simulation execution for faster policy comparisons.
- Add richer explainability for why a robot was assigned to a given task.
