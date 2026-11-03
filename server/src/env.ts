import type { HubDO } from './hub/HubDO';
import type { RoomDO } from './room/RoomDO';

/** Bindings und Variablen aus wrangler.jsonc. */
export interface Env {
  HUB: DurableObjectNamespace<HubDO>;
  ROOM: DurableObjectNamespace<RoomDO>;
  ALLOWED_ORIGINS: string;
  ENVIRONMENT: string;
  BUILD_ID: string;
}
