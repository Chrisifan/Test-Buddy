import fs from 'node:fs/promises';
import path from 'node:path';

import { safeStorage } from 'electron';

import type { CredentialRef, SaveCredentialRequest } from '../../shared/studio.js';

interface StoredCredential extends CredentialRef {
  encryptedSecret: string;
}

export class CredentialStore {
  private readonly credentialsDir: string;
  private readonly credentialsPath: string;

  constructor(rootDir: string) {
    this.credentialsDir = path.join(rootDir, 'studio-data', 'credentials');
    this.credentialsPath = path.join(this.credentialsDir, 'credentials.json');
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.credentialsDir, { recursive: true });
  }

  async save(request: SaveCredentialRequest): Promise<CredentialRef> {
    await this.ensureReady();
    const credentials = await this.loadStoredCredentials();
    const now = new Date().toISOString();
    const ref: CredentialRef = {
      id: `cred-${Date.now()}`,
      label: request.label,
      kind: request.kind,
      username: request.username,
      updatedAt: now,
      hasSecret: Boolean(request.secret),
    };

    credentials.push({
      ...ref,
      encryptedSecret: this.encrypt(request.secret),
    });
    await fs.writeFile(this.credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
    return ref;
  }

  private async loadStoredCredentials(): Promise<StoredCredential[]> {
    try {
      const content = await fs.readFile(this.credentialsPath, 'utf8');
      return JSON.parse(content) as StoredCredential[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private encrypt(secret: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(secret).toString('base64')}`;
    }

    return `plain-fallback:${Buffer.from(secret, 'utf8').toString('base64')}`;
  }
}
