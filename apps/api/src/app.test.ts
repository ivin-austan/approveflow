import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("API foundation", () => {
  it("returns a standard health envelope and correlation ID", async () => {
    const response = await request(createApp("http://localhost:5173"))
      .get("/api/v1/health")
      .set("x-correlation-id", "test-correlation-id")
      .expect(200);
    expect(response.headers["x-correlation-id"]).toBe("test-correlation-id");
    expect(response.body).toEqual({
      data: { status: "ok" },
      meta: { correlationId: "test-correlation-id" },
    });
  });
});
