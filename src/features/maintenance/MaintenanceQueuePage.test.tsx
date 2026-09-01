import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyProject, createEmptyTestCase } from '../../../shared/studio.js';
import { createMaintenanceDraft } from '../../../shared/maintenance.js';
import { I18nProvider } from '../../i18n/index.js';
import { MaintenanceQueuePage, type MaintenanceQueuePageProps } from './MaintenanceQueuePage.js';

function renderQueue(props: unknown) {
  return render(
    <I18nProvider locale="en-US">
      <MaintenanceQueuePage {...(props as MaintenanceQueuePageProps)} />
    </I18nProvider>,
  );
}

describe('MaintenanceQueuePage', () => {
  it('labels source and candidate diffs, opens exact cited evidence, and requires confirmation before approval', async () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
      steps: [{ id: 'step-login', type: 'manual' as const, title: 'Sign in', body: 'Open the form.' }],
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: 1 },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Wait for the account menu.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'b'.repeat(64) }],
      impact: [{ kind: 'suite', id: 'suite-smoke', version: 1 }],
    });
    const onAccept = vi.fn().mockResolvedValue({ status: 'stale', draft: { ...draft, status: 'stale' } });
    const onReject = vi.fn();
    const onOpenEvidence = vi.fn().mockResolvedValue(undefined);

    renderQueue({ drafts: [draft], onAccept, onReject, onOpenEvidence });

    expect(screen.getByText('case-login@1')).toBeInTheDocument();
    expect(screen.getByText(/Wait for the account menu/)).toBeInTheDocument();
    expect(screen.getByLabelText('Source')).toHaveTextContent('Open the form.');
    expect(screen.getByLabelText('Candidate')).toHaveTextContent('Wait for the account menu.');
    expect(screen.getByText('suite-smoke@1')).toBeInTheDocument();
    expect(screen.getByText('artifact-login')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Open evidence artifact-login' }));
    expect(onOpenEvidence).toHaveBeenCalledWith({
      draftId: draft.id,
      citation: draft.evidence[0],
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open evidence artifact-login' })).toBeEnabled());
    expect(screen.getByText('Audit')).toBeInTheDocument();
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('2026-08-25T00:00:00.000Z')).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve draft' });
    expect(approve).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: `Confirm revision ${draft.projectRevision}` }));
    await fireEvent.click(approve);

    expect(onAccept).toHaveBeenCalledWith({ draftId: draft.id, expectedRevision: draft.projectRevision });
    expect(await screen.findByText('Stale revision')).toBeInTheDocument();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('disables review controls when main-process review capabilities are unavailable', () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Review-only.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'b'.repeat(64) }],
      impact: [],
    });

    renderQueue({ drafts: [draft] });

    expect(screen.getByRole('checkbox', { name: `Confirm revision ${draft.projectRevision}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject draft' })).toBeDisabled();
  });

  it('requires a rationale, blocks duplicate rejection while pending, and exposes rejection failures', async () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Review-only.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'b'.repeat(64) }],
      impact: [],
    });
    let rejectPending: (reason: Error) => void = () => undefined;
    const pendingReject = new Promise<typeof draft>((_resolve, reject) => { rejectPending = reject; });
    const onReject = vi.fn().mockReturnValueOnce(pendingReject).mockRejectedValueOnce(new Error('injected reject failure'));

    renderQueue({ drafts: [draft], onReject });

    const rejectionRationale = screen.getByRole('textbox', { name: 'Reject rationale' });
    const reject = screen.getByRole('button', { name: 'Reject draft' });
    expect(reject).toBeDisabled();

    fireEvent.change(rejectionRationale, { target: { value: 'The cited failure does not reproduce in the pinned environment.' } });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);
    fireEvent.click(reject);
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledWith({
      draftId: draft.id,
      rationale: 'The cited failure does not reproduce in the pinned environment.',
    });
    expect(reject).toBeDisabled();

    await act(async () => rejectPending(new Error('injected pending rejection failure')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not complete the maintenance review action.');
    await waitFor(() => expect(reject).toBeEnabled());

    fireEvent.change(rejectionRationale, { target: { value: 'Retry after the main process failed.' } });
    fireEvent.click(reject);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not complete the maintenance review action.');
  });

  it('shows an action error instead of claiming an approval result when the callback rejects', async () => {
    const project = createEmptyProject(1);
    const source = {
      ...createEmptyTestCase(1, project.groups[0]!.id, project.environments[0]!.id),
      id: 'case-login',
      version: 1,
    };
    const draft = createMaintenanceDraft({
      id: 'maintenance-login',
      createdAt: '2026-08-25T00:00:00.000Z',
      projectId: project.id,
      projectRevision: 'c'.repeat(64),
      target: { kind: 'case', id: source.id, version: source.version },
      baseAssetHash: 'a'.repeat(64),
      sourceCase: source,
      proposedCase: { ...source, notes: 'Review-only.' },
      evidence: [{ runId: 'run-login', artifactId: 'artifact-login', contentHash: 'b'.repeat(64) }],
      impact: [],
    });
    const onAccept = vi.fn().mockRejectedValue(new Error('injected approval failure'));

    renderQueue({ drafts: [draft], onAccept });

    fireEvent.click(screen.getByRole('checkbox', { name: `Confirm revision ${draft.projectRevision}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not complete the maintenance review action.');
    expect(screen.queryByText('Accepted revision')).not.toBeInTheDocument();
  });
});
