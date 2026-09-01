import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { expect, test } from 'vitest';

const sourceRoots = ['src', 'electron', 'shared', 'scripts'];
const sourceExtensions = new Set(['.ts', '.tsx', '.cts', '.mts']);
const ignoredSourceDirectoryNames = new Set(['fixtures', 'generated']);

const isIgnoredSourcePath = (path: string): boolean => path
  .split(/[\\/]/u)
  .some((segment) => ignoredSourceDirectoryNames.has(segment));

const isApplicationSourcePath = (path: string): boolean =>
  sourceExtensions.has(path.slice(path.lastIndexOf('.')))
  && !path.endsWith('.d.ts')
  && !path.includes('.test.')
  && !path.includes('.spec.')
  && !isIgnoredSourcePath(path);

const collectApplicationSourcePaths = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const childPaths = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredSourceDirectoryNames.has(entry.name)) {
        return [];
      }
      return collectApplicationSourcePaths(entryPath);
    }
    return isApplicationSourcePath(entryPath) ? [entryPath] : [];
  }));
  return childPaths.flat();
};

const functionName = (node: ts.FunctionDeclaration | ts.FunctionExpression): string => {
  if (node.name) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return '<anonymous>';
};

const findOrdinaryFunctions = async (sourcePath: string): Promise<string[]> => {
  const sourceText = await readFile(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true);
  const functions: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.body) {
      functions.push(`${relative(process.cwd(), sourcePath)}:${functionName(node)}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
};

test('ordinary function expressions are rejected without flagging class methods or accessors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'testbuddy-function-style-'));
  const sourcePath = join(directory, 'sample.ts');
  await writeFile(sourcePath, `
    const helper = function () { return 'helper'; };
    class Example {
      method() { return 'method'; }
      get value() { return 'value'; }
      set value(next: string) { void next; }
    }
  `, 'utf8');

  try {
    await expect(findOrdinaryFunctions(sourcePath)).resolves.toEqual([
      `${relative(process.cwd(), sourcePath)}:helper`,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generated source paths are excluded from the arrow-function contract', () => {
  expect(isApplicationSourcePath('/repository/src/generated/client.ts')).toBe(false);
});

test('application sources use arrow functions instead of ordinary function declarations', async () => {
  const sourcePaths = (await Promise.all(
    sourceRoots.map((sourceRoot) => collectApplicationSourcePaths(resolve(process.cwd(), sourceRoot))),
  )).flat();
  const functions = (await Promise.all(sourcePaths.map(findOrdinaryFunctions))).flat();

  expect(functions, functions.join('\n')).toEqual([]);
});
