import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createInitialStudioState, type StudioState } from '../shared/studio.js';

export interface StudioStoreFileSystem {
  rename(source: string, destination: string): Promise<void>;
}

export class StudioStore {
  private readonly dataDir: string;
  private readonly statePath: string;

  constructor(
    rootDir: string,
    private readonly fileSystem: StudioStoreFileSystem = fs,
  ) {
    this.dataDir = path.join(rootDir, 'studio-data');
    this.statePath = path.join(this.dataDir, 'state.json');
  }

  get storagePath(): string {
    return this.statePath;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async load(): Promise<StudioState> {
    await this.ensureReady();

    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      return JSON.parse(content) as StudioState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const initialState = createInitialStudioState();
        await this.save(initialState);
        return initialState;
      }

      throw error;
    }
  }

  async loadExisting(): Promise<StudioState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      return JSON.parse(content) as StudioState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`未找到 TestBuddy 状态文件：${this.statePath}`);
      }

      throw error;
    }
  }

  async save(state: StudioState): Promise<void> {
    await this.ensureReady();
    const stagingPath = path.join(this.dataDir, `.state-staging-${randomUUID()}.json`);
    try {
      await fs.writeFile(stagingPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await this.fileSystem.rename(stagingPath, this.statePath);
    } catch (error) {
      await fs.rm(stagingPath, { force: true });
      throw error;
    }
  }
}
