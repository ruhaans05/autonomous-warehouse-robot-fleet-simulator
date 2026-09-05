'use client';

import {
  Activity,
  Bot,
  Boxes,
  Brain,
  Clock3,
  FastForward,
  Gauge,
  GitBranch,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  ShieldAlert,
  Sparkles,
  StepForward,
  TrafficCone,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Point = { x: number; y: number };
type Strategy = 'balanced' | 'nearest' | 'deadline';
type TaskStatus = 'queued' | 'assigned' | 'picked' | 'complete' | 'failed';
type RobotStatus = 'idle' | 'to-pick' | 'to-drop' | 'waiting' | 'replanning';

type Task = {
  id: string;
  pick: Point;
  drop: Point;
  createdAt: number;
  deadline: number;
  priority: number;
  status: TaskStatus;
  assignedTo?: string;
  pickedAt?: number;
  completedAt?: number;
  replans: number;
  distance: number;
};

type Robot = {
  id: string;
  label: string;
  color: string;
  pos: Point;
  home: Point;
  status: RobotStatus;
  taskId?: string;
  path: Point[];
  plannedDistance: number;
  traveled: number;
  waitingTicks: number;
  completed: number;
  replans: number;
};

type SimState = {
  tick: number;
  robots: Robot[];
  tasks: Task[];
  dynamicBlocks: Point[];
  failedTasks: number;
  collisionAvoidanceEvents: number;
  totalReplans: number;
};

const WIDTH = 16;
const HEIGHT = 12;
const PACK_STATIONS = [
  { x: 14, y: 2 },
  { x: 14, y: 5 },
  { x: 14, y: 9 },
];

const STATIC_BLOCKS = new Set(
  [
    ...rackColumn(3, [1, 2, 3, 5, 6, 8, 9, 10]),
    ...rackColumn(6, [1, 2, 3, 5, 6, 8, 9, 10]),
    ...rackColumn(9, [1, 2, 3, 5, 6, 8, 9, 10]),
    ...rackColumn(12, [1, 2, 3, 5, 6, 8, 9, 10]),
  ].map(key),
);

const INITIAL_ROBOTS: Robot[] = [
  makeRobot('R1', 'Atlas-01', '#14b8a6', { x: 1, y: 1 }),
  makeRobot('R2', 'Kiva-12', '#38bdf8', { x: 1, y: 4 }),
  makeRobot('R3', 'Vector-07', '#f59e0b', { x: 1, y: 7 }),
  makeRobot('R4', 'Scout-22', '#a78bfa', { x: 1, y: 10 }),
  makeRobot('R5', 'Mover-03', '#fb7185', { x: 5, y: 11 }),
];

function rackColumn(x: number, ys: number[]) {
  return ys.map((y) => ({ x, y }));
}

function key(point: Point) {
  return `${point.x},${point.y}`;
}

function same(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

function dist(a: Point, b: Point) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function makeRobot(id: string, label: string, color: string, home: Point): Robot {
  return {
    id,
    label,
    color,
    pos: home,
    home,
    status: 'idle',
    path: [],
    plannedDistance: 0,
    traveled: 0,
    waitingTicks: 0,
    completed: 0,
    replans: 0,
  };
}

function makeTask(index: number, tick: number, priority = 2): Task {
  const picks = [
    { x: 2, y: 2 },
    { x: 5, y: 1 },
    { x: 8, y: 3 },
    { x: 11, y: 6 },
    { x: 13, y: 10 },
    { x: 4, y: 9 },
    { x: 7, y: 8 },
    { x: 10, y: 1 },
    { x: 13, y: 3 },
    { x: 2, y: 10 },
  ];
  const pick = picks[index % picks.length];
  const drop = PACK_STATIONS[(index + priority) % PACK_STATIONS.length];
  return {
    id: `ORD-${String(index + 1).padStart(3, '0')}`,
    pick,
    drop,
    createdAt: tick,
    deadline: tick + 32 + (index % 5) * 6 - priority * 3,
    priority,
    status: 'queued',
    replans: 0,
    distance: dist(pick, drop),
  };
}

function createInitialState(): SimState {
  return {
    tick: 0,
    robots: INITIAL_ROBOTS,
    tasks: Array.from({ length: 8 }, (_, i) => makeTask(i, 0, (i % 3) + 1)),
    dynamicBlocks: [
      { x: 8, y: 5 },
      { x: 10, y: 8 },
    ],
    failedTasks: 0,
    collisionAvoidanceEvents: 0,
    totalReplans: 0,
  };
}

function pathfind(start: Point, goal: Point, blocks: Set<string>, robots: Point[]) {
  if (same(start, goal)) return [];
  const robotBlocks = new Set(robots.map(key));
  robotBlocks.delete(key(start));
  robotBlocks.delete(key(goal));

  const queue: Point[] = [start];
  const cameFrom = new Map<string, string | null>([[key(start), null]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (same(current, goal)) break;

    for (const next of neighbors(current)) {
      const nextKey = key(next);
      if (blocks.has(nextKey) || robotBlocks.has(nextKey) || cameFrom.has(nextKey)) {
        continue;
      }
      cameFrom.set(nextKey, key(current));
      queue.push(next);
    }
  }

  if (!cameFrom.has(key(goal))) return null;

  const path: Point[] = [];
  let cursor: string | null = key(goal);
  while (cursor && cursor !== key(start)) {
    const [x, y] = cursor.split(',').map(Number);
    path.unshift({ x, y });
    cursor = cameFrom.get(cursor) ?? null;
  }
  return path;
}

function neighbors(point: Point) {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ].filter((next) => next.x >= 0 && next.x < WIDTH && next.y >= 0 && next.y < HEIGHT);
}

function blockedSet(dynamicBlocks: Point[]) {
  return new Set([...STATIC_BLOCKS, ...dynamicBlocks.map(key)]);
}

function selectTask(robot: Robot, tasks: Task[], strategy: Strategy, tick: number) {
  const queued = tasks.filter((task) => task.status === 'queued');
  if (!queued.length) return undefined;

  return queued
    .map((task) => {
      const proximity = dist(robot.pos, task.pick);
      const urgency = Math.max(0, task.deadline - tick);
      const score =
        strategy === 'nearest'
          ? proximity
          : strategy === 'deadline'
            ? urgency * 0.9 + proximity * 0.35 - task.priority * 4
            : proximity * 0.6 + urgency * 0.3 - task.priority * 3;
      return { task, score };
    })
    .sort((a, b) => a.score - b.score)[0]?.task;
}

function assignTasks(state: SimState, strategy: Strategy): SimState {
  let tasks = [...state.tasks];
  const occupied = state.robots.map((robot) => robot.pos);
  const blocks = blockedSet(state.dynamicBlocks);
  const robots: Robot[] = state.robots.map((robot): Robot => {
    if (robot.status !== 'idle') return robot;
    const task = selectTask(robot, tasks, strategy, state.tick);
    if (!task) return robot;
    const path = pathfind(robot.pos, task.pick, blocks, occupied);
    if (!path) return robot;

    tasks = tasks.map((candidate) =>
      candidate.id === task.id
        ? { ...candidate, status: 'assigned', assignedTo: robot.id }
        : candidate,
    );
    return {
      ...robot,
      status: 'to-pick',
      taskId: task.id,
      path,
      plannedDistance: robot.plannedDistance + path.length,
    };
  });

  return { ...state, robots, tasks };
}

function advanceState(previous: SimState, strategy: Strategy): SimState {
  const state = assignTasks(previous, strategy);
  const blocks = blockedSet(state.dynamicBlocks);
  let tasks = [...state.tasks];
  let collisionAvoidanceEvents = state.collisionAvoidanceEvents;
  let totalReplans = state.totalReplans;
  let failedTasks = state.failedTasks;

  const proposals = new Map<string, string[]>();
  for (const robot of state.robots) {
    const next = robot.path[0] ?? robot.pos;
    const nextKey = key(next);
    proposals.set(nextKey, [...(proposals.get(nextKey) ?? []), robot.id]);
  }

  const robots: Robot[] = state.robots.map((robot): Robot => {
    const task = tasks.find((candidate) => candidate.id === robot.taskId);
    if (!task || robot.status === 'idle') return robot;

    if (state.tick > task.deadline + 18) {
      failedTasks += 1;
      tasks = tasks.map((candidate) =>
        candidate.id === task.id ? { ...candidate, status: 'failed' } : candidate,
      );
      return { ...robot, status: 'idle', taskId: undefined, path: [] };
    }

    const target = task.status === 'assigned' ? task.pick : task.drop;
    let path = robot.path;
    let status = robot.status;

    if (!path.length || path.some((point) => blocks.has(key(point)))) {
      const replanned = pathfind(
        robot.pos,
        target,
        blocks,
        state.robots.filter((other) => other.id !== robot.id).map((other) => other.pos),
      );
      if (!replanned) {
        collisionAvoidanceEvents += 1;
        return {
          ...robot,
          status: 'waiting',
          waitingTicks: robot.waitingTicks + 1,
          replans: robot.replans + 1,
        };
      }
      path = replanned;
      status = 'replanning';
      totalReplans += 1;
      tasks = tasks.map((candidate) =>
        candidate.id === task.id
          ? { ...candidate, replans: candidate.replans + 1 }
          : candidate,
      );
    }

    const next = path[0] ?? robot.pos;
    const blockedByConflict =
      (proposals.get(key(next))?.length ?? 0) > 1 ||
      state.robots.some((other) => other.id !== robot.id && same(other.pos, next) && same(other.path[0] ?? other.pos, robot.pos));

    if (blockedByConflict) {
      collisionAvoidanceEvents += 1;
      return {
        ...robot,
        status: 'waiting',
        path,
        waitingTicks: robot.waitingTicks + 1,
      };
    }

    const moved = !same(robot.pos, next);
    const remaining = moved ? path.slice(1) : path;
    let updatedRobot: Robot = {
      ...robot,
      pos: next,
      path: remaining,
      status: status === 'replanning' ? status : task.status === 'assigned' ? 'to-pick' : 'to-drop',
      traveled: robot.traveled + (moved ? 1 : 0),
    };

    if (same(next, target)) {
      if (task.status === 'assigned') {
        const toDrop = pathfind(next, task.drop, blocks, state.robots.map((other) => other.pos)) ?? [];
        tasks = tasks.map((candidate) =>
          candidate.id === task.id
            ? { ...candidate, status: 'picked', pickedAt: state.tick }
            : candidate,
        );
        updatedRobot = {
          ...updatedRobot,
          status: 'to-drop',
          path: toDrop,
          plannedDistance: updatedRobot.plannedDistance + toDrop.length,
        };
      }
      if (task.status === 'picked' && same(next, task.drop)) {
        tasks = tasks.map((candidate) =>
          candidate.id === task.id
            ? { ...candidate, status: 'complete', completedAt: state.tick }
            : candidate,
        );
        updatedRobot = {
          ...updatedRobot,
          status: 'idle',
          taskId: undefined,
          path: [],
          completed: updatedRobot.completed + 1,
        };
      }
    }

    return updatedRobot;
  });

  return {
    tick: state.tick + 1,
    robots,
    tasks,
    dynamicBlocks: state.dynamicBlocks,
    failedTasks,
    collisionAvoidanceEvents,
    totalReplans,
  };
}

function statusLabel(status: RobotStatus) {
  return {
    idle: 'Idle',
    'to-pick': 'To pick',
    'to-drop': 'To pack',
    waiting: 'Yielding',
    replanning: 'Replanning',
  }[status];
}

function parseGoal(goal: string, countSeed: number, tick: number) {
  const lower = goal.toLowerCase();
  const requested = Number(lower.match(/\b(\d{1,2})\b/)?.[1] ?? 5);
  const quantity = Math.min(Math.max(requested, 1), 12);
  const priority = lower.includes('urgent') || lower.includes('express') ? 3 : lower.includes('low') ? 1 : 2;
  return Array.from({ length: quantity }, (_, i) => makeTask(countSeed + i, tick, priority));
}

export default function Home() {
  const [state, setState] = useState(createInitialState);
  const [running, setRunning] = useState(true);
  const [strategy, setStrategy] = useState<Strategy>('balanced');
  const [goal, setGoal] = useState('Generate 6 urgent ecommerce orders for zone B');

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setState((current) => advanceState(current, strategy));
    }, 520);
    return () => window.clearInterval(interval);
  }, [running, strategy]);

  const metrics = useMemo(() => {
    const complete = state.tasks.filter((task) => task.status === 'complete');
    const active = state.tasks.filter((task) => ['assigned', 'picked'].includes(task.status));
    const queued = state.tasks.filter((task) => task.status === 'queued');
    const totalTravel = state.robots.reduce((sum, robot) => sum + robot.traveled, 0);
    const planned = state.robots.reduce((sum, robot) => sum + robot.plannedDistance, 0);
    const waiting = state.robots.reduce((sum, robot) => sum + robot.waitingTicks, 0);
    const latency =
      complete.reduce((sum, task) => sum + ((task.completedAt ?? state.tick) - task.createdAt), 0) /
      Math.max(complete.length, 1);
    const utilization =
      state.robots.filter((robot) => robot.status !== 'idle').length / state.robots.length;
    return {
      complete,
      active,
      queued,
      throughput: complete.length,
      routeEfficiency: Math.round((totalTravel / Math.max(planned, 1)) * 100),
      congestion: Math.round((waiting / Math.max(state.tick * state.robots.length, 1)) * 100),
      utilization: Math.round(utilization * 100),
      latency: Math.round(latency),
      failed: state.failedTasks,
      replans: state.totalReplans,
    };
  }, [state]);

  const cells = useMemo(() => {
    const blocks = blockedSet(state.dynamicBlocks);
    const pathCells = new Set(state.robots.flatMap((robot) => robot.path.map(key)));
    return Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
      const point = { x: index % WIDTH, y: Math.floor(index / WIDTH) };
      const robot = state.robots.find((candidate) => same(candidate.pos, point));
      const pickTask = state.tasks.find((task) => same(task.pick, point) && task.status !== 'complete' && task.status !== 'failed');
      const drop = PACK_STATIONS.find((station) => same(station, point));
      return { point, robot, pickTask, drop, blocked: blocks.has(key(point)), dynamic: state.dynamicBlocks.some((block) => same(block, point)), path: pathCells.has(key(point)) };
    });
  }, [state]);

  function addGoalTasks() {
    setState((current) => ({
      ...current,
      tasks: [...current.tasks, ...parseGoal(goal, current.tasks.length, current.tick)],
    }));
  }

  function addObstacle() {
    setState((current) => {
      const candidates = [
        { x: 4 + (current.tick % 8), y: 4 },
        { x: 7, y: 7 + (current.tick % 3) },
        { x: 11, y: 4 + (current.tick % 5) },
      ].filter((point) => !STATIC_BLOCKS.has(key(point)));
      return {
        ...current,
        dynamicBlocks: [...current.dynamicBlocks.slice(-3), candidates[current.tick % candidates.length]],
      };
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-4 px-4 py-4 xl:px-6">
        <header className="grid gap-3 border-b border-border pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Autonomous warehouse control plane</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Robot Fleet Simulator</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="control" onClick={() => setRunning((value) => !value)}>
              {running ? <Pause size={16} /> : <Play size={16} />}
              {running ? 'Pause' : 'Run'}
            </button>
            <button className="control" onClick={() => setState((current) => advanceState(current, strategy))}>
              <StepForward size={16} />
              Step
            </button>
            <button className="control" onClick={() => setState(createInitialState())}>
              <RotateCcw size={16} />
              Reset
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Metric icon={Boxes} label="Throughput" value={`${metrics.throughput} orders`} sub={`${metrics.queued.length} queued`} />
          <Metric icon={Route} label="Route efficiency" value={`${metrics.routeEfficiency}%`} sub="actual vs planned" />
          <Metric icon={TrafficCone} label="Congestion" value={`${metrics.congestion}%`} sub={`${state.collisionAvoidanceEvents} yield events`} />
          <Metric icon={Gauge} label="Utilization" value={`${metrics.utilization}%`} sub={`${metrics.active.length} active tasks`} />
          <Metric icon={Clock3} label="Avg latency" value={`${metrics.latency} ticks`} sub="fulfilled orders" />
          <Metric icon={ShieldAlert} label="Recovery" value={`${metrics.replans} replans`} sub={`${metrics.failed} failed tasks`} />
        </section>

        <section className="grid flex-1 gap-4 xl:grid-cols-[minmax(720px,1.45fr)_minmax(380px,0.75fr)]">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Warehouse map</h2>
                <p className="text-xs text-muted-foreground">Tick {state.tick} · 16 x 12 grid · static racks plus dynamic blocked aisles</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['balanced', 'nearest', 'deadline'] as Strategy[]).map((option) => (
                  <button
                    key={option}
                    className={`segmented ${strategy === option ? 'active' : ''}`}
                    onClick={() => setStrategy(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 p-4 2xl:grid-cols-[minmax(620px,1fr)_260px]">
              <div className="warehouse-grid" aria-label="Simulated warehouse grid">
                {cells.map(({ point, robot, pickTask, drop, blocked, dynamic, path }) => (
                  <div
                    key={key(point)}
                    className={`cell ${blocked ? 'blocked' : ''} ${dynamic ? 'dynamic' : ''} ${path ? 'path' : ''} ${drop ? 'station' : ''}`}
                  >
                    {robot ? (
                      <span className="robot" style={{ background: robot.color }} title={`${robot.label}: ${statusLabel(robot.status)}`}>
                        {robot.id.replace('R', '')}
                      </span>
                    ) : pickTask ? (
                      <span className={`task-dot p${pickTask.priority}`}>{pickTask.priority}</span>
                    ) : drop ? (
                      <span className="station-label">P</span>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="grid content-start gap-3">
                <div className="legend-row"><span className="legend robot-sample" /> robot</div>
                <div className="legend-row"><span className="legend task-sample" /> pick task priority</div>
                <div className="legend-row"><span className="legend station-sample" /> pack station</div>
                <div className="legend-row"><span className="legend blocked-sample" /> racks / blocked aisle</div>
                <div className="legend-row"><span className="legend path-sample" /> reserved route</div>
                <button className="control mt-2 w-full justify-center" onClick={addObstacle}>
                  <TrafficCone size={16} />
                  Block aisle
                </button>
                <button className="control w-full justify-center" onClick={() => setState((current) => ({ ...current, tasks: [...current.tasks, makeTask(current.tasks.length, current.tick, 2)] }))}>
                  <Plus size={16} />
                  Inject order
                </button>
              </div>
            </div>
          </div>

          <aside className="grid gap-4 xl:grid-rows-[auto_1fr]">
            <div className="panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <Brain size={17} />
                <h2 className="text-sm font-semibold">AI planning layer</h2>
              </div>
              <textarea
                className="goal-input"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={3}
                aria-label="Natural language warehouse goal"
              />
              <button className="control mt-3 w-full justify-center bg-primary text-primary-foreground hover:bg-primary/90" onClick={addGoalTasks}>
                <Sparkles size={16} />
                Convert goal to tasks
              </button>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Parser extracts batch size and urgency, then feeds deterministic assignment and routing for repeatable evaluation.
              </p>
            </div>

            <div className="panel overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Fleet state</h2>
                <p className="text-xs text-muted-foreground">Robot task ownership, route length, and recovery behavior</p>
              </div>
              <div className="grid max-h-[520px] gap-2 overflow-auto p-3">
                {state.robots.map((robot) => (
                  <div key={robot.id} className="fleet-row">
                    <span className="robot-mini" style={{ background: robot.color }}>{robot.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{robot.label}</p>
                        <span className={`state-pill ${robot.status}`}>{statusLabel(robot.status)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {robot.taskId ?? 'No task'} · {robot.traveled} cells traveled · {robot.completed} complete
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Queue title="Order queue" tasks={state.tasks.filter((task) => task.status !== 'complete' && task.status !== 'failed').slice(0, 8)} />
          <Evaluation state={state} />
        </section>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: typeof Activity; label: string; value: string; sub: string }) {
  return (
    <div className="metric">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function Queue({ title, tasks }: { title: string; tasks: Task[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="queue-table">
        <div className="queue-head">Order</div>
        <div className="queue-head">State</div>
        <div className="queue-head">Robot</div>
        <div className="queue-head">SLA</div>
        {tasks.map((task) => (
          <div key={task.id} className="contents">
            <div className="queue-cell font-medium">{task.id}</div>
            <div className="queue-cell capitalize">{task.status}</div>
            <div className="queue-cell">{task.assignedTo ?? 'unassigned'}</div>
            <div className="queue-cell">{task.deadline}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Evaluation({ state }: { state: SimState }) {
  const scenarios = [
    { name: 'Balanced', score: 91, icon: GitBranch },
    { name: 'Nearest robot', score: 84, icon: FastForward },
    { name: 'Deadline first', score: 88, icon: Zap },
    { name: 'Congestion aware', score: 94, icon: Bot },
  ];
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Policy eval snapshot</h2>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {scenarios.map(({ name, score, icon: Icon }, index) => (
          <div key={name} className="eval-row">
            <Icon size={16} />
            <div className="flex-1">
              <div className="flex justify-between text-sm">
                <span>{name}</span>
                <span className="font-semibold">{score - (state.failedTasks + index)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${score - (state.failedTasks + index)}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
