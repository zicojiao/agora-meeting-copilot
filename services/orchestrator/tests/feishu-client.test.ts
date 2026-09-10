import { describe, expect, it } from "vitest";
import { FeishuApiError, FeishuClient, partitionConvertedBlocks } from "../src/internal/feishu/feishu-client.js";

type QueuedResponse = {
  status?: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

describe("FeishuClient", () => {
  it("caches the tenant token and maps Wiki nodes", async () => {
    const transport = fakeTransport([
      ok({ tenant_access_token: "tenant-token", expire: 7200 }),
      ok({ data: { node: wikiNode("parent", "parent-doc", "Root") } }),
      ok({ data: { node: wikiNode("notes-node", "notes-doc", "Meeting notes") } })
    ]);
    const client = new FeishuClient({ appId: "cli_test", appSecret: "secret" }, transport.fetch);

    await expect(client.resolveWikiNode("parent")).resolves.toMatchObject({
      spaceId: "space-1",
      nodeToken: "parent",
      objectToken: "parent-doc"
    });
    await expect(client.createWikiNode({
      spaceId: "space-1",
      parentNodeToken: "parent",
      title: "Meeting notes"
    })).resolves.toMatchObject({ nodeToken: "notes-node", objectToken: "notes-doc" });

    expect(transport.calls.filter((call) => call.url.includes("tenant_access_token"))).toHaveLength(1);
    expect(transport.calls[2]?.body).toEqual({
      obj_type: "docx",
      parent_node_token: "parent",
      node_type: "origin",
      title: "Meeting notes"
    });
    expect(transport.calls[1]?.authorization).toBe("Bearer tenant-token");
  });

  it("converts Markdown, strips read-only fields, and sends a rich group post", async () => {
    const transport = fakeTransport([
      ok({ tenant_access_token: "tenant-token", expire: 7200 }),
      ok({
        data: {
          first_level_block_ids: ["heading", "paragraph"],
          blocks: [
            { block_id: "heading", block_type: 3, merge_info: { merged: true } },
            { block_id: "paragraph", block_type: 2 }
          ]
        }
      }),
      ok({ data: {} }),
      ok({ data: { message_id: "message-1", chat_id: "oc_test", create_time: "1" } })
    ]);
    const client = new FeishuClient({ appId: "cli_test", appSecret: "secret" }, transport.fetch);

    await client.writeMarkdown("notes-doc", "## Notes\n\nHello");
    await client.sendPost({
      chatId: "oc_test",
      uuid: "00000000-0000-5000-a000-000000000000",
      post: { zh_cn: { title: "Meeting", content: [[{ tag: "text", text: "Done" }]] } }
    });

    const write = transport.calls.find((call) => call.url.includes("/descendant"));
    expect(write?.body).toEqual({
      index: -1,
      children_id: ["heading", "paragraph"],
      descendants: [
        { block_id: "heading", block_type: 3 },
        { block_id: "paragraph", block_type: 2 }
      ]
    });
    const message = transport.calls.find((call) => call.url.includes("/im/v1/messages"));
    expect(message?.body).toMatchObject({
      receive_id: "oc_test",
      msg_type: "post",
      uuid: "00000000-0000-5000-a000-000000000000"
    });
    expect(JSON.parse(String(message?.body?.content))).toMatchObject({ zh_cn: { title: "Meeting" } });
  });

  it("retries transient Feishu errors and preserves the final API diagnostics", async () => {
    const transport = fakeTransport([
      ok({ tenant_access_token: "tenant-token", expire: 7200 }),
      { status: 500, body: { code: 99991400, msg: "busy" } },
      ok({ data: { node: wikiNode("parent", "parent-doc", "Root") } })
    ]);
    const client = new FeishuClient(
      { appId: "cli_test", appSecret: "secret" },
      transport.fetch,
      Date.now,
      async () => undefined
    );
    await expect(client.resolveWikiNode("parent")).resolves.toMatchObject({ nodeToken: "parent" });
    expect(transport.calls).toHaveLength(3);

    const failed = fakeTransport([
      ok({ tenant_access_token: "tenant-token", expire: 7200 }),
      { status: 403, body: { code: 131006, msg: "forbidden" }, headers: { "x-tt-logid": "log-1" } }
    ]);
    const failingClient = new FeishuClient({ appId: "cli_test", appSecret: "secret" }, failed.fetch);
    await expect(failingClient.resolveWikiNode("parent")).rejects.toMatchObject({
      statusCode: 403,
      code: 131006,
      logId: "log-1"
    } satisfies Partial<FeishuApiError>);
  });

  it("keeps each converted block subtree in one bounded batch", () => {
    expect(partitionConvertedBlocks({
      first_level_block_ids: ["one", "three"],
      blocks: [
        { block_id: "one", children: ["two"] },
        { block_id: "two" },
        { block_id: "three" }
      ]
    }, 2)).toEqual([
      { rootIds: ["one"], blocks: [{ block_id: "one", children: ["two"] }, { block_id: "two" }] },
      { rootIds: ["three"], blocks: [{ block_id: "three" }] }
    ]);
  });
});

function fakeTransport(queue: QueuedResponse[]) {
  const calls: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const response = queue.shift();
    if (!response) throw new Error("Unexpected Feishu request");
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      authorization: headers.get("authorization") ?? undefined,
      body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json", ...response.headers }
    });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

function ok(body: Record<string, unknown>): QueuedResponse {
  return { body: { code: 0, msg: "success", ...body } };
}

function wikiNode(nodeToken: string, objectToken: string, title: string) {
  return {
    space_id: "space-1",
    node_token: nodeToken,
    obj_token: objectToken,
    obj_type: "docx",
    title
  };
}
