import request from "supertest";
import { Router } from "express";
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
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("replaces unsafe correlation IDs", async () => {
    const response = await request(createApp("http://localhost:5173"))
      .get("/api/v1/health")
      .set("x-correlation-id", "unsafe value")
      .expect(200);
    expect(response.headers["x-correlation-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });

  it("keeps onboarding public when the tenant router denies anonymous access", async () => {
    const onboardingRouter = Router().post("/", (_request, response) => {
      response.status(201).json({ created: true });
    });
    const tenantRouter = Router().use((_request, response) => {
      response.status(401).json({ denied: true });
    });
    await request(
      createApp({
        webOrigin: "http://localhost:5173",
        onboardingRouter,
        tenantRouter,
      }),
    )
      .post("/api/v1/onboarding")
      .send({})
      .expect(201, { created: true });
  });
});
