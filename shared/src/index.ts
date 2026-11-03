// Öffentliche Schnittstelle von /shared (ohne zod – die Schemas liegen in
// `@scope-rush/shared/schemas`).
export { CONFIG, type Config } from './config';
export { PROTOCOL_VERSION, HEARTBEAT_PING, HEARTBEAT_PONG, CLOSE_CODES } from './protocol/version';
export type {
  ClientMessage,
  ClientEcho,
  ServerMessage,
  ServerWelcome,
  ServerEcho,
  ServerError,
  VersionInfo,
} from './protocol/messages';
export { Rng, hashString } from './math/rng';
export { triangleWave, smoothWave, clamp, lerp } from './math/wave';
