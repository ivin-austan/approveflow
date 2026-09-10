import { randomUUID } from "node:crypto";
import { generateRefreshToken, hashRefreshToken } from "./auth.crypto.js";
import type {
  AccessTokenIssuer,
  AuthRepository,
  PasswordVerifier,
} from "./auth.types.js";

export class InvalidCredentialsError extends Error {}
export class InvalidRefreshTokenError extends Error {}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface AuthServiceOptions {
  readonly refreshTokenTtlDays: number;
  readonly now?: () => Date;
}

export class AuthService {
  readonly #repository: AuthRepository;
  readonly #passwordVerifier: PasswordVerifier;
  readonly #accessTokenIssuer: AccessTokenIssuer;
  readonly #refreshTokenTtlDays: number;
  readonly #now: () => Date;

  public constructor(
    repository: AuthRepository,
    passwordVerifier: PasswordVerifier,
    accessTokenIssuer: AccessTokenIssuer,
    options: AuthServiceOptions,
  ) {
    this.#repository = repository;
    this.#passwordVerifier = passwordVerifier;
    this.#accessTokenIssuer = accessTokenIssuer;
    this.#refreshTokenTtlDays = options.refreshTokenTtlDays;
    this.#now = options.now ?? (() => new Date());
  }

  public async login(email: string, password: string): Promise<TokenPair> {
    const normalizedEmail = email.trim().toLowerCase();
    const user =
      await this.#repository.findUserByNormalizedEmail(normalizedEmail);
    const passwordIsValid =
      user === null
        ? false
        : await this.#passwordVerifier.verify(user.passwordHash, password);

    if (user?.status !== "ACTIVE" || !passwordIsValid) {
      throw new InvalidCredentialsError("Invalid email or password");
    }

    const refreshToken = generateRefreshToken();
    await this.#repository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenFamilyId: randomUUID(),
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: this.#expiryFrom(this.#now()),
    });

    return {
      accessToken: await this.#accessTokenIssuer.issue(user.id),
      refreshToken,
    };
  }

  public async refresh(refreshToken: string): Promise<TokenPair> {
    const usedAt = this.#now();
    const tokenHash = hashRefreshToken(refreshToken);
    const current = await this.#repository.findSessionByTokenHash(tokenHash);

    if (!current) {
      throw new InvalidRefreshTokenError("Invalid refresh token");
    }

    if (current.revokedAt || current.replacedBySessionId) {
      await this.#repository.revokeTokenFamily(current.tokenFamilyId, usedAt);
      throw new InvalidRefreshTokenError("Invalid refresh token");
    }

    if (current.expiresAt <= usedAt) {
      await this.#repository.revokeSessionByTokenHash(tokenHash, usedAt);
      throw new InvalidRefreshTokenError("Invalid refresh token");
    }

    const replacementToken = generateRefreshToken();
    const rotated = await this.#repository.rotateSession({
      currentSessionId: current.id,
      currentTokenHash: tokenHash,
      replacement: {
        id: randomUUID(),
        userId: current.userId,
        tokenFamilyId: current.tokenFamilyId,
        refreshTokenHash: hashRefreshToken(replacementToken),
        expiresAt: this.#expiryFrom(usedAt),
      },
      usedAt,
    });

    if (!rotated) {
      await this.#repository.revokeTokenFamily(current.tokenFamilyId, usedAt);
      throw new InvalidRefreshTokenError("Invalid refresh token");
    }

    return {
      accessToken: await this.#accessTokenIssuer.issue(current.userId),
      refreshToken: replacementToken,
    };
  }

  public async logout(refreshToken: string): Promise<void> {
    await this.#repository.revokeSessionByTokenHash(
      hashRefreshToken(refreshToken),
      this.#now(),
    );
  }

  #expiryFrom(date: Date): Date {
    const expiresAt = new Date(date);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + this.#refreshTokenTtlDays);
    return expiresAt;
  }
}
