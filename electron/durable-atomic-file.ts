import fs from 'node:fs/promises';

export type DurableAtomicFileFileSystem = Pick<typeof fs, 'writeFile' | 'open' | 'rename' | 'rm'>;

export interface DurableAtomicFileWrite {
  directory: string;
  stagingPath: string;
  destinationPath: string;
  content: string;
  fileSystem?: Partial<DurableAtomicFileFileSystem>;
}

/** The replacement may be visible but directory metadata could not be flushed. */
export class DurableAtomicFileCommitError extends Error {
  constructor(cause: unknown) {
    super('文件替换持久化结果不确定。', { cause });
    this.name = 'DurableAtomicFileCommitError';
  }
}

/**
 * Publishes a replacement only after both the staged data and its directory
 * metadata have been flushed to disk.
 */
export const writeDurableAtomicFile = async (write: DurableAtomicFileWrite): Promise<void> => {
  let renamed = false;
  try {
    await (write.fileSystem?.writeFile ?? fs.writeFile)(write.stagingPath, write.content, 'utf8');
    await syncPath(write.stagingPath, write.fileSystem);
    await (write.fileSystem?.rename ?? fs.rename)(write.stagingPath, write.destinationPath);
    renamed = true;
    await syncPath(write.directory, write.fileSystem);
  } catch (error) {
    await (write.fileSystem?.rm ?? fs.rm)(write.stagingPath, { force: true }).catch(() => undefined);
    if (renamed) {
      throw new DurableAtomicFileCommitError(error);
    }
    throw error;
  }
};

export const syncDurableDirectory = async (
  directory: string,
  fileSystem?: Partial<DurableAtomicFileFileSystem>,
): Promise<void> => {
  await syncPath(directory, fileSystem);
};

const syncPath = async (
  targetPath: string,
  fileSystem?: Partial<DurableAtomicFileFileSystem>,
): Promise<void> => {
  const handle = await (fileSystem?.open ?? fs.open)(targetPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
