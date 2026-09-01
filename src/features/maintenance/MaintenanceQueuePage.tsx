import { useMemo, useState } from 'react';

import type { MaintenanceDraft } from '../../../shared/maintenance.js';
import type {
  MaintenanceDraftAcceptanceRequest,
  MaintenanceDraftAcceptanceResult,
  MaintenanceDraftRejectionRequest,
  MaintenanceEvidenceOpenRequest,
} from '../../../shared/studio.js';
import { useI18n } from '../../i18n/index.js';

type ApprovalResult = MaintenanceDraftAcceptanceResult;

export interface MaintenanceQueuePageProps {
  drafts: MaintenanceDraft[];
  onAccept?: (request: MaintenanceDraftAcceptanceRequest) => Promise<ApprovalResult>;
  onReject?: (request: MaintenanceDraftRejectionRequest) => Promise<MaintenanceDraft>;
  onOpenEvidence?: (request: MaintenanceEvidenceOpenRequest) => Promise<void>;
}

export function MaintenanceQueuePage({ drafts, onAccept, onReject, onOpenEvidence }: MaintenanceQueuePageProps) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [rejectionRationales, setRejectionRationales] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, MaintenanceDraft['status']>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const ordered = useMemo(() => [...drafts].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [drafts]);

  async function runDraftAction(draftId: string, action: () => Promise<void>) {
    setErrors((current) => ({ ...current, [draftId]: false }));
    setPending((current) => ({ ...current, [draftId]: true }));
    try {
      await action();
    } catch {
      setErrors((current) => ({ ...current, [draftId]: true }));
    } finally {
      setPending((current) => ({ ...current, [draftId]: false }));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <p className="text-xs font-medium uppercase text-[var(--muted-foreground)]">{t('maintenance.kicker')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{t('maintenance.title')}</h1>
        </div>
        <span className="text-sm text-[var(--muted-foreground)]">{t('maintenance.count', { count: ordered.length })}</span>
      </header>

      {ordered.length ? ordered.map((draft) => {
        const confirmationLabel = t('maintenance.confirmRevision', { revision: draft.projectRevision });
        const outcome = outcomes[draft.id];
        const isPending = Boolean(pending[draft.id]);
        const isDraft = draft.status === 'draft' && !outcome;
        const canReview = isDraft && !isPending;
        const canAccept = canReview && Boolean(onAccept);
        const canReject = canReview && Boolean(onReject);
        const rationale = rejectionRationales[draft.id] ?? '';
        return (
          <article key={draft.id} className="border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--foreground)]">{draft.target.id}@{draft.target.version}</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{maintenanceStatusLabel(draft.status, t)}</p>
              </div>
              {outcome === 'stale' ? <span className="text-sm font-medium text-amber-700">{t('maintenance.outcome.stale')}</span> : null}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">{t('maintenance.diff.source')}</p>
                <pre aria-label={t('maintenance.diff.source')} className="max-h-56 overflow-auto border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--foreground)] whitespace-pre-wrap">{draft.diff.before}</pre>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">{t('maintenance.diff.candidate')}</p>
                <pre aria-label={t('maintenance.diff.candidate')} className="max-h-56 overflow-auto border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--foreground)] whitespace-pre-wrap">{draft.diff.after}</pre>
              </div>
            </div>

            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium text-[var(--foreground)]">{t('maintenance.impact')}</p>
                <ul className="mt-1 space-y-1 text-[var(--muted-foreground)]">
                  {draft.impact.length ? draft.impact.map((reference) => <li key={`${reference.kind}:${reference.id}@${reference.version}`}>{reference.id}@{reference.version}</li>) : <li>{t('maintenance.none')}</li>}
                </ul>
              </div>
              <div>
                <p className="font-medium text-[var(--foreground)]">{t('maintenance.evidence')}</p>
                <ul className="mt-1 space-y-1 text-[var(--muted-foreground)]">
                  {draft.evidence.map((citation) => (
                    <li className="flex flex-wrap items-center gap-2" key={`${citation.runId}:${citation.artifactId}`}>
                      <span>{citation.artifactId}</span>
                      <button
                        className="border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={!onOpenEvidence || isPending}
                        onClick={() => {
                          if (onOpenEvidence) {
                            void runDraftAction(draft.id, () => onOpenEvidence({ draftId: draft.id, citation }));
                          }
                        }}
                        type="button"
                      >
                        {t('maintenance.evidence.open', { artifact: citation.artifactId })}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 border-t border-[var(--border)] pt-4 text-sm">
              <p className="font-medium text-[var(--foreground)]">{t('maintenance.audit')}</p>
              <ol className="mt-1 space-y-1 text-[var(--muted-foreground)]">
                {draft.audit.map((entry, index) => (
                  <li key={`${entry.at}:${entry.action}:${index}`}>
                    <span className="font-medium text-[var(--foreground)]">{maintenanceAuditActionLabel(entry.action, t)}</span>{' '}
                    <time dateTime={entry.at}>{entry.at}</time>
                    {entry.action === 'rejected' ? <p>{entry.rationale}</p> : null}
                  </li>
                ))}
              </ol>
            </div>

            {errors[draft.id] ? <p className="mt-4 text-sm font-medium text-red-700" role="alert">{t('maintenance.error.action')}</p> : null}

            <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input
                  aria-label={confirmationLabel}
                  checked={confirmed[draft.id] ?? false}
                  disabled={!canAccept}
                  onChange={(event) => setConfirmed((current) => ({ ...current, [draft.id]: event.target.checked }))}
                  type="checkbox"
                />
                {confirmationLabel}
              </label>
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm text-[var(--foreground)]">
                <span>{t('maintenance.reject.rationale')}</span>
                <textarea
                  aria-label={t('maintenance.reject.rationale')}
                  className="min-h-16 border border-[var(--border)] bg-[var(--background)] p-2 text-sm text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canReject}
                  onChange={(event) => setRejectionRationales((current) => ({ ...current, [draft.id]: event.target.value }))}
                  value={rationale}
                />
              </label>
              <button
                className="border border-[var(--foreground)] px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!canAccept || !confirmed[draft.id]}
                onClick={() => {
                  if (onAccept) {
                    void runDraftAction(draft.id, async () => {
                      const result = await onAccept({ draftId: draft.id, expectedRevision: draft.projectRevision });
                      setOutcomes((current) => ({ ...current, [draft.id]: result.status }));
                    });
                  }
                }}
                type="button"
              >
                {t('maintenance.approve')}
              </button>
              <button
                className="border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!canReject || !rationale.trim()}
                onClick={() => {
                  if (onReject) {
                    void runDraftAction(draft.id, async () => {
                      const result = await onReject({ draftId: draft.id, rationale: rationale.trim() });
                      setOutcomes((current) => ({ ...current, [draft.id]: result.status }));
                    });
                  }
                }}
                type="button"
              >
                {t('maintenance.reject')}
              </button>
            </div>
          </article>
        );
      }) : <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">{t('maintenance.empty')}</p>}
    </section>
  );
}

function maintenanceStatusLabel(status: MaintenanceDraft['status'], t: ReturnType<typeof useI18n>['t']): string {
  switch (status) {
    case 'draft': return t('maintenance.status.draft');
    case 'accepted': return t('maintenance.status.accepted');
    case 'rejected': return t('maintenance.status.rejected');
    case 'stale': return t('maintenance.status.stale');
  }
}

function maintenanceAuditActionLabel(action: MaintenanceDraft['audit'][number]['action'], t: ReturnType<typeof useI18n>['t']): string {
  switch (action) {
    case 'created': return t('maintenance.audit.created');
    case 'accepted': return t('maintenance.audit.accepted');
    case 'rejected': return t('maintenance.audit.rejected');
    case 'stale': return t('maintenance.audit.stale');
  }
}
