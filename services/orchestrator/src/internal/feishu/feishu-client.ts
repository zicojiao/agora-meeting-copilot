export type FeishuWikiNode = {
  spaceId: string;
  nodeToken: string;
  objectToken: string;
  objectType: string;
  title: string;
};

export type FeishuMessage = {
  messageId: string;
  chatId: string;
  createTime: string;
};

export type FeishuPost = {
  zh_cn: {
    title: string;
    content: Array<Array<Record<string, string>>>;
  };
};

export interface FeishuApi {
  resolveWikiNode(nodeToken: string): Promise<FeishuWikiNode>;
  createWikiNode(input: { spaceId: string; parentNodeToken: string; title: string }): Promise<FeishuWikiNode>;
  writeMarkdown(documentToken: string, markdown: string): Promise<void>;
  sendPost(input: { chatId: string; post: FeishuPost; uuid: string }): Promise<FeishuMessage>;
}

type FeishuClientConfig = {
  appId: string;
  appSecret: string;
  requestTimeoutMs?: number;
};

type FeishuEnvelope<T> = {
  code: number;
  msg: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
};

type FetchLike = typeof globalThis.fetch;

export class FeishuApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: number,
    readonly logId?: string
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}

export class FeishuClient implements FeishuApi {
  private accessToken?: { value: string; expiresAt: number };
  private accessTokenRequest?: Promise<string>;

  constructor(
    private config: FeishuClientConfig,
    private fetchImpl: FetchLike = globalThis.fetch,
    private now: () => number = Date.now,
    private wait: (milliseconds: number) => Promise<void> = delay
  ) {}

  async resolveWikiNode(nodeToken: string) {
    const data = await this.request<{ node: FeishuNodeResponse }>(
      `/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`
    );
    return normalizeNode(data.node);
  }

  async createWikiNode(input: { spaceId: string; parentNodeToken: string; title: string }) {
    const data = await this.request<{ node: FeishuNodeResponse }>(
      `/wiki/v2/spaces/${encodeURIComponent(input.spaceId)}/nodes`,
      {
        method: "POST",
        body: JSON.stringify({
          obj_type: "docx",
          parent_node_token: input.parentNodeToken,
          node_type: "origin",
          title: input.title
        })
      }
    );
    return normalizeNode(data.node);
  }

  async writeMarkdown(documentToken: string, markdown: string) {
    const converted = await this.request<ConvertedBlocks>(
      "/docx/v1/documents/blocks/convert",
      { method: "POST", body: JSON.stringify({ content_type: "markdown", content: markdown }) }
    );
    const batches = partitionConvertedBlocks(converted);
    for (const batch of batches) {
      await this.request(
        `/docx/v1/documents/${encodeURIComponent(documentToken)}/blocks/${encodeURIComponent(documentToken)}/descendant?document_revision_id=-1`,
        {
          method: "POST",
          body: JSON.stringify({
            index: -1,
            children_id: batch.rootIds,
            descendants: removeReadOnlyFields(batch.blocks)
          })
        }
      );
    }
  }

  async sendPost(input: { chatId: string; post: FeishuPost; uuid: string }) {
    const data = await this.request<FeishuMessageResponse>(
      "/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        body: JSON.stringify({
          receive_id: input.chatId,
          msg_type: "post",
          content: JSON.stringify(input.post),
          uuid: input.uuid
        })
      }
    );
    return {
      messageId: data.message_id,
      chatId: data.chat_id,
      createTime: data.create_time
    };
  }

  private async request<T = Record<string, never>>(path: string, init: RequestInit = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const accessToken = await this.getAccessToken();
        const response = await this.fetchWithTimeout(`https://open.feishu.cn/open-apis${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json; charset=utf-8",
            ...init.headers
          }
        });
        const body = await parseEnvelope<T>(response);
        if (response.ok && body.code === 0) return (body.data ?? {}) as T;
        const error = apiError(response, body);
        if (response.status === 401) this.accessToken = undefined;
        if (!isRetryable(response.status, body.code) || attempt === 2) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof FeishuApiError && !isRetryable(error.statusCode, error.code)) throw error;
        lastError = error;
        if (attempt === 2) throw normalizeNetworkError(error);
      }
      await this.wait(250 * 3 ** attempt);
    }
    throw normalizeNetworkError(lastError);
  }

  private getAccessToken() {
    if (this.accessToken && this.accessToken.expiresAt > this.now() + 60_000) {
      return Promise.resolve(this.accessToken.value);
    }
    if (this.accessTokenRequest) return this.accessTokenRequest;
    this.accessTokenRequest = this.fetchAccessToken().finally(() => {
      this.accessTokenRequest = undefined;
    });
    return this.accessTokenRequest;
  }

  private async fetchAccessToken() {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
          {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret })
          }
        );
        const body = await parseEnvelope<never>(response);
        if (response.ok && body.code === 0 && body.tenant_access_token) {
          this.accessToken = {
            value: body.tenant_access_token,
            expiresAt: this.now() + Math.max(60, body.expire ?? 7200) * 1000
          };
          return body.tenant_access_token;
        }
        const error = apiError(response, body);
        if (!isRetryable(response.status, body.code) || attempt === 2) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof FeishuApiError && !isRetryable(error.statusCode, error.code)) throw error;
        lastError = error;
        if (attempt === 2) throw normalizeNetworkError(error);
      }
      await this.wait(250 * 3 ** attempt);
    }
    throw normalizeNetworkError(lastError);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs ?? 10_000);
    timeout.unref();
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

type FeishuNodeResponse = {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  title?: string;
};

type FeishuMessageResponse = {
  message_id: string;
  chat_id: string;
  create_time: string;
};

type ConvertedBlock = Record<string, unknown> & {
  block_id: string;
  children?: string[];
};

type ConvertedBlocks = {
  first_level_block_ids: string[];
  blocks: ConvertedBlock[];
};

type ConvertedBlockBatch = {
  rootIds: string[];
  blocks: ConvertedBlock[];
};

function normalizeNode(node: FeishuNodeResponse): FeishuWikiNode {
  return {
    spaceId: node.space_id,
    nodeToken: node.node_token,
    objectToken: node.obj_token,
    objectType: node.obj_type,
    title: node.title ?? ""
  };
}

export function partitionConvertedBlocks(converted: ConvertedBlocks, maximumBlocks = 900) {
  const blocksById = new Map(converted.blocks.map((block) => [block.block_id, block]));
  const subtrees = converted.first_level_block_ids.map((rootId) => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const visit = (blockId: string) => {
      if (seen.has(blockId)) return;
      seen.add(blockId);
      const block = blocksById.get(blockId);
      if (!block) return;
      ids.push(blockId);
      for (const childId of block.children ?? []) visit(childId);
    };
    visit(rootId);
    if (!ids.length) throw new Error(`Converted Feishu block ${rootId} is missing`);
    if (ids.length > maximumBlocks) throw new Error(`One converted Feishu block tree exceeds ${maximumBlocks} blocks`);
    return { rootId, ids };
  });

  const batches: ConvertedBlockBatch[] = [];
  let current: { rootIds: string[]; ids: string[] } = { rootIds: [], ids: [] };
  for (const subtree of subtrees) {
    if (current.ids.length && current.ids.length + subtree.ids.length > maximumBlocks) {
      batches.push({ rootIds: current.rootIds, blocks: current.ids.map((id) => blocksById.get(id)!) });
      current = { rootIds: [], ids: [] };
    }
    current.rootIds.push(subtree.rootId);
    current.ids.push(...subtree.ids);
  }
  if (current.ids.length) {
    batches.push({ rootIds: current.rootIds, blocks: current.ids.map((id) => blocksById.get(id)!) });
  }
  return batches;
}

function removeReadOnlyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeReadOnlyFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "merge_info")
      .map(([key, child]) => [key, removeReadOnlyFields(child)])
  );
}

async function parseEnvelope<T>(response: Response): Promise<FeishuEnvelope<T>> {
  try {
    return await response.json() as FeishuEnvelope<T>;
  } catch {
    throw new FeishuApiError("Feishu returned a non-JSON response", response.status, undefined, response.headers.get("x-tt-logid") ?? undefined);
  }
}

function apiError(response: Response, body: FeishuEnvelope<unknown>) {
  const logId = response.headers.get("x-tt-logid") ?? undefined;
  const suffix = logId ? ` (log ${logId})` : "";
  return new FeishuApiError(`Feishu API ${body.code}: ${body.msg}${suffix}`, response.status, body.code, logId);
}

function isRetryable(statusCode: number, code?: number) {
  return statusCode === 429 || statusCode >= 500 || new Set([99991400, 99991401, 99991402]).has(code ?? -1);
}

function normalizeNetworkError(error: unknown) {
  if (error instanceof FeishuApiError) return error;
  const message = error instanceof Error && error.name === "AbortError"
    ? "Feishu request timed out"
    : `Feishu request failed: ${error instanceof Error ? error.message : String(error)}`;
  return new FeishuApiError(message, 503);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
