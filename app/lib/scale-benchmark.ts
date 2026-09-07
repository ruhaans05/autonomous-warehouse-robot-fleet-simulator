import { learnedDispatchScore } from './dispatch-model';
import { trafficAwareScore, type DispatchFeatures } from './dispatch-features';

export type ScaleStrategy = 'balanced' | 'nearest' | 'deadline' | 'congestion' | 'learned';
export type ScaleScenarioId = 'rush-demand' | 'aisle-closure' | 'high-congestion';

type Robot = {
  id: number;
  pos: number;
  taskId?: number;
  stage: 'idle' | 'pick' | 'drop';
  path: number[];
  planned: number;
  traveled: number;
  waiting: number;
};

type Order = {
  id: number;
  pick: number;
  drop: number;
  priority: number;
  deadline: number;
  state: 'queued' | 'assigned' | 'picked' | 'complete';
  createdAt: number;
  completedAt?: number;
  blockedAt?: number;
  recoveredAt?: number;
};

export type BenchmarkResult = {
  strategy: ScaleStrategy;
  scenario: ScaleScenarioId;
  seed: number;
  completedOrders: number;
  completionRate: number;
  collisionCount: number;
  recoveryRate: number;
  p95Latency: number;
  congestion: number;
  replans: number;
};

export type BenchmarkSummary = {
  runs: number;
  robotCount: number;
  orderCount: number;
  zeroCollisionRuns: number;
  recoveryRate: number;
  congestionCompletedOrders: number;
  learnedCompletedOrders: number;
  nearestCompletedOrders: number;
  completionLift: number;
  congestionP95Latency: number;
  deadlineP95Latency: number;
  p95Reduction: number;
  strategies: Array<{
    strategy: ScaleStrategy;
    completedOrders: number;
    p95Latency: number;
    recoveryRate: number;
    collisionCount: number;
  }>;
};

const WIDTH = 16;
const HEIGHT = 12;
const CELL_COUNT = WIDTH * HEIGHT;
const ROBOT_COUNT = 50;
const ORDER_COUNT = 500;
const HORIZON = 110;
const STATIONS = [indexOf(14, 2), indexOf(14, 5), indexOf(14, 9)];
const STATIC_BLOCKS = new Set(
  [3, 6, 9, 12].flatMap((x) => [1, 2, 3, 5, 6, 8, 9, 10].map((y) => indexOf(x, y))),
);

const SCENARIOS: Record<ScaleScenarioId, { closureTick: number; closureCells: number[]; hotZone: number[] }> = {
  'rush-demand': {
    closureTick: 44,
    closureCells: [indexOf(8, 5), indexOf(10, 8), indexOf(11, 7)],
    hotZone: [indexOf(7, 4), indexOf(8, 4), indexOf(7, 7), indexOf(8, 7)],
  },
  'aisle-closure': {
    closureTick: 36,
    closureCells: [indexOf(4, 4), indexOf(5, 4), indexOf(8, 5), indexOf(10, 8), indexOf(11, 7), indexOf(13, 6)],
    hotZone: [indexOf(4, 7), indexOf(5, 7), indexOf(7, 4), indexOf(8, 4)],
  },
  'high-congestion': {
    closureTick: 30,
    closureCells: [indexOf(4, 6), indexOf(7, 6), indexOf(10, 6), indexOf(13, 6), indexOf(8, 5)],
    hotZone: [indexOf(7, 4), indexOf(8, 4), indexOf(7, 7), indexOf(8, 7), indexOf(10, 4)],
  },
};

function indexOf(x: number, y: number) {
  return y * WIDTH + x;
}

function pointOf(cell: number) {
  return { x: cell % WIDTH, y: Math.floor(cell / WIDTH) };
}

function distance(a: number, b: number) {
  const first = pointOf(a);
  const second = pointOf(b);
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

function createRng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const OPEN_CELLS = Array.from({ length: CELL_COUNT }, (_, cell) => cell).filter(
  (cell) => !STATIC_BLOCKS.has(cell) && !STATIONS.includes(cell),
);
const START_CELLS = OPEN_CELLS.filter((cell) => {
  const { x } = pointOf(cell);
  return [0, 1, 2, 13, 14, 15].includes(x);
});

function neighbors(cell: number) {
  const { x, y } = pointOf(cell);
  return [
    x > 0 ? indexOf(x - 1, y) : -1,
    x < WIDTH - 1 ? indexOf(x + 1, y) : -1,
    y > 0 ? indexOf(x, y - 1) : -1,
    y < HEIGHT - 1 ? indexOf(x, y + 1) : -1,
  ].filter((next) => next >= 0);
}

function findPath(start: number, goal: number, blocks: Set<number>) {
  if (start === goal) return [];
  const queue = [start];
  const from = new Int16Array(CELL_COUNT).fill(-2);
  from[start] = -1;
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (current === goal) break;
    for (const next of neighbors(current)) {
      if (blocks.has(next) || from[next] !== -2) continue;
      from[next] = current;
      queue.push(next);
    }
  }

  if (from[goal] === -2) return null;
  const path: number[] = [];
  let current = goal;
  while (current !== start) {
    path.unshift(current);
    current = from[current];
  }
  return path;
}

function createRobots(seed: number) {
  const rng = createRng(seed * 17 + 3);
  const available = [...START_CELLS];
  const robots: Robot[] = [];
  for (let id = 0; id < ROBOT_COUNT; id += 1) {
    const selection = Math.floor(rng() * available.length);
    const pos = available.splice(selection, 1)[0];
    robots.push({ id, pos, stage: 'idle', path: [], planned: 0, traveled: 0, waiting: 0 });
  }
  return robots;
}

function createOrders(seed: number, scenario: ScaleScenarioId) {
  const config = SCENARIOS[scenario];
  const rng = createRng(seed * 101 + 11);
  const validPickCells = OPEN_CELLS.filter((cell) => !config.closureCells.includes(cell));
  return Array.from({ length: ORDER_COUNT }, (_, id): Order => {
    const pick = rng() < 0.42
      ? config.hotZone[Math.floor(rng() * config.hotZone.length)]
      : validPickCells[Math.floor(rng() * validPickCells.length)];
    const priority = rng() < 0.28 ? 3 : rng() < 0.62 ? 2 : 1;
    return {
      id,
      pick,
      drop: STATIONS[Math.floor(rng() * STATIONS.length)],
      priority,
      deadline: 52 + Math.floor(rng() * 48) - priority * 8,
      state: 'queued',
      createdAt: 0,
    };
  });
}

function localDemand(cell: number, demandByCell: Map<number, number>, blocks: Set<number>) {
  const nearbyDemand = Array.from(demandByCell.entries()).reduce(
    (total, [pick, count]) => total + (distance(cell, pick) <= 2 ? count : 0),
    0,
  );
  return nearbyDemand + neighbors(cell).filter((neighbor) => blocks.has(neighbor)).length * 7;
}

function dispatchFeatures(robot: Robot, order: Order, tick: number, density: number): DispatchFeatures {
  return {
    pickupDistance: distance(robot.pos, order.pick),
    dropDistance: distance(order.pick, order.drop),
    localDemand: density,
    urgency: Math.max(0, order.deadline - tick),
    priority: order.priority,
  };
}

export function createDispatchTrainingExamples(seed: number, scenario: ScaleScenarioId) {
  const robots = createRobots(seed);
  const orders = createOrders(seed, scenario);
  const demandByCell = new Map<number, number>();
  for (const order of orders) demandByCell.set(order.pick, (demandByCell.get(order.pick) ?? 0) + 1);
  const densityByCell = new Map(
    Array.from(demandByCell.keys()).map((cell) => [cell, localDemand(cell, demandByCell, STATIC_BLOCKS)]),
  );
  return robots.flatMap((robot) =>
    Array.from({ length: 10 }, (_, offset) => {
      const order = orders[(robot.id * 37 + offset * 41 + seed) % orders.length];
      const features = dispatchFeatures(robot, order, 0, densityByCell.get(order.pick) ?? 0);
      return { features, target: trafficAwareScore(features), group: `${scenario}-${seed}-${robot.id}` };
    }),
  );
}

function selectOrder(robot: Robot, orders: Order[], strategy: ScaleStrategy, tick: number, densityByCell: Map<number, number>) {
  let selected: Order | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const order of orders) {
    if (order.state !== 'queued') continue;
    const density = densityByCell.get(order.pick) ?? 0;
    const features = dispatchFeatures(robot, order, tick, density);
    const { pickupDistance, urgency } = features;
    const score = strategy === 'nearest'
      ? pickupDistance - order.priority * 0.2
      : strategy === 'deadline'
        ? urgency * 0.85 + pickupDistance * 0.35 - order.priority * 9
        : strategy === 'congestion'
          ? trafficAwareScore(features)
          : strategy === 'learned'
            ? learnedDispatchScore(features)
          : pickupDistance * 0.55 + urgency * 0.26 + density * 0.48 - order.priority * 4;
    if (score < bestScore || (score === bestScore && order.id < (selected?.id ?? Infinity))) {
      selected = order;
      bestScore = score;
    }
  }
  return selected;
}

function assignOrders(robots: Robot[], orders: Order[], strategy: ScaleStrategy, tick: number, blocks: Set<number>) {
  const demandByCell = new Map<number, number>();
  for (const order of orders) {
    if (order.state === 'queued') demandByCell.set(order.pick, (demandByCell.get(order.pick) ?? 0) + 1);
  }
  const densityByCell = new Map(
    Array.from(demandByCell.keys()).map((cell) => [cell, localDemand(cell, demandByCell, blocks)]),
  );
  for (const robot of robots) {
    if (robot.stage !== 'idle') continue;
    const order = selectOrder(robot, orders, strategy, tick, densityByCell);
    if (!order) continue;
    const path = findPath(robot.pos, order.pick, blocks);
    if (!path) continue;
    order.state = 'assigned';
    demandByCell.set(order.pick, Math.max(0, (demandByCell.get(order.pick) ?? 1) - 1));
    robot.taskId = order.id;
    robot.stage = 'pick';
    robot.path = path;
    robot.planned += path.length;
  }
}

function percentile95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function runSeededExperiment(strategy: ScaleStrategy, scenario: ScaleScenarioId, seed: number): BenchmarkResult {
  const config = SCENARIOS[scenario];
  const robots = createRobots(seed);
  const orders = createOrders(seed, scenario);
  const blocks = new Set(STATIC_BLOCKS);
  let collisionCount = 0;
  let replans = 0;

  for (let tick = 0; tick < HORIZON; tick += 1) {
    if (tick === config.closureTick) {
      for (const closure of config.closureCells) blocks.add(closure);
      for (const robot of robots) {
        if (robot.stage === 'idle' || !robot.taskId || !robot.path.some((cell) => config.closureCells.includes(cell))) continue;
        const order = orders[robot.taskId];
        order.blockedAt = tick;
        const target = robot.stage === 'pick' ? order.pick : order.drop;
        const replacement = findPath(robot.pos, target, blocks);
        replans += 1;
        if (replacement) {
          robot.path = replacement;
          robot.planned += replacement.length;
          order.recoveredAt = tick;
        }
      }
    }

    assignOrders(robots, orders, strategy, tick, blocks);
    const reservations = new Map<number, Robot[]>();
    for (const robot of robots) {
      if (robot.stage === 'idle' || !robot.path.length) continue;
      const next = robot.path[0];
      reservations.set(next, [...(reservations.get(next) ?? []), robot]);
    }

    const occupied = new Map(robots.map((robot) => [robot.pos, robot]));
    const winningMoves = new Map<number, number>();
    for (const [target, contenders] of reservations) {
      const winner = contenders.sort((a, b) => a.path.length - b.path.length || a.id - b.id)[0];
      winningMoves.set(winner.id, target);
    }
    const resolution = new Map<number, boolean>();
    const canMove = (robot: Robot, visiting = new Set<number>()): boolean => {
      const cached = resolution.get(robot.id);
      if (cached !== undefined) return cached;
      const target = winningMoves.get(robot.id);
      if (target === undefined) return false;
      const occupant = occupied.get(target);
      if (!occupant) {
        resolution.set(robot.id, true);
        return true;
      }
      if (visiting.has(robot.id)) {
        return visiting.size > 2;
      }
      visiting.add(robot.id);
      const movable = canMove(occupant, visiting);
      visiting.delete(robot.id);
      resolution.set(robot.id, movable);
      return movable;
    };
    for (const robot of robots) {
      if (robot.stage === 'idle' || !robot.path.length) continue;
      const next = robot.path[0];
      if (!canMove(robot)) {
        robot.waiting += 1;
        if (robot.waiting % 4 === 0) {
          const order = orders[robot.taskId!];
          const target = robot.stage === 'pick' ? order.pick : order.drop;
          const softBlocks = new Set(blocks);
          for (const other of robots) {
            if (other.id !== robot.id && other.pos !== target) softBlocks.add(other.pos);
          }
          const alternate = findPath(robot.pos, target, softBlocks);
          if (alternate && alternate.length && alternate[0] !== next) {
            robot.path = alternate;
            robot.planned += alternate.length;
            replans += 1;
          }
        }
        continue;
      }

      robot.pos = next;
      robot.path = robot.path.slice(1);
      robot.traveled += 1;
      robot.waiting = 0;

      const order = orders[robot.taskId!];
      const target = robot.stage === 'pick' ? order.pick : order.drop;
      if (robot.pos !== target) continue;
      if (robot.stage === 'pick') {
        order.state = 'picked';
        const dropPath = findPath(robot.pos, order.drop, blocks);
        if (!dropPath) {
          robot.waiting += 1;
          continue;
        }
        robot.stage = 'drop';
        robot.path = dropPath;
        robot.planned += dropPath.length;
      } else {
        order.state = 'complete';
        order.completedAt = tick;
        robot.stage = 'idle';
        robot.taskId = undefined;
        robot.path = [];
      }
    }

    const positions = new Set(robots.map((robot) => robot.pos));
    if (positions.size !== robots.length) {
      const duplicates = robots
        .filter((robot, index, values) => values.findIndex((candidate) => candidate.pos === robot.pos) !== index)
        .map((robot) => `${robot.id}@${robot.pos}`);
      throw new Error(`Collision at tick ${tick}: ${duplicates.join(',')}`);
    }
    collisionCount += robots.length - positions.size;
  }

  const completed = orders.filter((order) => order.state === 'complete');
  const blocked = orders.filter((order) => order.blockedAt !== undefined);
  const recovered = blocked.filter((order) => order.recoveredAt !== undefined && order.recoveredAt! - order.blockedAt! <= 10);
  const waiting = robots.reduce((sum, robot) => sum + robot.waiting, 0);
  return {
    strategy,
    scenario,
    seed,
    completedOrders: completed.length,
    completionRate: Math.round((completed.length / ORDER_COUNT) * 1000) / 10,
    collisionCount,
    recoveryRate: blocked.length ? Math.round((recovered.length / blocked.length) * 1000) / 10 : 100,
    p95Latency: percentile95(completed.map((order) => order.completedAt! - order.createdAt)),
    congestion: Math.round((waiting / Math.max(1, HORIZON * ROBOT_COUNT)) * 1000) / 10,
    replans,
  };
}

function average(results: BenchmarkResult[], field: keyof Pick<BenchmarkResult, 'completedOrders' | 'recoveryRate' | 'p95Latency' | 'collisionCount'>) {
  return results.reduce((total, result) => total + result[field], 0) / Math.max(results.length, 1);
}

export function runBenchmarkSuite(runCount = 100): BenchmarkSummary {
  const strategies: ScaleStrategy[] = ['balanced', 'nearest', 'deadline', 'congestion', 'learned'];
  const scenarios: ScaleScenarioId[] = ['rush-demand', 'aisle-closure', 'high-congestion'];
  const results = strategies.flatMap((strategy) =>
    Array.from({ length: runCount }, (_, index) => runSeededExperiment(strategy, scenarios[index % scenarios.length], index + 1)),
  );
  const aggregate = (strategy: ScaleStrategy) => results.filter((result) => result.strategy === strategy);
  const congestion = aggregate('congestion');
  const learned = aggregate('learned');
  const nearest = aggregate('nearest');
  const deadline = aggregate('deadline');
  const completionLift = ((average(learned, 'completedOrders') - average(nearest, 'completedOrders')) / Math.max(average(nearest, 'completedOrders'), 1)) * 100;
  const p95Reduction = ((average(deadline, 'p95Latency') - average(learned, 'p95Latency')) / Math.max(average(deadline, 'p95Latency'), 1)) * 100;

  return {
    runs: runCount,
    robotCount: ROBOT_COUNT,
    orderCount: ORDER_COUNT,
    zeroCollisionRuns: results.filter((result) => result.collisionCount === 0).length,
    recoveryRate: Math.round(average(congestion, 'recoveryRate') * 10) / 10,
    congestionCompletedOrders: Math.round(average(congestion, 'completedOrders') * 10) / 10,
    learnedCompletedOrders: Math.round(average(learned, 'completedOrders') * 10) / 10,
    nearestCompletedOrders: Math.round(average(nearest, 'completedOrders') * 10) / 10,
    completionLift: Math.round(completionLift * 10) / 10,
    congestionP95Latency: Math.round(average(learned, 'p95Latency') * 10) / 10,
    deadlineP95Latency: Math.round(average(deadline, 'p95Latency') * 10) / 10,
    p95Reduction: Math.round(p95Reduction * 10) / 10,
    strategies: strategies.map((strategy) => {
      const group = aggregate(strategy);
      return {
        strategy,
        completedOrders: Math.round(average(group, 'completedOrders') * 10) / 10,
        p95Latency: Math.round(average(group, 'p95Latency') * 10) / 10,
        recoveryRate: Math.round(average(group, 'recoveryRate') * 10) / 10,
        collisionCount: Math.round(average(group, 'collisionCount') * 10) / 10,
      };
    }),
  };
}
