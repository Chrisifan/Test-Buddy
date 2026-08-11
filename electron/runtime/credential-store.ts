import fs from 'node:fs/promises';
import path from 'node:path';

import { safeStorage } from 'electron';

import type { CredentialRef, SaveCredentialRequest, TestInputValueBinding } from '../../shared/studio.js';

interface StoredCredential extends CredentialRef {
  projectId?: string;
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
      projectId: request.projectId,
      encryptedSecret: this.encrypt(request.secret),
    });
    await fs.writeFile(this.credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
    return ref;
  }

  async resolve(request: { projectId: string; binding: TestInputValueBinding }): Promise<string> {
    const binding = request.binding;
    if (binding.kind !== 'credential') {
      throw new Error('Fixture 输出绑定必须在对应的 Case 运行中解析。');
    }
    const credential = (await this.loadStoredCredentials()).find(
      (candidate) => candidate.id === binding.credentialId && candidate.projectId === request.projectId,
    );
    if (!credential) {
      throw new Error('凭据引用不存在、不属于当前项目，或需要重新保存后才能使用。');
    }

    if (binding.field === 'username') {
      if (!credential.username?.trim()) {
        throw new Error('所选凭据没有可用于输入的用户名。');
      }
      return credential.username;
    }

    if (!credential.hasSecret) {
      throw new Error('所选凭据没有可用于输入的密钥。');
    }
    return this.decrypt(credential.encryptedSecret);
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
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('本机安全存储不可用，无法保存可执行凭据。');
    }
    return `safe:${safeStorage.encryptString(secret).toString('base64')}`;
  }

  private decrypt(encryptedSecret: string): string {
    if (!encryptedSecret.startsWith('safe:') || !safeStorage.isEncryptionAvailable()) {
      throw new Error('凭据密钥无法通过本机安全存储解析。');
    }
    try {
      return safeStorage.decryptString(Buffer.from(encryptedSecret.slice('safe:'.length), 'base64'));
    } catch {
      throw new Error('凭据密钥已损坏或无法解密。');
    }
  }
}
