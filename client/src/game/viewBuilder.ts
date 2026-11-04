import {
  CONFIG,
  isActive,
  laneX,
  poseOf,
  projectileInfo,
  type MatchFlow,
  type RunnerMove,
  type RunnerState,
  type SniperState,
} from '@scope-rush/shared';
import type { GameView, MyRole, PlayerInfo, RunnerView, SniperView } from './view';

/** Baut aus einem lokalen MatchFlow den Zustand für die Darstellung. */
export function buildView(
  flow: MatchFlow,
  players: readonly PlayerInfo[],
  myId: string,
  prevMoves: ReadonlyMap<string, RunnerMove>,
  alpha: number,
): GameView {
  const turn = flow.turn;
  const plan = flow.plan;
  const role: MyRole = plan.runnerIds.includes(myId) ? 'runner' : plan.sniperIds.includes(myId) ? 'sniper' : 'spectator';
  const colorOf = (id: string) => players.find((p) => p.id === id)?.colorIndex ?? 0;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  const runners: RunnerView[] = turn
    ? turn.runners.map((r) => runnerView(r, prevMoves.get(r.id), alpha, nameOf(r.id), colorOf(r.id)))
    : plan.runnerIds.map((id, i) => ({
        id,
        name: nameOf(id),
        colorIndex: colorOf(id),
        x: laneX(plan.runnerIds.length === 1 ? 1 : i % 3),
        y: 0,
        z: 0,
        lane: 1,
        pose: 'idle',
        blocked: false,
        speed: 0,
        hp: CONFIG.runner.hp,
        out: false,
        finished: false,
        respawning: false,
        shield: false,
        smoke: false,
        sprint: false,
        decoyX: null,
        gadget: flow.loadouts.get(id)?.gadget ?? null,
        gadgetUses: 0,
      }));

  const snipers: SniperView[] = turn
    ? turn.snipers.map((s) => sniperView(s, turn.tick, turn.canFire(s), nameOf(s.id)))
    : plan.sniperIds.map((id) => ({
        id,
        name: nameOf(id),
        weapon: flow.loadouts.get(id)?.weapon ?? 'precision',
        aim: { x: 0, y: -0.25, z: -1 },
        zoom: 0,
        canFire: false,
        reload: 1,
        mag: 1,
        ammoLeft: -1,
      }));

  return {
    track: flow.track,
    phase: flow.phase,
    phaseLeftS: flow.phaseTicksLeft / CONFIG.sim.hz,
    turnTime: turn ? turn.tick - 1 + alpha : 0,
    runners,
    snipers,
    projectiles: turn ? turn.projectiles.filter((p) => p.alive).map(projectileInfo) : [],
    coverHp: turn ? turn.coverHp : flow.track.covers.map((c) => c.hp),
    coverDestroyed: turn ? turn.coverDestroyedTick.map((t) => t <= turn.tick) : flow.track.covers.map(() => false),
    myId,
    myRole: role,
  };
}

function runnerView(r: RunnerState, prev: RunnerMove | undefined, alpha: number, name: string, colorIndex: number): RunnerView {
  const m = r.move;
  const p = prev && prev.phase === m.phase ? prev : m;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const pose = poseOf(m);
  return {
    id: r.id,
    name,
    colorIndex,
    x: lerp(p.x, m.x),
    y: lerp(p.y, m.y),
    z: lerp(p.z, m.z),
    lane: m.lane,
    pose,
    blocked: m.blocked,
    speed: m.stumbleTicks > 0 ? 0.5 : m.sprintTicks > 0 ? 1.4 : 1,
    hp: r.hp,
    out: r.out,
    finished: m.phase === 'finished',
    respawning: m.phase === 'respawning',
    shield: r.shieldTicks > 0,
    smoke: r.smokeTicks > 0,
    sprint: m.sprintTicks > 0,
    decoyX: r.decoyTicks > 0 && isActive(r) ? laneX(r.decoyLane) : null,
    gadget: r.gadget,
    gadgetUses: r.gadgetUses,
  };
}

function sniperView(s: SniperState, tick: number, canFire: boolean, name: string): SniperView {
  const w = CONFIG.weapons[s.weapon];
  let reload = 1;
  if (s.reloadEndTick > 0) {
    const total = Math.round(w.reloadS * CONFIG.sim.hz);
    reload = Math.max(0, Math.min(1, 1 - (s.reloadEndTick - tick) / total));
  } else if (tick < s.nextShotTick) {
    reload = 0.98;
  }
  return { id: s.id, name, weapon: s.weapon, aim: s.aim, zoom: s.zoom, canFire, reload, mag: s.mag, ammoLeft: s.ammoLeft };
}
