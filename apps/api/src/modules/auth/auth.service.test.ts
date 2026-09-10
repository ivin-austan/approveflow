import { describe, expect, it, vi } from "vitest";
import { hashRefreshToken } from "./auth.crypto.js";
import {
  AuthService,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from "./auth.service.js";
import type {
  AuthRepository,
  AuthenticatedUser,
  NewRefreshSession,
  RefreshSession,
} from "./auth.types.js";

const now = new Date("2026-09-10T08:00:00.000Z");

class MemoryAuthRepository implements AuthRepository {
  public readonly users: AuthenticatedUser[] = [];
  public readonly sessions: RefreshSession[] = [];
  public revokedFamilies: string[] = [];

  public findUserByNormalizedEmail(
    email: string,
  ): Promise<AuthenticatedUser | null> {
    return Promise.resolve(
      this.users.find((user) => user.email === email) ?? null,
    );
  }

  public createSession(session: NewRefreshSession): Promise<void> {
    this.sessions.push({
      ...session,
      revokedAt: null,
      replacedBySessionId: null,
    });
    return Promise.resolve();
  }

  public findSessionByTokenHash(
    tokenHash: string,
  ): Promise<RefreshSession | null> {
    return Promise.resolve(
      this.sessions.find((session) => session.refreshTokenHash === tokenHash) ??
        null,
    );
  }

  public async rotateSession(input: {
    readonly currentSessionId: string;
    readonly currentTokenHash: string;
    readonly replacement: NewRefreshSession;
    readonly usedAt: Date;
  }): Promise<boolean> {
    const index = this.sessions.findIndex(
      (session) =>
        session.id === input.currentSessionId &&
        session.refreshTokenHash === input.currentTokenHash &&
        !session.revokedAt &&
        !session.replacedBySessionId,
    );
    const current = this.sessions[index];
    if (index < 0 || !current) return false;

    this.sessions[index] = {
      ...current,
      revokedAt: input.usedAt,
      replacedBySessionId: input.replacement.id,
    };
    await this.createSession(input.replacement);
    return true;
  }

  public revokeTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
  ): Promise<void> {
    this.revokedFamilies.push(tokenFamilyId);
    for (const [index, session] of this.sessions.entries()) {
      if (session.tokenFamilyId === tokenFamilyId && !session.revokedAt) {
        this.sessions[index] = { ...session, revokedAt };
      }
    }
    return Promise.resolve();
  }

  public revokeSessionByTokenHash(
    tokenHash: string,
    revokedAt: Date,
  ): Promise<void> {
    const index = this.sessions.findIndex(
      (session) => session.refreshTokenHash === tokenHash,
    );
    const session = this.sessions[index];
    if (index >= 0 && session && !session.revokedAt) {
      this.sessions[index] = { ...session, revokedAt };
    }
    return Promise.resolve();
  }
}

function setup(status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  const repository = new MemoryAuthRepository();
  repository.users.push({
    id: "user-1",
    email: "person@example.com",
    fullName: "Test Person",
    passwordHash: "stored-hash",
    status,
  });
  const verify = vi.fn((_hash: string, password: string) =>
    Promise.resolve(password === "correct"),
  );
  const issue = vi.fn((userId: string) => Promise.resolve(`access:${userId}`));
  const service = new AuthService(
    repository,
    { verify },
    { issue },
    { refreshTokenTtlDays: 30, now: () => now },
  );
  return { repository, service, verify, issue };
}

describe("AuthService", () => {
  it("normalizes email and creates a hashed refresh session", async () => {
    const { repository, service } = setup();

    const result = await service.login(" Person@Example.com ", "correct");

    expect(result.accessToken).toBe("access:user-1");
    expect(result.refreshToken).not.toBe(
      repository.sessions[0]?.refreshTokenHash,
    );
    expect(repository.sessions[0]?.refreshTokenHash).toBe(
      hashRefreshToken(result.refreshToken),
    );
    expect(repository.sessions[0]?.expiresAt).toEqual(
      new Date("2026-10-10T08:00:00.000Z"),
    );
  });

  it.each([
    ["unknown@example.com", "correct"],
    ["person@example.com", "wrong"],
  ])(
    "returns the same failure for invalid credentials",
    async (email, password) => {
      const { service } = setup();
      await expect(service.login(email, password)).rejects.toThrow(
        InvalidCredentialsError,
      );
    },
  );

  it("rejects disabled users", async () => {
    const { service } = setup("DISABLED");
    await expect(
      service.login("person@example.com", "correct"),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rotates a refresh token while retaining its family", async () => {
    const { repository, service } = setup();
    const login = await service.login("person@example.com", "correct");
    const original = repository.sessions[0];

    const refreshed = await service.refresh(login.refreshToken);

    expect(refreshed.accessToken).toBe("access:user-1");
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);
    expect(repository.sessions).toHaveLength(2);
    expect(repository.sessions[0]?.replacedBySessionId).toBe(
      repository.sessions[1]?.id,
    );
    expect(repository.sessions[1]?.tokenFamilyId).toBe(original?.tokenFamilyId);
  });

  it("revokes the token family when a rotated token is reused", async () => {
    const { repository, service } = setup();
    const login = await service.login("person@example.com", "correct");
    await service.refresh(login.refreshToken);

    await expect(service.refresh(login.refreshToken)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
    expect(repository.revokedFamilies).toEqual([
      repository.sessions[0]?.tokenFamilyId,
    ]);
    expect(repository.sessions.every((session) => session.revokedAt)).toBe(
      true,
    );
  });

  it("revokes the current session on logout", async () => {
    const { repository, service } = setup();
    const login = await service.login("person@example.com", "correct");

    await service.logout(login.refreshToken);

    expect(repository.sessions[0]?.revokedAt).toEqual(now);
  });
});
