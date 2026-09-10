import { SignJWT, jwtVerify } from "jose";
import type { AccessTokenIssuer } from "./auth.types.js";

const encoder = new TextEncoder();

export class JwtAccessTokenService implements AccessTokenIssuer {
  readonly #secret: Uint8Array;
  readonly #ttlMinutes: number;

  public constructor(secret: string, ttlMinutes: number) {
    this.#secret = encoder.encode(secret);
    this.#ttlMinutes = ttlMinutes;
  }

  public issue(userId: string): Promise<string> {
    return new SignJWT({ tokenType: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${String(this.#ttlMinutes)}m`)
      .sign(this.#secret);
  }

  public async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.#secret, {
        algorithms: ["HS256"],
      });
      return payload.tokenType === "access" && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
