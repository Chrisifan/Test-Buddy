import { useMemo, useState } from 'react';
import type {
  GeneratedTestPath,
  PrdAnalysisFallbackReason,
  PrdCoverageTarget,
  PrdCoverageTriageDecisionStatus,
  PrdCoverageTriageStatus,
  PrdDocumentKind,
  ProjectDraft,
} from '../../../shared/studio.js';
import {
  getPrdCoverageTriageKey,
  getPrdCoverageTriageStatus,
  isRecordingLinkedToGeneratedPath,
  isTestCaseLinkedToGeneratedPath,
} from '../../../shared/studio.js';

import { FileText, Filter, Plus, Sparkles, Table2, Undo2, Upload, Video } from 'lucide-react';

import { EvidenceCard, MetricTile, OperationalEmptyState, PageHeader, ProjectRequiredState, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { extractPdfText } from '@/lib/pdfText';
import { useI18n } from '../../i18n/index.js';

type MatrixFilter = 'all' | 'caseMissing' | 'recordingMissing' | 'uncovered';
type TriageFilter = 'all' | PrdCoverageTriageStatus;
type TriageRequest = {
  documentId: string;
  pathId: string;
  target: PrdCoverageTarget;
  status: PrdCoverageTriageDecisionStatus;
  note: string;
};

export const DocumentAnalysisPage = ({
  project,
  selectedDocumentId,
  onSelectDocument,
  onCreateDocument,
  onUpdateDocument,
  onCreateCaseFromPath,
  onCreateRecordingFromPath,
  onCreateAllCasesFromDocument,
  onCreateAllCasesFromMatrix,
  onCreateAllRecordingsFromMatrix,
  onAnalyzeDocument,
  onUpdateCoverageTriage = () => undefined,
  semanticAnalyzingDocumentId,
  semanticAnalysisError,
  onOpenProjects,
}: {
  project?: ProjectDraft;
  selectedDocumentId: string;
  onSelectDocument: (documentId: string) => void;
  onCreateDocument: (payload: {
    name: string;
    kind: PrdDocumentKind;
    size: number;
    sourceText: string;
  }) => void;
  onUpdateDocument: (documentId: string, sourceText: string) => void;
  onCreateCaseFromPath: (documentId: string, pathId: string) => void;
  onCreateRecordingFromPath: (documentId: string, pathId: string) => void;
  onCreateAllCasesFromDocument: (documentId: string) => void;
  onCreateAllCasesFromMatrix: () => void;
  onCreateAllRecordingsFromMatrix: () => void;
  onAnalyzeDocument: (documentId: string) => void;
  onUpdateCoverageTriage?: (
    documentId: string,
    pathId: string,
    target: PrdCoverageTarget,
    status: PrdCoverageTriageDecisionStatus | undefined,
    note: string,
  ) => void;
  semanticAnalyzingDocumentId: string | null;
  semanticAnalysisError: string | null;
  onOpenProjects?: () => void;
}) => {
  const { t } = useI18n();
  const [isCoverageMatrixOpen, setIsCoverageMatrixOpen] = useState(false);
  const [matrixFilter, setMatrixFilter] = useState<MatrixFilter>('all');
  const [triageFilter, setTriageFilter] = useState<TriageFilter>('all');
  const [triageRequest, setTriageRequest] = useState<TriageRequest | null>(null);
  const documents = project?.documents ?? [];
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];
  const generatedCount = useMemo(
    () => documents.reduce((total, document) => total + document.generatedPaths.length, 0),
    [documents],
  );
  const selectedPathCoverage = useMemo(() => {
    const cases = project?.testCases ?? [];
    const recordings = project?.recordings ?? [];
    return new Map(
      (selectedDocument?.generatedPaths ?? []).map((path) => [
        path.id,
        {
          caseCreated: cases.some((testCase) => isTestCaseLinkedToGeneratedPath(testCase, selectedDocument!.id, path)),
          recordingCreated: recordings.some((recording) => isRecordingLinkedToGeneratedPath(recording, selectedDocument!.id, path)),
        },
      ]),
    );
  }, [project?.recordings, project?.testCases, selectedDocument]);
  const selectedCoveredCount = Array.from(selectedPathCoverage.values()).filter((coverage) => coverage.caseCreated).length;
  const selectedRecordingCount = Array.from(selectedPathCoverage.values()).filter((coverage) => coverage.recordingCreated).length;
  const coverageMatrix = useMemo(() => {
    const cases = project?.testCases ?? [];
    const recordings = project?.recordings ?? [];
    const decisions = new Map(
      (project?.prdCoverageTriage ?? []).map((decision) => [
        getPrdCoverageTriageKey(decision.documentId, decision.pathId, decision.target),
        decision,
      ]),
    );
    return documents.flatMap((document) =>
      document.generatedPaths.map((path) => {
        const caseCreated = cases.some((testCase) => isTestCaseLinkedToGeneratedPath(testCase, document.id, path));
        const recordingCreated = recordings.some((recording) => isRecordingLinkedToGeneratedPath(recording, document.id, path));
        return {
          document,
          path,
          caseCreated,
          recordingCreated,
          caseTriage: getPrdCoverageTriageStatus(
            caseCreated,
            decisions.get(getPrdCoverageTriageKey(document.id, path.id, 'case')),
          ),
          recordingTriage: getPrdCoverageTriageStatus(
            recordingCreated,
            decisions.get(getPrdCoverageTriageKey(document.id, path.id, 'recording')),
          ),
          caseDecision: decisions.get(getPrdCoverageTriageKey(document.id, path.id, 'case')),
          recordingDecision: decisions.get(getPrdCoverageTriageKey(document.id, path.id, 'recording')),
        };
      }),
    );
  }, [documents, project?.prdCoverageTriage, project?.recordings, project?.testCases]);
  const coveredMatrixCount = coverageMatrix.filter((row) => row.caseCreated).length;
  const uncoveredMatrixCaseCount = coverageMatrix.length - coveredMatrixCount;
  const uncoveredMatrixRecordingCount = coverageMatrix.filter((row) => !row.recordingCreated).length;
  const filteredCoverageMatrix = useMemo(
    () =>
      coverageMatrix.filter((row) => {
        const coverageMatches = matrixFilter === 'caseMissing'
          ? !row.caseCreated
          : matrixFilter === 'recordingMissing'
            ? !row.recordingCreated
            : matrixFilter === 'uncovered'
              ? !row.caseCreated && !row.recordingCreated
              : true;
        const triageMatches = triageFilter === 'all'
          || row.caseTriage === triageFilter
          || row.recordingTriage === triageFilter;
        return coverageMatches && triageMatches;
      }),
    [coverageMatrix, matrixFilter, triageFilter],
  );

  const openTriageRequest = (
    row: (typeof coverageMatrix)[number],
    target: PrdCoverageTarget,
    status: PrdCoverageTriageDecisionStatus,
  ) => {
    const decision = target === 'case' ? row.caseDecision : row.recordingDecision;
    setTriageRequest({
      documentId: row.document.id,
      pathId: row.path.id,
      target,
      status,
      note: decision?.note ?? '',
    });
  };
  const selectedFallbackReason = selectedDocument?.analysisMetadata?.fallbackReason;
  const selectedFallbackMessage = selectedFallbackReason
    ? analysisFallbackMessage(selectedFallbackReason, t)
    : null;
  const isSemanticAnalyzing = semanticAnalyzingDocumentId === selectedDocument?.id;

  const handleFileChange = async (file?: File) => {
    if (!file) {
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase();
    const kind: PrdDocumentKind =
      extension === 'pdf' ? 'pdf' : extension === 'md' || extension === 'markdown' ? 'markdown' : 'text';
    let sourceText = '';

    if (kind === 'pdf') {
      const extracted = await extractPdfText(file);
      sourceText = extracted.length >= 20
        ? extracted
        : t('documents.intake.pdfNoText');
    } else {
      sourceText = await file.text();
    }

    onCreateDocument({
      name: file.name,
      kind,
      size: file.size,
      sourceText,
    });
  };
  const documentUploadAction = (
    <label className="document-upload-action">
      <Upload className="h-3.5 w-3.5" />
      {t('documents.upload.eyebrow')}
      <input
        accept=".txt,.md,.markdown,.pdf"
        className="sr-only"
        onChange={(event) => void handleFileChange(event.target.files?.[0])}
        type="file"
      />
    </label>
  );

  if (!project) {
    return (
      <PageShell>
        <PageHeader title={t('documents.header.title')} />
        <PageBody className="flex min-h-0">
          <ProjectRequiredState
            actionLabel={t('app.nav.projects')}
            description={t('project.select.description')}
            onOpenProjects={onOpenProjects}
            title={t('project.select.title')}
          />
        </PageBody>
      </PageShell>
    );
  }

  return (
    <PageShell className="figma-document-page">
      <PageHeader
        action={
          <>
            {documents.length ? documentUploadAction : null}
            <Button onClick={() => setIsCoverageMatrixOpen(true)} size="sm" type="button" variant="outline">
              <Table2 className="h-3.5 w-3.5" />
              {t('documents.action.coverageMatrix')}
            </Button>
          </>
        }
        meta={[
          t('documents.meta.documents', { count: documents.length }),
          t('documents.meta.paths', { count: generatedCount }),
        ].map((item) => (
          <Badge className="page-header-meta" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('documents.header.title')}
      />

      <PageBody className="figma-document-body">
      <section className="document-studio" aria-label={t('documents.aria.workbench')}>
        {!documents.length ? (
          <OperationalEmptyState
            description={t('documents.empty.description')}
            primaryAction={documentUploadAction}
            title={t('documents.empty.title')}
          />
        ) : (
          <>
        <aside className="document-asset-area" aria-label={t('documents.header.title')}>
          <header className="document-library-header">
            <span>{t('documents.library.recent')}</span>
          </header>

          <div className="document-asset-grid">
            {documents.map((document) => (
              <button
                className={`document-asset-card ${selectedDocument?.id === document.id ? 'is-active' : ''}`}
                key={document.id}
                onClick={() => onSelectDocument(document.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="document-asset-icon"><FileText className="h-5 w-5" /></div>
                  <Badge className="rounded-[4px]" variant="outline">
                    {document.generatedPaths.length ? t('documents.status.analyzed') : document.kind}
                  </Badge>
                </div>
                <h3>{document.name}</h3>
                <p>{document.summary || t('documents.card.waiting')}</p>
                <footer>
                  <span>{t('documents.card.chars', { count: document.size })}</span>
                  <span>{t('documents.card.paths', { count: document.generatedPaths.length })}</span>
                </footer>
              </button>
            ))}
          </div>
        </aside>

        <section className={`document-side-panel ${selectedDocument ? '' : 'is-empty'}`}>
          {selectedDocument ? (
            <header className="document-workspace-header">
              <div className="min-w-0">
                <h2>{selectedDocument.name}</h2>
                <p>{`${selectedDocument.kind.toUpperCase()} · ${t('documents.card.chars', { count: selectedDocument.size })}`}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Badge variant="outline">
                  {selectedDocument.analysisMetadata?.source === 'model'
                    ? t('documents.analysis.model')
                    : t('documents.analysis.rule')}
                </Badge>
                <Button
                  disabled={isSemanticAnalyzing}
                  onClick={() => onAnalyzeDocument(selectedDocument.id)}
                  size="sm"
                  type="button"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isSemanticAnalyzing
                    ? t('documents.analysis.analyzing')
                    : t('documents.analysis.reanalyze')}
                </Button>
              </div>
            </header>
          ) : null}

          {selectedDocument && (semanticAnalysisError || selectedFallbackMessage) ? (
            <p
              aria-live="polite"
              className="text-xs leading-5 text-muted-foreground"
              role={semanticAnalysisError ? 'alert' : undefined}
            >
              {semanticAnalysisError ?? selectedFallbackMessage}
            </p>
          ) : null}

          {selectedDocument ? (
            <Surface className="document-source-pane" variant="plain">
              <header className="document-pane-header">
                <span>{t('documents.selected.eyebrow')}</span>
                <span>{t('documents.metric.coverageAreas')} {selectedDocument.coverageAreas.length}</span>
              </header>
              <Textarea
                aria-label={`${selectedDocument.name} source`}
                className="document-source-editor"
                disabled={isSemanticAnalyzing}
                onChange={(event) => onUpdateDocument(selectedDocument.id, event.target.value)}
                value={selectedDocument.sourceText}
              />
            </Surface>
          ) : null}

          {selectedDocument ? (
            <aside className="document-path-pane" aria-label={t('documents.selected.pathCount', { count: selectedDocument.generatedPaths.length })}>
              <header className="document-pane-header">
                <span>{t('documents.selected.pathCount', { count: selectedDocument.generatedPaths.length })}</span>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Badge variant="outline">{selectedCoveredCount} {t('documents.metric.written')}</Badge>
                  <Badge variant="outline">{selectedRecordingCount} {t('documents.metric.recordings')}</Badge>
                </div>
              </header>
              <div className="grid gap-3 md:grid-cols-3">
                <MetricTile label={t('documents.metric.coverageAreas')} value={`${selectedDocument.coverageAreas.length}`} />
                <MetricTile label={t('documents.metric.paths')} value={`${selectedDocument.generatedPaths.length}`} tone="primary" />
                <MetricTile label={t('documents.metric.written')} value={`${selectedCoveredCount}`} />
              </div>
              <div className="grid gap-2">
                {selectedDocument.generatedPaths.map((path) => (
                  <GeneratedPathCard
                    covered={selectedPathCoverage.get(path.id)?.caseCreated ?? false}
                    key={path.id}
                    onCreateCase={() => onCreateCaseFromPath(selectedDocument.id, path.id)}
                    onCreateRecording={() => onCreateRecordingFromPath(selectedDocument.id, path.id)}
                    path={path}
                    recordingCreated={selectedPathCoverage.get(path.id)?.recordingCreated ?? false}
                  />
                ))}
                {!selectedDocument.generatedPaths.length ? (
                  <EvidenceCard title={t('documents.path.emptyTitle')} description={t('documents.path.emptyDescription')} />
                ) : null}
              </div>
              <Button
                disabled={!selectedDocument.generatedPaths.some((path) => !selectedPathCoverage.get(path.id)?.caseCreated)}
                onClick={() => onCreateAllCasesFromDocument(selectedDocument.id)}
                type="button"
                variant="outline"
              >
                {t('documents.path.writeAll')}
              </Button>
            </aside>
          ) : null}
        </section>
          </>
        )}
      </section>
      </PageBody>
      <Dialog onOpenChange={setIsCoverageMatrixOpen} open={isCoverageMatrixOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[min(680px,calc(100vh-32px))] w-[min(920px,calc(100vw-32px))] gap-0 overflow-hidden p-0 sm:max-w-[920px]"
          showCloseButton
        >
          <DialogHeader className="flex h-[52px] shrink-0 flex-row items-center justify-between border-b border-border px-4 py-0 pr-14 text-left">
            <DialogTitle className="text-base font-semibold">{t('documents.matrix.title')}</DialogTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{t('documents.matrix.paths', { count: coverageMatrix.length })}</Badge>
              <Badge variant="outline">{t('documents.matrix.covered', { count: coveredMatrixCount })}</Badge>
              <Button
                disabled={!uncoveredMatrixCaseCount}
                onClick={onCreateAllCasesFromMatrix}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('documents.matrix.writeAllCases', { count: uncoveredMatrixCaseCount })}
              </Button>
              <Button
                disabled={!uncoveredMatrixRecordingCount}
                onClick={onCreateAllRecordingsFromMatrix}
                size="sm"
                type="button"
                variant="outline"
              >
                <Video className="h-3.5 w-3.5" />
                {t('documents.matrix.createAllRecordings', { count: uncoveredMatrixRecordingCount })}
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 overflow-auto p-4">
            {coverageMatrix.length ? (
              <>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Select onValueChange={(value) => setMatrixFilter(value as MatrixFilter)} value={matrixFilter}>
                      <SelectTrigger aria-label={t('documents.matrix.filterLabel')} className="h-8 w-40 text-xs">
                        <Filter className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('documents.matrix.filter.all')}</SelectItem>
                        <SelectItem value="caseMissing">{t('documents.matrix.filter.caseMissing')}</SelectItem>
                        <SelectItem value="recordingMissing">{t('documents.matrix.filter.recordingMissing')}</SelectItem>
                        <SelectItem value="uncovered">{t('documents.matrix.filter.uncovered')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select onValueChange={(value) => setTriageFilter(value as TriageFilter)} value={triageFilter}>
                      <SelectTrigger aria-label={t('documents.triage.filterLabel')} className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('documents.triage.filter.all')}</SelectItem>
                        <SelectItem value="pending">{t('documents.triage.status.pending')}</SelectItem>
                        <SelectItem value="deferred">{t('documents.triage.status.deferred')}</SelectItem>
                        <SelectItem value="ignored">{t('documents.triage.status.ignored')}</SelectItem>
                        <SelectItem value="resolved">{t('documents.triage.status.resolved')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Badge variant="outline">{t('documents.matrix.visible', { count: filteredCoverageMatrix.length })}</Badge>
                </div>
                {filteredCoverageMatrix.length ? (
                  <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 font-medium">{t('documents.matrix.document')}</th>
                        <th className="px-2 py-2 font-medium">{t('documents.matrix.path')}</th>
                        <th className="px-2 py-2 font-medium">{t('documents.matrix.case')}</th>
                        <th className="px-2 py-2 font-medium">{t('documents.matrix.recording')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCoverageMatrix.map((row) => (
                        <tr className="border-b border-border/70 last:border-b-0" key={`${row.document.id}-${row.path.id}`}>
                          <td className="max-w-44 truncate px-2 py-2.5 font-medium text-foreground" title={row.document.name}>
                            {row.document.name}
                          </td>
                          <td className="max-w-[360px] px-2 py-2.5">
                            <p className="truncate font-medium text-foreground" title={row.path.title}>{row.path.title}</p>
                            {row.path.sourceExcerpt ? (
                              <p className="mt-1 line-clamp-1 text-muted-foreground" title={row.path.sourceExcerpt}>{row.path.sourceExcerpt}</p>
                            ) : null}
                          </td>
                          <td className="px-2 py-2.5">
                            <TriageCell
                              covered={row.caseCreated}
                              onCreate={() => onCreateCaseFromPath(row.document.id, row.path.id)}
                              onDefer={() => openTriageRequest(row, 'case', 'deferred')}
                              onIgnore={() => openTriageRequest(row, 'case', 'ignored')}
                              onRestore={() => onUpdateCoverageTriage(row.document.id, row.path.id, 'case', undefined, '')}
                              note={row.caseDecision?.note}
                              status={row.caseTriage}
                              target="case"
                            />
                          </td>
                          <td className="px-2 py-2.5">
                            <TriageCell
                              covered={row.recordingCreated}
                              onCreate={() => onCreateRecordingFromPath(row.document.id, row.path.id)}
                              onDefer={() => openTriageRequest(row, 'recording', 'deferred')}
                              onIgnore={() => openTriageRequest(row, 'recording', 'ignored')}
                              onRestore={() => onUpdateCoverageTriage(row.document.id, row.path.id, 'recording', undefined, '')}
                              note={row.recordingDecision?.note}
                              status={row.recordingTriage}
                              target="recording"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EvidenceCard title={t('documents.matrix.emptyFilteredTitle')} description={t('documents.matrix.emptyFilteredDescription')} />
                )}
              </>
            ) : (
              <EvidenceCard title={t('documents.matrix.emptyTitle')} description={t('documents.matrix.emptyDescription')} />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open) setTriageRequest(null);
        }}
        open={Boolean(triageRequest)}
      >
        <DialogContent className="w-[min(440px,calc(100vw-32px))] p-5 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {triageRequest?.status === 'deferred'
                ? t('documents.triage.deferTitle')
                : t('documents.triage.ignoreTitle')}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label={t('documents.triage.noteLabel')}
            autoFocus
            onChange={(event) => setTriageRequest((current) => current ? { ...current, note: event.target.value } : current)}
            placeholder={t('documents.triage.notePlaceholder')}
            value={triageRequest?.note ?? ''}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTriageRequest(null)} type="button" variant="outline">
              {t('common.close')}
            </Button>
            <Button
              disabled={!triageRequest?.note.trim()}
              onClick={() => {
                if (!triageRequest) return;
                onUpdateCoverageTriage(
                  triageRequest.documentId,
                  triageRequest.pathId,
                  triageRequest.target,
                  triageRequest.status,
                  triageRequest.note,
                );
                setTriageRequest(null);
              }}
              type="button"
            >
              {t('documents.triage.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

const analysisFallbackMessage = (
  reason: PrdAnalysisFallbackReason,
  t: ReturnType<typeof useI18n>['t'],
): string => {
  if (reason === 'modelDisabled') {
    return t('documents.analysis.fallback.disabled');
  }
  if (reason === 'modelNotConfigured') {
    return t('documents.analysis.fallback.notConfigured');
  }
  if (reason === 'noRulePaths') {
    return t('documents.analysis.fallback.noRulePaths');
  }
  if (reason === 'requestFailed') {
    return t('documents.analysis.fallback.requestFailed');
  }
  if (reason === 'invalidResponse') {
    return t('documents.analysis.fallback.invalidResponse');
  }
  return t('documents.analysis.fallback.desktopUnavailable');
};

const GeneratedPathCard = ({
  path,
  covered,
  recordingCreated,
  onCreateCase,
  onCreateRecording,
}: {
  path: GeneratedTestPath;
  covered: boolean;
  recordingCreated: boolean;
  onCreateCase: () => void;
  onCreateRecording: () => void;
}) => {
  const { t } = useI18n();

  return (
    <article className="document-path-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-[4px]" variant="outline">
              {path.priority}
            </Badge>
            <Badge className="rounded-[4px]" variant="outline">
              {path.groupName}
            </Badge>
          </div>
          <h3 className="mt-3 text-base font-semibold tracking-[-0.03em]">{path.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{path.rationale}</p>
          {path.sourceExcerpt ? (
            <p className="document-path-source">
              <span>{t('documents.path.sourceExcerpt')}</span>
              {path.sourceExcerpt}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {covered ? (
            <Badge className="rounded-[4px]" variant="outline">
              {t('documents.path.covered')}
            </Badge>
          ) : (
            <Button onClick={onCreateCase} type="button" variant="outline">
              <Plus className="h-4 w-4" />
              {t('documents.path.createCase')}
            </Button>
          )}
          {recordingCreated ? (
            <Badge className="rounded-[4px]" variant="outline">
              {t('documents.path.recordingCreated')}
            </Badge>
          ) : (
            <Button onClick={onCreateRecording} type="button" variant="outline">
              <Plus className="h-4 w-4" />
              {t('documents.path.createRecording')}
            </Button>
          )}
        </div>
      </div>
      <div className="document-path-steps">
        {path.steps.map((step, index) => (
          <div className="rounded-[4px] bg-background/45 px-3 py-2" key={`${step.id}-${index}`}>
            <p className="text-xs font-medium text-foreground">{step.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>
    </article>
  );
};

const TriageCell = ({
  covered,
  note,
  onCreate,
  onDefer,
  onIgnore,
  onRestore,
  status,
  target,
}: {
  covered: boolean;
  note?: string;
  onCreate: () => void;
  onDefer: () => void;
  onIgnore: () => void;
  onRestore: () => void;
  status: PrdCoverageTriageStatus;
  target: PrdCoverageTarget;
}) => {
  const { t } = useI18n();
  const createLabel = target === 'case' ? t('documents.path.createCase') : t('documents.path.createRecording');

  return (
    <div className="flex min-w-[180px] flex-wrap items-center gap-1.5">
      <Badge title={note} variant="outline">{t(`documents.triage.status.${status}`)}</Badge>
      {!covered ? (
        <>
          <Button onClick={onCreate} size="sm" type="button" variant="outline">
            <Plus className="h-3.5 w-3.5" />
            {createLabel}
          </Button>
          <Button onClick={onDefer} size="sm" type="button" variant="ghost">
            {t('documents.triage.defer')}
          </Button>
          <Button onClick={onIgnore} size="sm" type="button" variant="ghost">
            {t('documents.triage.ignore')}
          </Button>
          {status === 'deferred' || status === 'ignored' ? (
            <button
              aria-label={t('documents.triage.restore')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onRestore}
              title={t('documents.triage.restore')}
              type="button"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
