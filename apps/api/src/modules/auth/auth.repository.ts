import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  sessions,
  users,
  type schema as databaseSchema,
} from "@approveflow/database";
import type {
  AuthRepository,
  NewRefreshSession,
  RefreshSession,
} from "./auth.types.js";

type Database = NodePgDatabase<typeof databaseSchema>;

function mapSession(session: typeof sessions.$inferSelect): RefreshSession {
  return {
    id: session.id,
    userId: session.userId,
    tokenFamilyId: session.tokenFamilyId,
    refreshTokenHash: session.refreshTokenHash,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    replacedBySessionId: session.replacedBySessionId,
  };
}

export class DrizzleAuthRepository implements AuthRepository {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async findUserByNormalizedEmail(email: string) {
    const [user] = await this.#database
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    return user ?? null;
  }

  public async createSession(session: NewRefreshSession): Promise<void> {
    await this.#database.insert(sessions).values(session);
  }

  public async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<RefreshSession | null> {
    const [session] = await this.#database
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, tokenHash))
      .limit(1);
    return session ? mapSession(session) : null;
  }

  public rotateSession(input: {
    readonly currentSessionId: string;
    readonly currentTokenHash: string;
    readonly replacement: NewRefreshSession;
    readonly usedAt: Date;
  }): Promise<boolean> {
    return this.#database.transaction(async (transaction) => {
      const [rotated] = await transaction
        .update(sessions)
        .set({
          revokedAt: input.usedAt,
          lastUsedAt: input.usedAt,
          replacedBySessionId: input.replacement.id,
          updatedAt: input.usedAt,
        })
        .where(
          and(
            eq(sessions.id, input.currentSessionId),
            eq(sessions.refreshTokenHash, input.currentTokenHash),
            isNull(sessions.revokedAt),
            isNull(sessions.replacedBySessionId),
          ),
        )
        .returning({ id: sessions.id });

      if (!rotated) return false;
      await transaction.insert(sessions).values(input.replacement);
      return true;
    });
  }

  public async revokeTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.#database
      .update(sessions)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(
        and(
          eq(sessions.tokenFamilyId, tokenFamilyId),
          isNull(sessions.revokedAt),
        ),
      );
  }

  public async revokeSessionByTokenHash(
    tokenHash: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.#database
      .update(sessions)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(
        and(
          eq(sessions.refreshTokenHash, tokenHash),
          isNull(sessions.revokedAt),
        ),
      );
  }
}
