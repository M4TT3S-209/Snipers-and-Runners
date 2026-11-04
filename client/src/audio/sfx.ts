import { CONFIG, projectilePosAt, type MatchEvent, type ProjectileInfo, type TurnEvent } from '@scope-rush/shared';
import type { GameView } from '../game/view';
import * as S from './synth';

/**
 * Ordnet Spielereignisse Sounds zu – abhängig davon, ob man Läufer oder
 * Sniper ist (eigener Schuss laut, fremder Schuss fern, Kugel zischt vorbei).
 */
export class SfxPlayer {
  private whizzed = new Set<number>();
  private lastGlint = false;
  private lastCountdown = -1;

  onMatchEvent(ev: MatchEvent, view: GameView | null): void {
    if (ev.t === 'turn') this.onTurnEvent(ev.ev, view);
    else if (ev.t === 'phase' && ev.phase === 'running') S.playCountdown(true);
    else if (ev.t === 'matchEnd') {
      if (!view) return;
      if (ev.winnerId === view.myId) S.playWin();
      else if (ev.winnerId) S.playLose();
    }
  }

  private onTurnEvent(ev: TurnEvent, view: GameView | null): void {
    const me = view?.myId;
    const isMe = (id: string) => id === me;
    switch (ev.t) {
      case 'shot':
        if (ev.projectile.weapon === 'rocket') S.playRocketLaunch();
        else S.playShot(isMe(ev.sniperId));
        break;
      case 'hit':
        if (ev.shielded) S.playShieldBlock();
        else if (ev.part === 'head') S.playHitHead();
        else S.playHitBody();
        break;
      case 'cover':
        if (ev.hpLeft === 0) S.playBreak();
        else S.playWood();
        break;
      case 'explosion':
        if (ev.kind === 'rocket') S.playExplosion();
        else S.playPop();
        break;
      case 'decoy':
        S.playPop();
        break;
      case 'out':
        S.playOut();
        break;
      case 'finish':
        if (isMe(ev.runnerId) || view?.myRole !== 'runner') S.playFanfare();
        break;
      case 'gadget':
        S.playGadget();
        break;
      case 'reloaded':
        if (isMe(ev.sniperId)) S.playReload();
        break;
      case 'move':
        if (!isMe(ev.runnerId)) break;
        if (ev.ev === 'jump') S.playJump();
        else if (ev.ev === 'slide') S.playSlide();
        else if (ev.ev === 'land') S.playLand();
        else if (ev.ev === 'trip') S.playTrip();
        else if (ev.ev === 'fall') S.playFall();
        else if (ev.ev === 'pad') S.playPad();
        else if (ev.ev === 'bonk') S.playClick();
        break;
      default:
        break;
    }
  }

  /** Jeden Frame: Glitzern, vorbeizischende Kugeln, Countdown-Piepser. */
  frame(view: GameView): void {
    if (view.phase === 'countdown') {
      const n = Math.ceil(view.phaseLeftS);
      if (n !== this.lastCountdown && n > 0 && n <= 3) S.playCountdown(false);
      this.lastCountdown = n;
    } else {
      this.lastCountdown = -1;
    }

    if (view.myRole !== 'runner') return;
    const me = view.runners.find((r) => r.id === view.myId);
    if (!me) return;
    const glint = view.snipers.some((s) => s.zoom >= CONFIG.scope.glintFromLevel && s.canFire);
    if (glint && !this.lastGlint) S.playGlint();
    this.lastGlint = glint;

    for (const p of view.projectiles) {
      if (this.whizzed.has(p.id)) continue;
      if (nearMiss(p, view.turnTime, me.x, me.y + 1, me.z)) {
        this.whizzed.add(p.id);
        S.playWhiz();
      }
    }
    if (this.whizzed.size > 200) this.whizzed.clear();
  }
}

function nearMiss(p: ProjectileInfo, time: number, x: number, y: number, z: number): boolean {
  if (time < p.spawnTime) return false;
  const pos = projectilePosAt(p, time);
  const dx = pos.x - x;
  const dy = pos.y - y;
  const dz = pos.z - z;
  return dx * dx + dy * dy + dz * dz < 9;
}
