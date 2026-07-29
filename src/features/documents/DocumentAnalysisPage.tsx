import { useMemo, useState } from 'react';
import type {
  GeneratedTestPath,
  PrdDocumentKind,
  ProjectDraft,
} from '../../../shared/studio.js';

import { FileText, Plus, Sparkles, Upload } from 'lucide-react';

import { ActionListItem, EvidenceCard, MetricTile, PageHeader, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { extractPdfText } from '@/lib/pdfText';
import { useI18n } from '../../i18n/index.js';

export function DocumentAnalysisPage({
  project,
  selectedDocumentId,
  onSelectDocument,
  onCreateDocument,
  onUpdateDocument,
  onCreateCaseFromPath,
  onCreateRecordingFromPath,
  onCreateAllCasesFromDocument,
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
}) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState(() => t('documents.intake.defaultName'));
  const [draftText, setDraftText] = useState(() => t('documents.intake.samplePrd'));
  const [intakeMessage, setIntakeMessage] = useState(() => t('documents.intake.supportedFiles'));
  const documents = project?.documents ?? [];
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];
  const generatedCount = useMemo(
    () => documents.reduce((total, document) => total + document.generatedPaths.length, 0),
    [documents],
  );
  const coveredPathTitles = useMemo(
    () => new Set((project?.testCases ?? []).filter((testCase) => testCase.source === 'prd').map((testCase) => testCase.name)),
    [project?.testCases],
  );
  const recordingPathTitles = useMemo(
    () =>
      new Set(
        (project?.recordings ?? [])
          .filter((recording) => recording.tags.includes('PRD'))
          .map((recording) => recording.name.replace(/ 回放草稿$/, '')),
      ),
    [project?.recordings],
  );
  const selectedCoveredCount =
    selectedDocument?.generatedPaths.filter((path) => coveredPathTitles.has(path.title)).length ?? 0;

  async function handleFileChange(file?: File) {
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
      setIntakeMessage(
        extracted.length >= 20
          ? t('documents.intake.pdfSuccess', { name: file.name, count: extracted.length })
          : t('documents.intake.pdfComplex', { name: file.name }),
      );
    } else {
      sourceText = await file.text();
      setIntakeMessage(t('documents.intake.readSuccess', { name: file.name, count: sourceText.length }));
    }

    setDraftName(file.name);
    setDraftText(sourceText);

    onCreateDocument({
      name: file.name,
      kind,
      size: file.size,
      sourceText,
    });
  }

  return (
    <PageShell>
      <PageHeader
        meta={[
          t('documents.meta.documents', { count: documents.length }),
          t('documents.meta.paths', { count: generatedCount }),
          t('documents.meta.coverage', { count: selectedCoveredCount }),
        ].map((item) => (
          <Badge className="rounded-[4px] px-3 py-1.5" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('documents.header.title')}
      />

      <PageBody>
      <section className="document-studio" aria-label={t('documents.aria.workbench')}>
        <div className="document-asset-area">
          <Surface className="document-summary-strip" variant="subtle">
            <div className="document-summary-metrics">
              <span><span>{t('documents.stats.total')}</span> <b>{documents.length}</b></span>
              <span><span>{t('documents.stats.analyzed')}</span> <b className="text-emerald-600">{documents.filter((document) => document.generatedPaths.length).length}</b></span>
              <span><span>{t('documents.stats.paths')}</span> <b className="text-primary">{generatedCount}</b></span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" type="button" variant="outline">{t('documents.action.filter')}</Button>
              <Button size="sm" type="button" variant="outline">{t('documents.action.latest')}</Button>
            </div>
          </Surface>

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
            {!documents.length ? <EvidenceCard title={t('documents.empty.title')} description={t('documents.empty.description')} /> : null}
          </div>
        </div>

        <aside className="document-side-panel">
          <Surface className="document-intake" variant="plain">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p>{t('documents.upload.eyebrow')}</p>
                <h2>{t('documents.upload.title')}</h2>
                <span>{intakeMessage}</span>
              </div>
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <Input aria-label={t('documents.upload.name')} onChange={(event) => setDraftName(event.target.value)} value={draftName} />
            <Textarea className="min-h-[160px] leading-7" onChange={(event) => setDraftText(event.target.value)} value={draftText} />
            <div className="flex flex-wrap justify-between gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[4px] tech-subtle px-4 text-sm transition hover:bg-accent">
                <Upload className="h-4 w-4" />
                {t('documents.upload.file')}
                <input accept=".txt,.md,.markdown,.pdf" className="sr-only" onChange={(event) => void handleFileChange(event.target.files?.[0])} type="file" />
              </label>
              <Button
                onClick={() => {
                  setIntakeMessage(t('documents.intake.analyzed', { name: draftName, count: draftText.length }));
                  onCreateDocument({
                    name: draftName,
                    kind: draftName.toLowerCase().endsWith('.md') ? 'markdown' : 'text',
                    size: draftText.length,
                    sourceText: draftText,
                  });
                }}
                type="button"
              >
                <Sparkles className="h-4 w-4" />
                {t('documents.upload.analyze')}
              </Button>
            </div>
          </Surface>

          {selectedDocument ? (
            <Surface className="document-inspector" variant="plain">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">{t('documents.selected.eyebrow')}</p>
                  <h2 className="mt-2 truncate text-xl font-semibold tracking-[-0.03em]">{selectedDocument.name}</h2>
                </div>
                <Badge variant="outline">{t('documents.selected.pathCount', { count: selectedDocument.generatedPaths.length })}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <MetricTile label={t('documents.metric.coverageAreas')} value={`${selectedDocument.coverageAreas.length}`} />
                <MetricTile label={t('documents.metric.paths')} value={`${selectedDocument.generatedPaths.length}`} tone="primary" />
                <MetricTile label={t('documents.metric.written')} value={`${selectedCoveredCount}`} />
              </div>
              <div className="grid gap-2">
                {selectedDocument.generatedPaths.map((path) => (
                  <GeneratedPathCard
                    covered={coveredPathTitles.has(path.title)}
                    key={path.id}
                    onCreateCase={() => onCreateCaseFromPath(selectedDocument.id, path.id)}
                    onCreateRecording={() => onCreateRecordingFromPath(selectedDocument.id, path.id)}
                    path={path}
                    recordingCreated={recordingPathTitles.has(path.title)}
                  />
                ))}
                {!selectedDocument.generatedPaths.length ? (
                  <EvidenceCard title={t('documents.path.emptyTitle')} description={t('documents.path.emptyDescription')} />
                ) : null}
              </div>
              <Button
                disabled={!selectedDocument.generatedPaths.some((path) => !coveredPathTitles.has(path.title))}
                onClick={() => onCreateAllCasesFromDocument(selectedDocument.id)}
                type="button"
                variant="outline"
              >
                {t('documents.path.writeAll')}
              </Button>
            </Surface>
          ) : null}
        </aside>
      </section>
      </PageBody>
    </PageShell>
  );
}

function GeneratedPathCard({
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
}) {
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
}
