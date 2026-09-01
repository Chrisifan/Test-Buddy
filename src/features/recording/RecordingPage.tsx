import type {
  BrowserSessionState,
  ProjectDraft,
  ProjectEnvironment,
  RecordingAsset,
  RecordingStepDraft,
  VisualDiffMask,
} from '../../../shared/studio.js';

import { CircleDashed, Film, Import, Play, Plus, Radar, Sparkles, Trash2 } from 'lucide-react';

import { EvidenceCard, MetricTile, PageHeader, ProjectRequiredState, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { StatusPill } from '../../components/StatusPill.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '../../i18n/index.js';

const stepKinds: RecordingStepDraft['kind'][] = [
  'navigate',
  'click',
  'input',
  'wait',
  'assert',
  'snapshot',
];

function getStepKindLabel(kind: RecordingStepDraft['kind'], t: (key: string) => string): string {
  switch (kind) {
    case 'navigate':
      return t('recording.step.navigate');
    case 'click':
      return t('recording.step.click');
    case 'input':
      return t('recording.step.input');
    case 'wait':
      return t('recording.step.wait');
    case 'assert':
      return t('recording.step.assert');
    case 'snapshot':
      return t('recording.step.snapshot');
    default:
      return kind;
  }
}

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeVisualDiffMask(mask: VisualDiffMask): VisualDiffMask {
  const x = Math.min(100, Math.max(0, mask.x));
  const y = Math.min(100, Math.max(0, mask.y));
  return {
    ...mask,
    x,
    y,
    width: Math.min(100 - x, Math.max(0, mask.width)),
    height: Math.min(100 - y, Math.max(0, mask.height)),
  };
}

export function RecordingPage({
  project,
  environment,
  recording,
  browserSession,
  browserSessionMessage,
  isReplaying,
  onSelectRecording,
  onCreateRecording,
  onStartRecording,
  onImportPlayback,
  onRunRecording,
  onUpdateRecording,
  onAppendStep,
  onCreateTestCaseFromRecording,
  onDeleteRecording,
  onCaptureSnapshot,
  onOpenProjects,
}: {
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  recording?: RecordingAsset;
  browserSession: BrowserSessionState;
  browserSessionMessage: string;
  isReplaying: boolean;
  onSelectRecording: (recordingId: string) => void;
  onCreateRecording: () => void;
  onStartRecording: () => void;
  onImportPlayback: () => void;
  onRunRecording: () => void;
  onUpdateRecording: (updater: (recording: RecordingAsset) => RecordingAsset) => void;
  onAppendStep: (kind?: RecordingStepDraft['kind']) => void;
  onCreateTestCaseFromRecording: (recordingId: string) => void;
  onDeleteRecording: (recordingId: string) => void;
  onCaptureSnapshot: () => void;
  onOpenProjects?: () => void;
}) {
  const { locale, t } = useI18n();

  if (!project) {
    return (
      <PageShell>
        <PageHeader
          title={t('app.nav.recording')}
        />
        <PageBody className="flex min-h-0">
          <ProjectRequiredState
            actionLabel={t('app.nav.projects')}
            description={t('recording.empty.noProjectDescription')}
            onOpenProjects={onOpenProjects}
            title={t('recording.empty.noProject')}
          />
        </PageBody>
      </PageShell>
    );
  }

  const groupsById = new Map(project.groups.map((group) => [group.id, group]));
  const environmentsById = new Map(project.environments.map((item) => [item.id, item]));
  const sessionTone = browserSession.status === 'error' ? 'failed' : browserSession.status === 'ready' ? 'passed' : 'neutral';

  return (
    <PageShell className="figma-recording-page">
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-[4px]" onClick={onStartRecording} type="button">
              <Radar className="h-4 w-4" />
              {t('recording.action.start')}
            </Button>
            <Button
              className="rounded-[4px]"
              disabled={!recording?.steps.length || isReplaying}
              onClick={onRunRecording}
              type="button"
              variant="outline"
            >
              <Play className="h-4 w-4" />
              {isReplaying ? t('recording.action.replaying') : t('recording.action.run')}
            </Button>
            <Button className="rounded-[4px]" onClick={onImportPlayback} type="button" variant="outline">
              <Import className="h-4 w-4" />
              {t('recording.action.import')}
            </Button>
          </div>
        }
        meta={[
          t('recording.meta.assets', { count: project.recordings.length }),
          t('recording.meta.steps', { count: recording?.steps.length ?? 0 }),
          t('recording.meta.browser', { status: browserSession.status }),
        ].map((item) => (
          <Badge className="page-header-meta" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('recording.header.title')}
      />

      <PageBody>
        <section className="designer-split recording-console figma-recording-console">
          <main className="designer-panel flex min-h-0 flex-col">
            <div className="designer-panel-header flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('recording.browser.title')}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  {recording?.name ?? t('recording.browser.selectAsset')}
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{browserSessionMessage}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={sessionTone} />
                <Button className="rounded-[4px]" onClick={onCaptureSnapshot} type="button" variant="outline">
                  <CircleDashed className="h-4 w-4" />
                  {t('recording.action.snapshot')}
                </Button>
                <Button className="rounded-[4px]" onClick={onStartRecording} type="button">
                  <Radar className="h-4 w-4" />
                  {t('recording.action.start')}
                </Button>
              </div>
            </div>

            <div className="designer-browser-stage flex-1 rounded-none border-0">
              <div className="designer-browser-bar">
                <span className="designer-browser-dot bg-red-400" />
                <span className="designer-browser-dot bg-amber-400" />
                <span className="designer-browser-dot bg-emerald-400" />
                <span className="min-w-0 flex-1 truncate rounded-[4px] bg-white/10 px-3 py-1 font-mono text-xs text-muted-foreground">
                  {browserSession.currentUrl || recording?.startUrl || environment?.url || project.defaultUrl}
                </span>
              </div>
              <div className="designer-browser-viewport">
                {browserSession.screenshotPath ? (
                  <img
                    alt={t('recording.screenshot.alt')}
                    className="h-full max-h-[560px] w-full rounded-[8px] object-contain"
                    src={`file://${browserSession.screenshotPath}`}
                  />
                ) : (
                  <div className="designer-browser-mock">
                    <div className="target-mock-header flex items-end justify-between border-b pb-4">
                      <div>
                        <p className="target-mock-eyebrow text-xs font-semibold uppercase tracking-[0.16em]">{t('recording.preview.eyebrow')}</p>
                        <h3 className="mt-2 text-2xl font-bold">{t('recording.preview.title')}</h3>
                      </div>
                      <Film className="h-6 w-6 text-primary" />
                    </div>
                    <div className="grid gap-3">
                      {[t('recording.preview.navigate'), t('recording.preview.click'), t('recording.preview.input')].map((item, index) => (
                        <div className="target-mock-step relative rounded-[10px] border p-4" key={item}>
                          {index === 1 ? <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-red-500 ring-4 ring-red-500/20" /> : null}
                          <p className="target-mock-step-title text-sm font-semibold">{item}</p>
                          <p className="target-mock-step-copy mt-1 text-xs">{t('recording.preview.interaction', { index: index + 1 })}</p>
                        </div>
                      ))}
                    </div>
                    <div className="target-mock-session rounded-[10px] p-5">
                      <div className="target-mock-session-meta flex justify-between text-sm">
                        <span>{t('recording.preview.session')}</span>
                        <span>{browserSession.status}</span>
                      </div>
                      <button className="target-mock-action mt-4 w-full rounded-[8px] py-3 text-sm font-bold" type="button">
                        {t('recording.preview.primaryAction')}
                      </button>
                    </div>
                  </div>
                )}
                {browserSession.status === 'ready' ? (
                  <span className="designer-recording-badge">
                    <span className="h-2 w-2 rounded-full bg-white" />
                    {t('recording.preview.inProgress')}
                  </span>
                ) : null}
              </div>
            </div>

            {recording ? (
              <div className="designer-minibar">
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('recording.asset.name')}</p>
                    <p className="mt-1 text-sm font-semibold">{recording.name}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('recording.asset.group')}</p>
                    <p className="mt-1 text-sm font-semibold">{groupsById.get(recording.groupId)?.name ?? t('recording.asset.ungrouped')}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('recording.asset.environment')}</p>
                    <p className="mt-1 text-sm font-semibold">
                      {environmentsById.get(recording.environmentId)?.name ?? environment?.name ?? t('recording.asset.unconfigured')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="rounded-[4px]" onClick={() => onDeleteRecording(recording.id)} type="button" variant="outline">
                    <Trash2 className="h-4 w-4" />
                    {t('recording.action.discard')}
                  </Button>
                  <Button className="rounded-[4px]" onClick={() => onCreateTestCaseFromRecording(recording.id)} type="button">
                    <Sparkles className="h-4 w-4" />
                    {t('recording.action.exportCase')}
                  </Button>
                </div>
              </div>
            ) : null}
          </main>

          <aside className="designer-panel flex min-h-0 flex-col">
            <div className="designer-panel-header">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('recording.timeline.eyebrow')}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">{t('recording.timeline.assets')}</h2>
                </div>
                <Button className="rounded-[4px]" onClick={onCreateRecording} size="sm" type="button" variant="outline">
                  <Plus className="h-4 w-4" />
                  {t('recording.action.create')}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {project.recordings.map((item) => (
                  <button
                    className={`rounded-[4px] px-2.5 py-1.5 text-xs transition ${
                      item.id === recording?.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                    key={item.id}
                    onClick={() => onSelectRecording(item.id)}
                    type="button"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="designer-panel-body flex-1">
              {!recording ? (
                <EvidenceCard title={t('recording.browser.selectAsset')} description={t('recording.timeline.emptyDescription')} />
              ) : (
                <div className="grid gap-4">
                  <Surface className="grid gap-4 p-4" variant="plain">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>{t('recording.form.name')}</Label>
                    <Input
                      onChange={(event) =>
                        onUpdateRecording((current) => ({ ...current, name: event.target.value }))
                      }
                      value={recording.name}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('recording.form.startUrl')}</Label>
                    <Input
                      onChange={(event) =>
                        onUpdateRecording((current) => ({ ...current, startUrl: event.target.value }))
                      }
                      value={recording.startUrl}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>{t('recording.form.group')}</Label>
                    <Select
                      onValueChange={(value) =>
                        onUpdateRecording((current) => ({ ...current, groupId: value }))
                      }
                      value={recording.groupId}
                    >
                      <SelectTrigger className="rounded-[4px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {project.groups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('recording.form.environment')}</Label>
                    <Select
                      onValueChange={(value) =>
                        onUpdateRecording((current) => ({ ...current, environmentId: value }))
                      }
                      value={recording.environmentId}
                    >
                      <SelectTrigger className="rounded-[4px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {project.environments.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>{t('recording.form.summary')}</Label>
                  <Textarea
                    className="min-h-[88px]"
                    onChange={(event) =>
                      onUpdateRecording((current) => ({ ...current, summary: event.target.value }))
                    }
                    value={recording.summary}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="grid gap-2">
                    <Label>{t('recording.form.comparisonGoal')}</Label>
                    <Textarea
                      className="min-h-[108px] leading-7"
                      onChange={(event) =>
                        onUpdateRecording((current) => ({
                          ...current,
                          comparisonGoal: event.target.value,
                        }))
                      }
                      value={recording.comparisonGoal}
                    />
                  </div>
                  <div className="grid content-start gap-2">
                    <Label htmlFor="recording-visual-diff-threshold">
                      {t('recording.form.visualDiffThreshold')}
                    </Label>
                    <Input
                      id="recording-visual-diff-threshold"
                      max="100"
                      min="0"
                      onChange={(event) => {
                        const percentage = Number(event.target.value);
                        const normalized = Number.isFinite(percentage)
                          ? Math.min(1, Math.max(0, percentage / 100))
                          : 0;
                        onUpdateRecording((current) => ({
                          ...current,
                          visualDiffThreshold: normalized,
                        }));
                      }}
                      step="0.1"
                      type="number"
                      value={Math.round((recording.visualDiffThreshold ?? 0) * 10000) / 100}
                    />
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Label>{t('recording.form.visualMasks')}</Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('recording.form.visualMasksDescription')}</p>
                    </div>
                    <Button
                      aria-label={t('recording.action.addVisualMask')}
                      className="rounded-[4px]"
                      onClick={() =>
                        onUpdateRecording((current) => {
                          const masks = current.visualDiffMasks ?? [];
                          return {
                            ...current,
                            visualDiffMasks: [
                              ...masks,
                              {
                                id: `visual-mask-${Date.now()}-${masks.length + 1}`,
                                label: t('recording.form.visualMaskDefault', { count: masks.length + 1 }),
                                x: 0,
                                y: 0,
                                width: 10,
                                height: 10,
                              },
                            ],
                          };
                        })
                      }
                      size="icon"
                      title={t('recording.action.addVisualMask')}
                      type="button"
                      variant="outline"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3">
                    {(recording.visualDiffMasks ?? []).map((mask, index) => (
                      <div className="grid gap-3 border-l-2 border-primary/45 bg-background/55 p-3 sm:grid-cols-[minmax(132px,1fr)_repeat(4,minmax(72px,0.45fr))_28px]" key={mask.id}>
                        <div className="grid gap-1">
                          <Label htmlFor={`recording-visual-mask-${mask.id}-label`}>{t('recording.form.visualMaskLabel')}</Label>
                          <Input
                            id={`recording-visual-mask-${mask.id}-label`}
                            onChange={(event) =>
                              onUpdateRecording((current) => ({
                                ...current,
                                visualDiffMasks: (current.visualDiffMasks ?? []).map((item) =>
                                  item.id === mask.id ? { ...item, label: event.target.value } : item,
                                ),
                              }))
                            }
                            value={mask.label}
                          />
                        </div>
                        {([
                          ['x', t('recording.form.visualMaskX')],
                          ['y', t('recording.form.visualMaskY')],
                          ['width', t('recording.form.visualMaskWidth')],
                          ['height', t('recording.form.visualMaskHeight')],
                        ] as const).map(([field, label]) => (
                          <div className="grid gap-1" key={field}>
                            <Label htmlFor={`recording-visual-mask-${mask.id}-${field}`}>{label}</Label>
                            <Input
                              id={`recording-visual-mask-${mask.id}-${field}`}
                              max="100"
                              min="0"
                              onChange={(event) =>
                                onUpdateRecording((current) => ({
                                  ...current,
                                  visualDiffMasks: (current.visualDiffMasks ?? []).map((item) =>
                                    item.id === mask.id
                                      ? normalizeVisualDiffMask({ ...item, [field]: Number(event.target.value) })
                                      : item,
                                  ),
                                }))
                              }
                              step="0.1"
                              type="number"
                              value={mask[field]}
                            />
                          </div>
                        ))}
                        <Button
                          aria-label={t('recording.action.removeVisualMask', { label: mask.label || `${index + 1}` })}
                          className="mt-auto rounded-[4px]"
                          onClick={() =>
                            onUpdateRecording((current) => ({
                              ...current,
                              visualDiffMasks: (current.visualDiffMasks ?? []).filter((item) => item.id !== mask.id),
                            }))
                          }
                          size="icon"
                          title={t('recording.action.removeVisualMask', { label: mask.label || `${index + 1}` })}
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {!(recording.visualDiffMasks ?? []).length ? (
                      <p className="text-xs text-muted-foreground">{t('recording.form.visualMasksEmpty')}</p>
                    ) : null}
                  </div>
                </div>
                  </Surface>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t('recording.replay.eyebrow')}</p>
                      <p className="mt-1 text-sm font-semibold">{t('recording.replay.title')}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                  {stepKinds.map((kind) => (
                    <Button className="rounded-[4px]" key={kind} onClick={() => onAppendStep(kind)} size="sm" type="button" variant="outline">
                      {t('recording.replay.addStep', { kind: getStepKindLabel(kind, t) })}
                    </Button>
                  ))}
                    </div>
                </div>

                  <div className="designer-timeline-list">
                {!recording.steps.length ? (
                  <EvidenceCard
                    title={t('recording.replay.waiting')}
                    description={t('recording.replay.waitingDescription')}
                  />
                ) : null}
                {recording.steps.map((step, index) => (
                  <article
                    className="designer-timeline-item"
                    key={step.id}
                  >
                    <div className="grid min-w-0 gap-3 rounded-[8px] border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Badge className="rounded-[4px]" variant="outline">
                          {String(index + 1).padStart(2, '0')} · {getStepKindLabel(step.kind, t)}
                        </Badge>
                        {step.capturedAt ? <span className="font-mono text-[10px] text-muted-foreground">{formatDate(step.capturedAt, locale)}</span> : null}
                      </div>
                      <div className="step-editor-grid">
                        <Input
                          aria-label={t('recording.replay.stepTitle')}
                          onChange={(event) =>
                            onUpdateRecording((current) => ({
                              ...current,
                              steps: current.steps.map((item) =>
                                item.id === step.id ? { ...item, title: event.target.value } : item,
                              ),
                            }))
                          }
                          value={step.title}
                        />
                        <Select
                          onValueChange={(value) =>
                            onUpdateRecording((current) => ({
                              ...current,
                              steps: current.steps.map((item) =>
                                item.id === step.id
                                  ? { ...item, kind: value as RecordingStepDraft['kind'] }
                                  : item,
                              ),
                            }))
                          }
                          value={step.kind}
                        >
                          <SelectTrigger className="rounded-[4px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {stepKinds.map((kind) => (
                              <SelectItem key={kind} value={kind}>
                                {getStepKindLabel(kind, t)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Textarea
                        className="step-editor-body"
                        onChange={(event) =>
                          onUpdateRecording((current) => ({
                            ...current,
                            steps: current.steps.map((item) =>
                              item.id === step.id ? { ...item, detail: event.target.value } : item,
                            ),
                          }))
                        }
                        value={step.detail}
                      />
                      {(step.pageUrl || step.screenshotPath || step.capturedAt) ? (
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {step.pageUrl ? (
                            <Badge className="max-w-full truncate rounded-[4px]" variant="outline">
                              {step.pageUrl}
                            </Badge>
                          ) : null}
                          {step.capturedAt ? (
                            <Badge className="rounded-[4px]" variant="outline">
                              {formatDate(step.capturedAt, locale)}
                            </Badge>
                          ) : null}
                          {step.screenshotPath ? (
                            <Badge className="rounded-[4px]" variant="outline">
                              {t('recording.replay.screenshotSaved')}
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
                  </div>

                  <Surface className="p-4" variant="evidence">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">{t('recording.signal.eyebrow')}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <MetricTile label={t('recording.signal.total')} value={`${project.recordings.length}`} />
                      <MetricTile label={t('recording.signal.steps')} value={`${recording.steps.length}`} tone="primary" />
                    </div>
                    <p className="mt-4 text-xs leading-6 text-muted-foreground">
                      {recording.summary || t('recording.signal.description')}
                    </p>
                  </Surface>
              </div>
              )}
            </div>
          </aside>
        </section>
      </PageBody>
    </PageShell>
  );
}
