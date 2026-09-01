import { expect, test } from 'vitest';
import { createEmptyReusableFlowAsset, createNextReusableFlowVersion } from './reusable-flows.js';

test('flow version helpers preserve the published source and increment the latest revision', () => {
  const flowV1 = createEmptyReusableFlowAsset(4);
  const flowV2 = { ...flowV1, version: 2, name: 'Checkout v2' };
  const project = { reusableFlows: [flowV1, flowV2] };

  expect(createNextReusableFlowVersion(project, flowV2, { name: 'Checkout v3' })).toMatchObject({
    id: flowV1.id,
    version: 3,
    name: 'Checkout v3',
  });
  expect(flowV2).toMatchObject({ version: 2, name: 'Checkout v2' });
});
