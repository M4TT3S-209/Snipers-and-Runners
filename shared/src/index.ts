// Öffentliche Schnittstelle von /shared (ohne zod – die Schemas liegen in
// `@scope-rush/shared/schemas`).
export { CONFIG, secondsToTicks, type Config, type WeaponId, type GadgetId, type BotLevel, type WeaponConfig } from './config';
export { PROTOCOL_VERSION, HEARTBEAT_PING, HEARTBEAT_PONG, CLOSE_CODES } from './protocol/version';
export type { ClientMessage, ServerMessage, VersionInfo } from './protocol/messages';
export { Rng, hashString } from './math/rng';
export { triangleWave, smoothWave, clamp, lerp } from './math/wave';

export type * from './track/types';
export { generateTrack, laneX, laneAt, THEMES } from './track/generator';
export { groundAt, sinkerUp, sinkerPhase, coversAhead, tripsNear, NO_GROUND } from './track/query';

export * from './sim/geometry';
export * from './sim/projectile';
export * from './sim/runner';
export * from './sim/turn';

export * from './rules/scoring';
export * from './rules/match';

export { RunnerBot } from './bots/runnerBot';
export { SniperBot, type SniperBotOutput } from './bots/sniperBot';
export { BotDriver, ALL_WEAPONS, ALL_GADGETS } from './bots/driver';
export * from './protocol/room';
export { checkName, type NameCheck } from './names';
export * from './protocol/hub';
