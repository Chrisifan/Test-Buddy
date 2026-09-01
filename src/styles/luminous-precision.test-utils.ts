import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const defaultCssRoot = resolve(process.cwd(), 'src/styles');

const isCssIdentifierContinuation = (character: string | undefined): boolean =>
  character !== undefined && /[a-zA-Z0-9_-]/.test(character);

const consumeCssComment = (source: string, start: number): number => {
  const commentEnd = source.indexOf('*/', start + 2);

  return commentEnd === -1 ? source.length : commentEnd + 2;
};

const consumeCssString = (source: string, start: number): number => {
  const quote = source[start];
  let cursor = start + 1;

  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }

    if (source[cursor] === quote) {
      return cursor + 1;
    }

    cursor += 1;
  }

  return source.length;
};

const findImportRuleEnd = (source: string, start: number): number => {
  let cursor = start;
  let parenthesisDepth = 0;

  while (cursor < source.length) {
    if (source.startsWith('/*', cursor)) {
      cursor = consumeCssComment(source, cursor);
      continue;
    }

    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = consumeCssString(source, cursor);
      continue;
    }

    if (source[cursor] === '(') {
      parenthesisDepth += 1;
    } else if (source[cursor] === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (source[cursor] === ';' && parenthesisDepth === 0) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
};

const replaceCssImportRules = (
  source: string,
  resolveImport: (importExpression: string) => string,
): string => {
  let cursor = 0;
  let flattenedSource = '';
  let blockDepth = 0;
  let parenthesisDepth = 0;

  while (cursor < source.length) {
    if (source.startsWith('/*', cursor)) {
      const commentEnd = consumeCssComment(source, cursor);
      flattenedSource += source.slice(cursor, commentEnd);
      cursor = commentEnd;
      continue;
    }

    if (source[cursor] === '"' || source[cursor] === "'") {
      const stringEnd = consumeCssString(source, cursor);
      flattenedSource += source.slice(cursor, stringEnd);
      cursor = stringEnd;
      continue;
    }

    if (source[cursor] === '{') {
      blockDepth += 1;
    } else if (source[cursor] === '}') {
      blockDepth = Math.max(0, blockDepth - 1);
    } else if (source[cursor] === '(') {
      parenthesisDepth += 1;
    } else if (source[cursor] === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    }

    if (
      blockDepth === 0 &&
      parenthesisDepth === 0 &&
      source.startsWith('@import', cursor) &&
      !isCssIdentifierContinuation(source[cursor + '@import'.length])
    ) {
      const importRuleEnd = findImportRuleEnd(source, cursor + '@import'.length);
      if (importRuleEnd >= 0) {
        const importExpression = source.slice(cursor + '@import'.length, importRuleEnd);

        flattenedSource += resolveImport(importExpression);
        cursor = importRuleEnd + 1;
        continue;
      }
    }

    flattenedSource += source[cursor];
    cursor += 1;
  }

  return flattenedSource;
};

const assertPathWithinCssRoot = (stylesheetPath: string, cssRoot: string): void => {
  const relativePath = relative(cssRoot, stylesheetPath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(
    `Cannot resolve CSS import "${stylesheetPath}" outside the CSS root "${cssRoot}".`,
  );
};

const parseLocalImportPath = (importExpression: string, stylesheetPath: string): string => {
  const expression = importExpression.trim();
  const quotedPath = /^(['"])([^'"]+)\1$/.exec(expression)?.[2];
  const urlPath = /^url\(\s*(?:(['"])([^'"]+)\1|([^'"()\s]+))\s*\)$/.exec(expression);
  const unquotedPath = /^[^'"()\s]+$/.exec(expression)?.[0];
  const importPath = quotedPath ?? urlPath?.[2] ?? urlPath?.[3] ?? unquotedPath;

  if (!importPath) {
    throw new Error(
      `Unsupported CSS import "${expression}" from "${stylesheetPath}". Only a single local path or url(...) is supported.`,
    );
  }

  if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
    throw new Error(
      `Cannot resolve nonlocal CSS import "${importPath}" from "${stylesheetPath}". Only relative local imports are supported.`,
    );
  }

  return importPath;
};

const readCssImports = (stylesheetPath: string, cssRoot: string, activeImportChain: string[]): string => {
  const canonicalStylesheetPath = realpathSync(stylesheetPath);
  assertPathWithinCssRoot(canonicalStylesheetPath, cssRoot);

  const cycleStart = activeImportChain.indexOf(canonicalStylesheetPath);
  if (cycleStart >= 0) {
    const importChain = [...activeImportChain.slice(cycleStart), canonicalStylesheetPath].join(' -> ');

    throw new Error(`Circular CSS import detected: ${importChain}`);
  }

  const source = readFileSync(canonicalStylesheetPath, 'utf8');

  return replaceCssImportRules(source, (importExpression) => {
    const importPath = parseLocalImportPath(importExpression, canonicalStylesheetPath);
    const importedStylesheetPath = resolve(dirname(canonicalStylesheetPath), importPath);

    return readCssImports(importedStylesheetPath, cssRoot, [...activeImportChain, canonicalStylesheetPath]);
  });
};

export const readCssWithLocalImports = (stylesheetPath: string, cssRoot = defaultCssRoot): string => {
  const canonicalCssRoot = realpathSync(cssRoot);

  return readCssImports(stylesheetPath, canonicalCssRoot, []);
};

export const readLuminousPrecisionCss = (): string =>
  readCssWithLocalImports(resolve(defaultCssRoot, 'luminous-precision.css'));
