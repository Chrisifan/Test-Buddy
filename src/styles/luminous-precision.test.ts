import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';

import { readCssWithLocalImports, readLuminousPrecisionCss } from './luminous-precision.test-utils.js';

const precisionLayerImports = [
  "@import './luminous-precision/base.css';",
  "@import './luminous-precision/workspace.css';",
  "@import './luminous-precision/assets.css';",
  "@import './luminous-precision/test-design.css';",
  "@import './luminous-precision/settings-responsive.css';",
  "@import './luminous-precision/workbench-views.css';",
  "@import './luminous-precision/startup.css';",
  "@import './luminous-precision/page-details.css';",
];

const precisionLayerPaths = precisionLayerImports.map((statement) =>
  statement.match(/'([^']+)'/)?.[1] ?? '',
);

const writeCssFixture = async (files: Record<string, string>) => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'test-buddy-css-'));

  await Promise.all(
    Object.entries(files).map(async ([path, contents]) => {
      const filePath = resolve(fixtureDirectory, path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }),
  );

  return fixtureDirectory;
};

test('stylesheet entrypoint imports the ordered precision layers', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/styles/luminous-precision.css'), 'utf8');

  expect(source.match(/^@import .+;$/gm)).toEqual(precisionLayerImports);
});

test('resolves precision layers into one stylesheet in entrypoint order', async () => {
  const [layerSources, styles] = await Promise.all([
    Promise.all(
      precisionLayerPaths.map((layerPath) =>
        readFile(resolve(process.cwd(), 'src/styles', layerPath), 'utf8'),
      ),
    ),
    Promise.resolve(readLuminousPrecisionCss()),
  ]);

  let previousLayerIndex = -1;
  layerSources.forEach((layerSource) => {
    const layerIndex = styles.indexOf(layerSource);

    expect(layerIndex).toBeGreaterThan(previousLayerIndex);
    previousLayerIndex = layerIndex;
  });
});

test('rejects imports that escape the CSS root', async () => {
  const fixtureDirectory = await writeCssFixture({
    'outside.css': '.outside { color: red; }',
    'styles/entry.css': "@import '../outside.css';",
  });

  try {
    const cssRoot = resolve(fixtureDirectory, 'styles');
    const entryPath = resolve(cssRoot, 'entry.css');

    expect(() => readCssWithLocalImports(entryPath, cssRoot)).toThrow(/outside the CSS root/);
  } finally {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

test('rejects circular local import chains', async () => {
  const fixtureDirectory = await writeCssFixture({
    'styles/entry.css': "@import './nested.css';",
    'styles/nested.css': "@import './entry.css';",
  });

  try {
    const cssRoot = resolve(fixtureDirectory, 'styles');
    const entryPath = resolve(cssRoot, 'entry.css');

    expect(() => readCssWithLocalImports(entryPath, cssRoot)).toThrow(
      /Circular CSS import detected: .*entry\.css.*nested\.css.*entry\.css/,
    );
  } finally {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

test('rejects conditional CSS imports it cannot flatten faithfully', async () => {
  const fixtureDirectory = await writeCssFixture({
    'styles/base.css': '.base { color: blue; }',
    'styles/entry.css': "@import './base.css' layer(theme);",
  });

  try {
    const cssRoot = resolve(fixtureDirectory, 'styles');
    const entryPath = resolve(cssRoot, 'entry.css');

    expect(() => readCssWithLocalImports(entryPath, cssRoot)).toThrow(
      /Unsupported CSS import.*layer\(theme\)/,
    );
  } finally {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

test('leaves import-like text in CSS comments and strings unchanged', async () => {
  const fixtureDirectory = await writeCssFixture({
    'styles/base.css': '.base { color: blue; }',
    'styles/entry.css': [
      "/* @import './comment.css'; */",
      ".example::before { content: \"@import './string.css';\"; }",
      "@import './base.css';",
    ].join('\n'),
  });

  try {
    const cssRoot = resolve(fixtureDirectory, 'styles');
    const entryPath = resolve(cssRoot, 'entry.css');
    const styles = readCssWithLocalImports(entryPath, cssRoot);

    expect(styles).toContain("/* @import './comment.css'; */");
    expect(styles).toContain("content: \"@import './string.css';\"");
    expect(styles).toContain('.base { color: blue; }');
  } finally {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

test('leaves import-like text in CSS declarations unchanged', async () => {
  const fixtureDirectory = await writeCssFixture({
    'styles/base.css': '.base { color: blue; }',
    'styles/entry.css': [
      '.logo { background-image: url(icon@import); color: red; }',
      "@import './base.css';",
    ].join('\n'),
  });

  try {
    const cssRoot = resolve(fixtureDirectory, 'styles');
    const entryPath = resolve(cssRoot, 'entry.css');
    const styles = readCssWithLocalImports(entryPath, cssRoot);

    expect(styles).toContain('.logo { background-image: url(icon@import); color: red; }');
    expect(styles).toContain('.base { color: blue; }');
  } finally {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});
