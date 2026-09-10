import { createHash, randomBytes } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";

const argon2idOptions: Options = {
  algorithm: 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, argon2idOptions);
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
