export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly status: "ACTIVE" | "DISABLED";
}

export interface RefreshSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedBySessionId: string | null;
}

export interface NewRefreshSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
}

export interface AuthRepository {
  findUserByNormalizedEmail(email: string): Promise<AuthenticatedUser | null>;
  createSession(session: NewRefreshSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<RefreshSession | null>;
  rotateSession(input: {
    readonly currentSessionId: string;
    readonly currentTokenHash: string;
    readonly replacement: NewRefreshSession;
    readonly usedAt: Date;
  }): Promise<boolean>;
  revokeTokenFamily(tokenFamilyId: string, revokedAt: Date): Promise<void>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
}

export interface AccessTokenIssuer {
  issue(userId: string): Promise<string>;
}

export interface PasswordVerifier {
  verify(passwordHash: string, password: string): Promise<boolean>;
}
