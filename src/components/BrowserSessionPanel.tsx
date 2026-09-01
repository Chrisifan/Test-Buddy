import type { BrowserSessionState, ProjectDraft, ProjectEnvironment } from '../../shared/studio.js';

import { Camera, Compass, Play } from 'lucide-react';

import { StatusPill } from './StatusPill.js';
import { MetricTile, Surface } from './workbench.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '../i18n/index.js';

export const BrowserSessionPanel = ({
  session,
  project,
  environment,
  navigateUrl,
  isBusy,
  onChangeNavigateUrl,
  onStartSession,
  onNavigate,
  onCapture,
}: {
  session: BrowserSessionState;
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  navigateUrl: string;
  isBusy: boolean;
  onChangeNavigateUrl: (value: string) => void;
  onStartSession: () => void;
  onNavigate: () => void;
  onCapture: () => void;
}) => {
  const { t } = useI18n();
  const tone = session.status === 'error' ? 'failed' : session.status === 'ready' ? 'passed' : 'neutral';

  return (
    <Surface className="grid gap-4 p-4" variant="panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/82">{t('browser.eyebrow')}</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.04em]">{t('browser.title')}</h2>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
              {session.message}
            </p>
          </div>
          <StatusPill tone={tone} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <MetricTile label={t('browser.metric.project')} value={project?.name ?? t('browser.value.notSelected')} />
          <MetricTile label={t('browser.metric.environment')} value={environment?.name ?? t('browser.value.notConfigured')} />
          <MetricTile label={t('browser.metric.currentUrl')} value={session.currentUrl || environment?.url || t('browser.value.empty')} />
        </div>

        <Surface className="p-4" variant="subtle">
          {session.screenshotPath ? (
            <img
              alt={t('browser.screenshot.alt')}
              className="aspect-video w-full rounded-[4px] border border-border object-cover"
              src={`file://${session.screenshotPath}`}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-[4px] border border-dashed border-primary/30 text-sm text-muted-foreground">
              {t('browser.screenshot.empty')}
            </div>
          )}
        </Surface>

        <div className="grid gap-3 lg:grid-cols-[minmax(260px,680px),auto,auto,auto]">
          <div className="form-field">
            <Input
              aria-label={t('browser.navigation.label')}
              onChange={(event) => onChangeNavigateUrl(event.target.value)}
              placeholder={t('browser.navigation.placeholder')}
              value={navigateUrl}
            />
          </div>
          <Button disabled={!project || !environment || isBusy} onClick={onStartSession} type="button">
            <Play className="h-4 w-4" />
            {t('browser.action.start')}
          </Button>
          <Button disabled={!navigateUrl.trim() || isBusy} onClick={onNavigate} type="button" variant="outline">
            <Compass className="h-4 w-4" />
            {t('browser.action.navigate')}
          </Button>
          <Button disabled={isBusy} onClick={onCapture} type="button" variant="outline">
            <Camera className="h-4 w-4" />
            {t('browser.action.capture')}
          </Button>
        </div>
    </Surface>
  );
};
