import { useEffect, useRef, useState } from 'preact/hooks';
import { CONFIG, formatDistance, formatTime, type GadgetId, type RunResult, type WeaponId } from '@scope-rush/shared';
import { T } from '../i18n/de';
import { playClick } from '../audio/synth';
import type { GameHost, HudSnapshot } from '../game/GameHost';
import type { GameView, MatchMeta, RunnerView, SniperView } from '../game/view';
import { Hearts } from './hud/Hearts';
import { useHud } from './hud/useHud';
import { getSettings } from './settings';
import { DebugPanel } from './DebugPanel';
import { RemoteSession } from '../game/RemoteSession';

const WEAPONS: WeaponId[] = ['precision', 'semi', 'rocket'];
const GADGETS: Array<GadgetId | null> = [null, 'smoke', 'shield', 'sprint', 'decoy'];
const WEAPON_ICON: Record<WeaponId, string> = { precision: '🎯', semi: '🔫', rocket: '🚀' };
const GADGET_ICON: Record<GadgetId, string> = { smoke: '💨', shield: '🛡️', sprint: '⚡', decoy: '🎭' };

export function GameScreen({ host, onExit, debug }: { host: GameHost; onExit: () => void; debug: boolean }) {
  const snap = useHud(host);
  const inputRef = useRef<HTMLDivElement>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    host.setInputElement(inputRef.current);
    return () => host.setInputElement(null);
  }, [host]);

  const view = snap?.view ?? null;
  const meta = snap?.meta ?? null;
  const role = view?.myRole ?? 'spectator';
  const showFps = getSettings().showFps || debug;

  return (
    <div class="game-screen">
      <div ref={inputRef} class="input-layer" data-allow-touch />
      {view && meta && <TopHud view={view} meta={meta} />}
      {showFps && snap && (
        <div class="fps-badge">
          {snap.stats.fps} FPS · {snap.stats.pixelRatio}× · {snap.stats.drawCalls} DC
        </div>
      )}
      {view && role === 'runner' && view.phase === 'running' && <RunnerHud view={view} host={host} />}
      {view && role === 'sniper' && (view.phase === 'running' || view.phase === 'countdown') && snap && (
        <SniperHud view={view} snap={snap} host={host} />
      )}
      {view && role === 'runner' && view.phase === 'running' && isOut(view) && view.snipers[0] && (
        <div class="banner info center-top">{T.game.spectating(view.snipers[0].name)}</div>
      )}
      {view && meta && !meta.paused && <PhaseOverlay view={view} meta={meta} host={host} onExit={onExit} />}
      <OnlineOverlay host={host} meta={meta} />

      <button class="btn menu-btn" aria-label={T.game.leave} onClick={() => setConfirmLeave(true)}>
        ≡
      </button>
      {confirmLeave && (
        <div class="modal-backdrop">
          <div class="modal">
            <h2>{T.game.leaveConfirm}</h2>
            <div class="modal-actions">
              <button class="btn primary" onClick={() => setConfirmLeave(false)}>
                {T.game.leaveNo}
              </button>
              <button class="btn" onClick={onExit}>
                {T.game.leaveYes}
              </button>
            </div>
          </div>
        </div>
      )}
      {debug && <DebugPanel />}
    </div>
  );
}

function isOut(view: GameView): boolean {
  return view.runners.find((r) => r.id === view.myId)?.out ?? false;
}

function nameOf(meta: MatchMeta, id: string): string {
  if (id === meta.myId) return T.game.you;
  return meta.players.find((p) => p.id === id)?.name ?? id;
}

// ----------------------------------------------------------------- Online: Pause & Verbindung

function OnlineOverlay({ host, meta }: { host: GameHost; meta: MatchMeta | null }) {
  const session = host.getSession();
  if (!(session instanceof RemoteSession) || !meta) return null;
  const pause = session.pauseInfo;
  if (session.status !== 'open' && !pause) return <div class="banner danger center-top">📶 {T.room.reconnecting}</div>;
  if (!pause) return null;
  const name = nameOf(meta, pause.by);
  if (pause.resumeInS !== null) return <div class="countdown">{T.room.resumeIn(Math.max(1, Math.ceil(pause.resumeInS)))}</div>;
  const iAmAway = pause.by === meta.myId;
  return (
    <div class="sheet-overlay">
      <div class="card result">
        <h2>{iAmAway ? T.room.reconnecting : T.room.pausedTitle(name)}</h2>
        {!pause.canClaim && <p class="center">{T.room.pausedWait(Math.ceil(pause.leftS))}</p>}
        {pause.canClaim && !iAmAway && (
          <>
            <p class="center">{T.room.pausedClaim}</p>
            <div class="modal-actions">
              <button class="btn primary" onClick={() => session.keepWaiting()}>
                {T.room.keepWaiting}
              </button>
              <button class="btn" onClick={() => session.claimWin()}>
                {T.room.claimWin}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Kopfzeile

function TopHud({ view, meta }: { view: GameView; meta: MatchMeta }) {
  const runTime = view.phase === 'running' ? Math.max(0, view.turnTime) / CONFIG.sim.hz : 0;
  const left = Math.max(0, CONFIG.runner.maxRunS - runTime);
  let label = '';
  if (meta.mode === 'duel') label = `${T.game.round(meta.plan.round + 1)} · ${T.game.turnOf(meta.plan.turnInRound + 1, 2)}`;
  else if (meta.mode === 'classic') label = T.game.round(meta.plan.index + 1);
  else label = T.game.youAre(view.myRole === 'runner' ? T.game.runner : T.game.sniper);

  return (
    <header class="game-top">
      <div class="game-top-row">
        <span class="chip">{label}</span>
        {view.phase === 'running' && <span class={`chip timer ${left < 10 ? 'warn' : ''}`}>{left.toFixed(1).replace('.', ',')} s</span>}
      </div>
      {meta.mode === 'duel' && (
        <div class="score-row">
          {meta.players.map((p) => (
            <span key={p.id} class={`score-chip c${p.colorIndex % 8}`}>
              {nameOf(meta, p.id)} <b>{meta.roundWins[p.id] ?? 0}</b>
            </span>
          ))}
        </div>
      )}
      {meta.mode === 'classic' && (
        <div class="score-row">
          {[...meta.players]
            .sort((a, b) => (meta.scores[b.id] ?? 0) - (meta.scores[a.id] ?? 0))
            .slice(0, 4)
            .map((p) => (
              <span key={p.id} class={`score-chip c${p.colorIndex % 8}`}>
                {nameOf(meta, p.id)} <b>{meta.scores[p.id] ?? 0}</b>
              </span>
            ))}
        </div>
      )}
      <Progress view={view} />
    </header>
  );
}

function Progress({ view }: { view: GameView }) {
  const len = view.track.length;
  return (
    <div class="progress">
      <div class="progress-track" />
      {view.runners.map((r) => (
        <span
          key={r.id}
          class={`progress-dot c${r.colorIndex % 8} ${r.id === view.myId ? 'me' : ''} ${r.out ? 'out' : ''}`}
          style={{ left: `${Math.min(100, (r.z / len) * 100)}%` }}
        />
      ))}
      <span class="progress-tower">🗼</span>
    </div>
  );
}

// ----------------------------------------------------------------- Läufer

function RunnerHud({ view, host }: { view: GameView; host: GameHost }) {
  const [tips, setTips] = useState(!getSettings().seenRunnerTips);
  useEffect(() => {
    if (!tips) return;
    const t = setTimeout(() => setTips(false), 6000);
    return () => clearTimeout(t);
  }, [tips]);
  const me = view.runners.find((r) => r.id === view.myId);
  if (!me) return null;
  const glint = view.snipers.some((s) => s.zoom >= CONFIG.scope.glintFromLevel && s.canFire);
  const reloading = view.snipers.length > 0 && view.snipers.every((s) => !s.canFire);

  return (
    <>
      <div class="runner-status">
        <Hearts hp={me.hp} />
      </div>
      {!me.out && glint && <div class="banner danger center-top">⚠️ {T.game.glint}</div>}
      {!me.out && !glint && reloading && <div class="banner go center-top">🏃 {T.game.sniperReloading}</div>}
      {tips && <div class="tips">{T.game.tipsRunner}</div>}
      <GadgetButton runner={me} host={host} />
    </>
  );
}

function GadgetButton({ runner, host }: { runner: RunnerView; host: GameHost }) {
  if (!runner.gadget) return null;
  const used = runner.gadgetUses <= 0;
  return (
    <button
      class={`btn gadget-btn ${used ? 'used' : ''}`}
      disabled={used || runner.out}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!used) {
          host.getSession()?.runnerAction('gadget');
          playClick();
        }
      }}
    >
      <span class="gadget-icon">{GADGET_ICON[runner.gadget]}</span>
      <span>{used ? T.game.gadgetUsed : T.gadgets[runner.gadget].name}</span>
    </button>
  );
}

// ----------------------------------------------------------------- Sniper

function SniperHud({ view, snap, host }: { view: GameView; snap: HudSnapshot; host: GameHost }) {
  const me: SniperView | undefined = view.snipers.find((s) => s.id === view.myId);
  const release = getSettings().fireMode === 'release';
  const zoom = snap.zoom;
  const zoomLabel = (z: number) => (z === 0 ? '1×' : `${Math.round((CONFIG.scope.fovs[0]! / CONFIG.scope.fovs[z]!) * 2) / 2}×`.replace('.', ','));
  const target = view.runners.filter((r) => !r.out && !r.finished).sort((a, b) => b.z - a.z)[0];
  const [tips, setTips] = useState(!getSettings().seenSniperTips);
  useEffect(() => {
    if (!tips) return;
    const t = setTimeout(() => setTips(false), 6000);
    return () => clearTimeout(t);
  }, [tips]);
  if (!me) return null;
  const ammoText = me.ammoLeft < 0 ? `${me.mag}/${CONFIG.weapons[me.weapon].magSize}` : `${me.ammoLeft}`;

  return (
    <>
      {zoom > 0 ? <ScopeOverlay /> : <div class="crosshair" />}
      <div class="sniper-status">
        <span class="chip">
          {WEAPON_ICON[me.weapon]} {ammoText}
        </span>
        {target && (
          <span class="chip">
            <Hearts hp={target.hp} small /> {Math.round(view.track.length - target.z)} m
          </span>
        )}
      </div>
      {tips && <div class="tips">{T.game.tipsSniper}</div>}
      <button
        class={`btn zoom-btn ${zoom > 0 ? 'on' : ''}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          host.sniper.cycleZoom();
          playClick();
        }}
      >
        🔭 {release ? zoomLabel(snap.releaseZoom) : zoomLabel(zoom)}
      </button>
      {!release && (
        <button
          class={`btn fire-btn ${me.canFire ? '' : 'reloading'}`}
          style={{ '--reload': `${Math.round(me.reload * 100)}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            host.fire();
          }}
        >
          {me.canFire ? T.game.fire : me.ammoLeft === 0 ? T.game.noAmmo : T.game.reloading}
        </button>
      )}
      {release && !me.canFire && <div class="reload-pill">{me.ammoLeft === 0 ? T.game.noAmmo : T.game.reloading}</div>}
    </>
  );
}

function ScopeOverlay() {
  return (
    <div class="scope" aria-hidden="true">
      <div class="scope-line h" />
      <div class="scope-line v" />
      <div class="scope-dot" />
    </div>
  );
}

// ----------------------------------------------------------------- Phasen

function PhaseOverlay({ view, meta, host, onExit }: { view: GameView; meta: MatchMeta; host: GameHost; onExit: () => void }) {
  switch (view.phase) {
    case 'loadout':
      return <LoadoutOverlay view={view} meta={meta} host={host} />;
    case 'countdown':
      return <div class="countdown">{Math.max(1, Math.ceil(view.phaseLeftS))}</div>;
    case 'running':
      return view.turnTime < 40 ? <div class="countdown go">{T.game.go}</div> : null;
    case 'turnResult':
      return <TurnResultCard meta={meta} />;
    case 'roundResult':
      return <RoundResultCard meta={meta} />;
    case 'matchResult':
      return <MatchResultCard meta={meta} host={host} onExit={onExit} />;
    default:
      return null;
  }
}

function LoadoutOverlay({ view, meta, host }: { view: GameView; meta: MatchMeta; host: GameHost }) {
  const role = view.myRole;
  const mine = meta.loadouts[meta.myId];
  const ready = meta.ready.includes(meta.myId);
  const total = meta.mode === 'practice' ? 6 : CONFIG.match.loadoutS;
  const pct = Math.max(0, Math.min(100, (view.phaseLeftS / total) * 100));
  const session = host.getSession();

  if (role === 'spectator') {
    return (
      <div class="sheet-overlay">
        <div class="card">
          <h2>{T.game.spectator}</h2>
        </div>
      </div>
    );
  }
  const others = [...meta.plan.runnerIds, ...meta.plan.sniperIds].filter((id) => id !== meta.myId);
  return (
    <div class="sheet-overlay">
      <div class="card loadout">
        <div class="loadout-head">
          <span class="chip">{T.game.youAre(role === 'runner' ? T.game.runner : T.game.sniper)}</span>
          <span class="chip">{T.themes[view.track.theme]}</span>
        </div>
        <h2>{role === 'runner' ? T.game.loadoutTitleRunner : T.game.loadoutTitleSniper}</h2>
        <div class="choice-grid">
          {role === 'sniper'
            ? WEAPONS.map((w) => (
                <button
                  key={w}
                  class={`choice ${mine?.weapon === w ? 'selected' : ''}`}
                  onClick={() => {
                    session?.setLoadout({ weapon: w }, false);
                    playClick();
                  }}
                >
                  <span class="choice-icon">{WEAPON_ICON[w]}</span>
                  <b>{T.weapons[w].name}</b>
                  <small>{T.weapons[w].desc}</small>
                </button>
              ))
            : GADGETS.map((g) => (
                <button
                  key={g ?? 'none'}
                  class={`choice ${mine?.gadget === g ? 'selected' : ''}`}
                  onClick={() => {
                    session?.setLoadout({ gadget: g }, false);
                    playClick();
                  }}
                >
                  <span class="choice-icon">{g ? GADGET_ICON[g] : '🚫'}</span>
                  <b>{g ? T.gadgets[g].name : T.game.noGadget}</b>
                  {g && <small>{T.gadgets[g].desc}</small>}
                </button>
              ))}
        </div>
        <div class="loadout-foot">
          <div class="timebar">
            <div style={{ width: `${pct}%` }} />
          </div>
          {others.map((id) => (
            <small key={id} class="muted">
              {meta.ready.includes(id) ? `✔ ${nameOf(meta, id)}` : T.game.loadoutWait(nameOf(meta, id), meta.plan.runnerIds.includes(id) ? T.game.runner : T.game.sniper)}
            </small>
          ))}
          <button class={`btn primary ${ready ? 'on' : ''}`} onClick={() => session?.setLoadout({}, true)} disabled={ready}>
            {ready ? '✔' : T.game.ready}
          </button>
        </div>
      </div>
    </div>
  );
}

function runSummary(run: RunResult): string {
  if (run.finished && run.timeTicks !== null) return `${T.game.finished} ${formatTime(run.timeTicks)}`;
  if (run.out) return `${T.game.out} ${T.game.distance(formatDistance(run.distance))}`;
  return `${T.game.timeout} ${T.game.distance(formatDistance(run.distance))}`;
}

function TurnResultCard({ meta }: { meta: MatchMeta }) {
  const rec = meta.records.at(-1);
  if (!rec) return null;
  return (
    <div class="sheet-overlay">
      <div class="card result">
        {rec.result.runs.map((run) => (
          <div key={run.runnerId} class="result-row">
            <b>{T.game.runOf(nameOf(meta, run.runnerId))}</b>
            <span>{runSummary(run)}</span>
            <Hearts hp={run.hp} small />
            {rec.points && <span class="chip">{T.game.points(rec.points[run.runnerId] ?? 0)}</span>}
          </div>
        ))}
        {meta.mode === 'classic' &&
          rec.result.snipers.map((s) => (
            <div key={s.sniperId} class="result-row">
              <b>🎯 {nameOf(meta, s.sniperId)}</b>
              <span>
                {s.hits}/{s.shots} Treffer
              </span>
              {rec.points && <span class="chip">{T.game.points(rec.points[s.sniperId] ?? 0)}</span>}
            </div>
          ))}
      </div>
    </div>
  );
}

function RoundResultCard({ meta }: { meta: MatchMeta }) {
  const last = meta.records.at(-1);
  const prev = meta.records.at(-2);
  if (!last || !prev) return null;
  const winner = last.roundWinnerId;
  return (
    <div class="sheet-overlay">
      <div class="card result">
        <h2>{winner ? T.game.roundWin(nameOf(meta, winner)) : T.game.roundDraw}</h2>
        {[prev, last].map((rec) =>
          rec.result.runs.map((run) => (
            <div key={rec.plan.index} class={`result-row ${run.runnerId === winner ? 'win' : ''}`}>
              <b>{nameOf(meta, run.runnerId)}</b>
              <span>{runSummary(run)}</span>
            </div>
          )),
        )}
      </div>
    </div>
  );
}

function MatchResultCard({ meta, host, onExit }: { meta: MatchMeta; host: GameHost; onExit: () => void }) {
  const session = host.getSession();
  let title: string;
  if (meta.mode === 'practice') title = T.game.practiceDone;
  else if (meta.draw) title = T.game.matchDraw;
  else if (meta.winnerId === meta.myId) title = T.game.matchWinYou;
  else if (meta.winnerId) title = meta.players.some((p) => p.id === meta.myId) ? T.game.matchLose : T.game.matchWin(nameOf(meta, meta.winnerId));
  else title = T.game.matchDraw;
  const last = meta.records.at(-1);
  return (
    <div class="sheet-overlay">
      <div class="card result final">
        <h2 class="big">{title}</h2>
        {meta.mode === 'practice' && last && last.result.runs.map((run) => <p key={run.runnerId}>{runSummary(run)}</p>)}
        {meta.mode === 'duel' && (
          <p class="score-line">
            {meta.players.map((p) => `${nameOf(meta, p.id)} ${meta.roundWins[p.id] ?? 0}`).join('  :  ')}
          </p>
        )}
        {meta.mode === 'classic' && (
          <ol class="ranking">
            {[...meta.players]
              .sort((a, b) => (meta.scores[b.id] ?? 0) - (meta.scores[a.id] ?? 0))
              .map((p) => (
                <li key={p.id}>
                  {nameOf(meta, p.id)} <b>{meta.scores[p.id] ?? 0}</b>
                </li>
              ))}
          </ol>
        )}
        <div class="modal-actions">
          <button class="btn primary" onClick={() => session?.rematch()}>
            {meta.mode === 'practice' ? T.game.again : T.game.rematch}
          </button>
          <button class="btn" onClick={onExit}>
            {T.game.menu}
          </button>
        </div>
        {meta.rematchVotes.length > 0 && <small class="muted">{meta.rematchVotes.map((id) => nameOf(meta, id)).join(', ')} ✔</small>}
      </div>
    </div>
  );
}
