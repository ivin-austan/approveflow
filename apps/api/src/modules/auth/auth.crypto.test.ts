import { describe, expect, it } from "vitest";
import { JwtAccessTokenService } from "./access-token.js";
import { hashPassword, verifyPassword } from "./auth.crypto.js";

describe("authentication cryptography", () => {
  it("hashes passwords with Argon2id", async () => {
    const passwordHash = await hashPassword("SecurePassword1");
    expect(passwordHash).toContain("$argon2id$");
    await expect(verifyPassword(passwordHash, "SecurePassword1")).resolves.toBe(
      true,
    );
    await expect(verifyPassword(passwordHash, "wrong-password")).resolves.toBe(
      false,
    );
  });

  it("issues and verifies access tokens", async () => {
    const tokens = new JwtAccessTokenService("a".repeat(32), 15);
    const token = await tokens.issue("user-1");
    await expect(tokens.verify(token)).resolves.toBe("user-1");
    await expect(
      new JwtAccessTokenService("b".repeat(32), 15).verify(token),
    ).resolves.toBeNull();
  });
});
