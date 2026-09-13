import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ArtifactStorage } from "./artifact.service.js";

export class FileSystemArtifactStorage implements ArtifactStorage {
  private readonly root: string;
  public constructor(root: string) {
    this.root = resolve(root);
  }
  public async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.target(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  public async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.target(key)));
  }
  public async delete(key: string): Promise<void> {
    await rm(this.target(key), { force: true });
  }
  private target(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(`${this.root}${sep}`))
      throw new Error("Invalid artifact object key");
    return target;
  }
}
