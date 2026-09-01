import { describe, expect, it } from 'vitest';

import {
  createAcceptanceAttempt,
  evaluateReleaseGate,
  type AcceptanceMatrix,
} from './acceptance.js';

const hash = (value: string) => {
  const hex = Array.from(value).map((character) => (character.charCodeAt(0) % 16).toString(16)).join('');
  return hex.padEnd(64, 'a').slice(0, 64);
};

const localMatrix: AcceptanceMatrix = {
  schemaVersion: 1,
  targets: [{ id: 'local-fixture', kind: 'localFixture', configFingerprint: hash('local'), requiredForRelease: true }],
};

function localAttempts() {
  return Array.from({ length: 10 }, (_, attemptIndex) => createAcceptanceAttempt({
    targetId: 'local-fixture',
    targetKind: 'localFixture',
    targetConfigFingerprint: hash('local'),
    suite: { id: 'suite-local-fixture', version: 1 },
    projectRevision: hash('project'),
    attempt: attemptIndex + 1,
    pairs: Array.from({ length: 20 }, (_, pairIndex) => ({
      testCase: { id: `case-${String(pairIndex + 1).padStart(2, '0')}`, version: 1 },
      desktop: { status: 'passed', provenanceHash: hash(`desktop-${pairIndex}`), manifestHashes: [hash(`desktop-artifact-${pairIndex}`)] },
      cli: { status: 'passed', provenanceHash: hash(`desktop-${pairIndex}`), manifestHashes: [hash(`desktop-artifact-${pairIndex}`)] },
    })),
    terminalSummary: { passed: 20, failed: 0, blocked: 0, error: 0, cancelled: 0, skipped: 0 },
    retries: 0,
    flaky: false,
    humanConclusion: 'accepted',
  }));
}

function asAttemptInput(attempt: ReturnType<typeof localAttempts>[number]) {
  const { schemaVersion: _schemaVersion, ...input } = attempt;
  return input;
}

describe('acceptance matrix release gate', () => {
  it('permits an evidenced local-only release claim after twenty matching pairs remain stable for ten attempts', () => {
    expect(evaluateReleaseGate(localMatrix, localAttempts())).toMatchObject({
      status: 'readyForLocalReleaseClaim',
      passedPairs: 20,
      stableAttempts: 10,
      laneStates: [{ targetId: 'local-fixture', status: 'passed' }],
    });
  });

  it('blocks a release claim when a release-required model lane has not been run', () => {
    const matrix: AcceptanceMatrix = {
      ...localMatrix,
      targets: [
        ...localMatrix.targets,
        { id: 'model-acceptance', kind: 'model', configFingerprint: hash('model'), requiredForRelease: true },
      ],
    };

    const decision = evaluateReleaseGate(matrix, localAttempts());
    expect(decision).toMatchObject({
      status: 'blocked',
      reasons: expect.arrayContaining(['modelAcceptanceNotRun']),
    });
    expect(decision.laneStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'model-acceptance', status: 'notRun' }),
    ]));
  });

  it('requires exactly ten attempts rather than accepting a duplicate attempt number', () => {
    const attempts = localAttempts();
    const duplicate = createAcceptanceAttempt({ ...asAttemptInput(attempts[0]!), attempt: 1 });

    expect(evaluateReleaseGate(localMatrix, [...attempts, duplicate])).toMatchObject({
      status: 'blocked',
      reasons: ['localFixtureAcceptanceIncomplete'],
      laneStates: [{ targetId: 'local-fixture', status: 'incomplete' }],
    });
  });

  it('rejects a mismatched pair, incomplete evidence, and unsafe report content before gate evaluation', () => {
    const source = localAttempts()[0]!;
    const mismatched = {
      ...source,
      pairs: source.pairs.map((pair, index) => index === 0 ? {
        ...pair,
        cli: { ...pair.cli, provenanceHash: hash('different') },
      } : pair),
    };
    const unsafe = {
      ...asAttemptInput(source),
      terminalSummary: { ...source.terminalSummary, note: 'apiKey=sk-live-unsafe /private/report.json' },
    };

    expect(() => createAcceptanceAttempt(asAttemptInput(mismatched))).toThrow(/pair/i);
    expect(() => createAcceptanceAttempt(unsafe)).toThrow(/redacted|unsafe/i);
  });
});
