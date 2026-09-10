import type { Config } from "../../config.js";
import type { EventBus } from "../../events.js";
import type { MeetingArtifactsService } from "../../meeting-artifacts-service.js";
import { NoopMeetingPublisher } from "../../meeting-publisher.js";
import type { Store } from "../../store/store.js";
import { FeishuClient } from "./feishu-client.js";
import { FeishuMeetingPublisher } from "./feishu-meeting-publisher.js";

type Logger = {
  info(bindings: Record<string, unknown>, message?: string): void;
  error(bindings: Record<string, unknown>, message?: string): void;
};

export function createInternalMeetingPublisher(
  config: Config,
  store: Store,
  events: EventBus,
  artifacts: MeetingArtifactsService,
  logger: Logger
) {
  if (!config.feishu) return new NoopMeetingPublisher();
  const client = new FeishuClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret
  });
  return new FeishuMeetingPublisher(
    { ...config.feishu, publicAppUrl: config.PUBLIC_APP_URL },
    store,
    events,
    artifacts,
    client,
    logger
  );
}
