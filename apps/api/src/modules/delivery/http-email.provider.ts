import { z } from "zod";
import type { EmailProvider } from "./delivery.service.js";

const responseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ACCEPTED"), messageId: z.string().min(1) }),
  z.object({ status: z.literal("UNKNOWN") }),
  z.object({ status: z.literal("NOT_FOUND") }),
  z.object({ status: z.literal("REJECTED"), code: z.string().min(1) }),
]);
export class HttpEmailProvider implements EmailProvider {
  public constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}
  public async send(input: Parameters<EmailProvider["send"]>[0]) {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        text: input.body,
        attachmentBase64: input.attachment
          ? Buffer.from(input.attachment).toString("base64")
          : null,
      }),
    });
    if (response.status >= 500) return { status: "UNKNOWN" as const };
    return providerSendResult(await response.json());
  }
  public async reconcile(idempotencyKey: string) {
    const response = await fetch(
      `${this.baseUrl}/messages/by-idempotency-key/${encodeURIComponent(idempotencyKey)}`,
      { headers: { authorization: `Bearer ${this.apiKey}` } },
    );
    if (response.status === 404) return { status: "NOT_FOUND" as const };
    return providerReconciliationResult(await response.json());
  }
}
function providerSendResult(
  value: unknown,
): Awaited<ReturnType<EmailProvider["send"]>> {
  const parsed = responseSchema.parse(value);
  return parsed.status === "NOT_FOUND" ? { status: "UNKNOWN" } : parsed;
}
function providerReconciliationResult(
  value: unknown,
): Awaited<ReturnType<EmailProvider["reconcile"]>> {
  const parsed = responseSchema.parse(value);
  return parsed.status === "UNKNOWN" ? { status: "NOT_FOUND" } : parsed;
}
