import { describe, expect, it } from 'vitest';

import type { RecordingAsset, TestCaseDraft } from './studio.js';
import { detachRecordingFromTestCases, findDefaultRecordingForCaseStep } from './studio.js';

describe('findDefaultRecordingForCaseStep', () => {
  it('prefers recordings from the same group and environment', () => {
    const recordings = [
      recording({ id: 'other-group', groupId: 'group-b', environmentId: 'env-a' }),
      recording({ id: 'same-group-other-env', groupId: 'group-a', environmentId: 'env-b' }),
      recording({ id: 'same-group-env', groupId: 'group-a', environmentId: 'env-a' }),
    ];

    expect(findDefaultRecordingForCaseStep(recordings, 'group-a', 'env-a')?.id).toBe('same-group-env');
  });

  it('falls back to the same environment before using the first recording', () => {
    const recordings = [
      recording({ id: 'first', groupId: 'group-b', environmentId: 'env-b' }),
      recording({ id: 'same-env', groupId: 'group-b', environmentId: 'env-a' }),
    ];

    expect(findDefaultRecordingForCaseStep(recordings, 'group-a', 'env-a')?.id).toBe('same-env');
  });
});

describe('detachRecordingFromTestCases', () => {
  it('clears deleted recording references without removing test steps', () => {
    const testCases = [
      testCase({
        id: 'case-a',
        steps: [
          {
            id: 'step-a',
            type: 'recordingReplay',
            title: '回放旧录制',
            body: '回放录制资产「旧录制」',
            recordingId: 'recording-old',
          },
          {
            id: 'step-b',
            type: 'aiAssert',
            title: '断言',
            body: '页面稳定',
          },
        ],
      }),
      testCase({
        id: 'case-b',
        steps: [
          {
            id: 'step-c',
            type: 'recordingReplay',
            title: '回放其他录制',
            body: '回放录制资产「其他」',
            recordingId: 'recording-other',
          },
        ],
      }),
    ];

    const result = detachRecordingFromTestCases(testCases, 'recording-old');

    expect(result.affectedSteps).toBe(1);
    expect(result.testCases[0].steps).toHaveLength(2);
    expect(result.testCases[0].steps[0]).toMatchObject({
      id: 'step-a',
      type: 'recordingReplay',
      recordingId: undefined,
      body: '原绑定录制资产已删除，请重新选择录制资产后再执行回放。',
    });
    expect(result.testCases[1].steps[0].recordingId).toBe('recording-other');
  });
});

const recording = ({
  id,
  groupId,
  environmentId,
}: {
  id: string;
  groupId: string;
  environmentId: string;
}): RecordingAsset => {
  return {
    id,
    name: id,
    summary: '',
    source: 'live',
    groupId,
    environmentId,
    startUrl: 'https://example.test',
    comparisonGoal: '',
    tags: [],
    steps: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
};

const testCase = ({ id, steps }: Pick<TestCaseDraft, 'id' | 'steps'>): TestCaseDraft => {
  return {
    id,
    kind: 'recording',
    groupId: 'group-a',
    environmentId: 'env-a',
    source: 'recording',
    name: id,
    category: '录制回放',
    lastEdited: '刚刚',
    url: 'https://example.test',
    notes: '',
    steps,
  };
};
