import { describe, expect, it } from "vitest";
import { requestUrlForLog } from "../src/app.js";

describe("request logging", () => {
  it("keeps the route path while removing query credentials and fragments", () => {
    expect(requestUrlForLog("/rooms/meet-devx/events?capability=room-secret&after=0")).toBe("/rooms/meet-devx/events");
    expect(requestUrlForLog("/readyz")).toBe("/readyz");
    expect(requestUrlForLog("?capability=room-secret")).toBe("/");
    expect(requestUrlForLog("/summary#meeting")).toBe("/summary");
  });
});
