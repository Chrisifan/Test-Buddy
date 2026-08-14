import { Bot, FileText, KeyRound, MousePointerClick, Rocket, ServerCog, TerminalSquare } from 'lucide-react';

import type { MidsceneConfig } from '../../../shared/studio.js';
import { createTranslator, type SupportedLocale } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function StartupPage({
  brandLogo,
  locale = 'zh-CN',
  midsceneConfig,
  midsceneReady,
  onComplete,
  onSkip,
  onUpdateMidsceneConfig,
}: {
  brandLogo: string;
  locale?: SupportedLocale;
  midsceneConfig: MidsceneConfig;
  midsceneReady: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onUpdateMidsceneConfig: (patch: Partial<MidsceneConfig>) => void;
}) {
  const t = createTranslator(locale);
  const startupSteps = [
    ['01', t('startup.step.configureMidscene'), midsceneReady ? t('startup.step.done') : t('startup.step.current')],
    ['02', t('startup.step.enterWorkbench'), midsceneReady ? t('startup.step.current') : t('startup.step.waiting')],
    ['03', t('startup.step.startTesting'), t('startup.step.ready')],
  ];

  return (
    <section aria-label={t('startup.aria.screen')} className="home-empty-shell startup-shell">
      <main className="home-empty-main startup-main">
        <header aria-label="TestBuddy" className="startup-header" role="banner">
          <div className="startup-brand" aria-label="TestBuddy">
            <img alt="TestBuddy" className="startup-brand-logo" src={brandLogo} />
            <span>
              <strong>TestBuddy</strong>
              <small>AUTOMATION ENGINE</small>
            </span>
          </div>
          <section className="startup-step-list" aria-label={t('startup.aria.steps')}>
            {startupSteps.map(([index, title, status], itemIndex) => {
              const isDone = itemIndex === 0 && midsceneReady;
              const isActive = midsceneReady ? itemIndex === 1 : itemIndex === 0;
              return (
                <div className={`home-start-step ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`} key={title}>
                  <span className="home-start-step-index">{isDone ? '✓' : index}</span>
                  <span>
                    <span className="home-start-step-title">{title}</span>
                    <span className="home-start-step-status">{status}</span>
                  </span>
                </div>
              );
            })}
          </section>
          <a className="startup-help-link" href="https://midscenejs.com" rel="noreferrer" target="_blank">View Docs</a>
        </header>

        <section className="home-start-panel">
          <div className="home-empty-hero">
            <div className="home-empty-orb" aria-hidden="true">
              <div className="home-empty-rocket">
                <Rocket className="h-20 w-20" strokeWidth={2.4} />
              </div>
            </div>
            <p className="home-empty-kicker">{t('startup.kicker')}</p>
            <h1 className="home-empty-title">{t('startup.title')}</h1>
            <p className="home-empty-description">
              {t('startup.description')}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                [FileText, t('startup.feature.prd'), t('startup.feature.prdDescription')],
                [Bot, t('startup.feature.nl'), t('startup.feature.nlDescription')],
                [MousePointerClick, t('startup.feature.recording'), t('startup.feature.recordingDescription')],
              ].map(([Icon, title, description]) => {
                const FeatureIcon = Icon as typeof FileText;
                return (
                  <div className="startup-feature" key={title as string}>
                    <FeatureIcon className="h-4 w-4 text-primary" />
                    <span className="mt-2 block text-sm font-bold">{title as string}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{description as string}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="home-midscene-card" aria-label={t('startup.aria.midsceneQuickConfig')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="home-empty-kicker">{t('startup.midscene.section')}</p>
                <h2 className="text-lg font-bold tracking-[-0.03em]">{t('startup.midscene.title')}</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('startup.midscene.description')}
                </p>
              </div>
              <span className={`home-midscene-state ${midsceneReady ? 'is-ready' : ''}`}>
                {midsceneReady ? t('startup.midscene.state.ready') : t('startup.midscene.state.required')}
              </span>
            </div>

            <div className="home-midscene-grid">
              <div className="home-midscene-field is-wide">
                <Label>MIDSCENE_MODEL_BASE_URL</Label>
                <Input
                  onChange={(event) => onUpdateMidsceneConfig({ modelBaseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  value={midsceneConfig.modelBaseUrl}
                />
              </div>
              <div className="home-midscene-field">
                <Label>MIDSCENE_MODEL_API_KEY</Label>
                <Input
                  onChange={(event) => onUpdateMidsceneConfig({ modelApiKey: event.target.value })}
                  placeholder="sk-..."
                  type="password"
                  value={midsceneConfig.modelApiKey}
                />
              </div>
              <div className="home-midscene-field">
                <Label>MIDSCENE_MODEL_NAME</Label>
                <Input
                  onChange={(event) => onUpdateMidsceneConfig({ modelName: event.target.value })}
                  placeholder="gpt-4o / qwen-vl-max"
                  value={midsceneConfig.modelName}
                />
              </div>
              <div className="home-midscene-field">
                <Label>MIDSCENE_MODEL_FAMILY</Label>
                <Input
                  onChange={(event) => onUpdateMidsceneConfig({ modelFamily: event.target.value })}
                  placeholder="openai / qwen / doubao"
                  value={midsceneConfig.modelFamily}
                />
              </div>
              <div className="home-midscene-field">
                <Label>{t('startup.midscene.contextLabel')}</Label>
                <Textarea
                  className="min-h-[74px]"
                  onChange={(event) => onUpdateMidsceneConfig({ defaultContext: event.target.value })}
                  placeholder={t('startup.midscene.contextPlaceholder')}
                  value={midsceneConfig.defaultContext}
                />
              </div>
            </div>

            <div className="home-midscene-actions">
              <Button className="rounded-[4px]" disabled={!midsceneReady} onClick={onComplete} type="button">
                {t('startup.midscene.save')}
              </Button>
              <Button className="rounded-[4px]" onClick={onSkip} type="button" variant="ghost">
                {t('startup.midscene.skip')}
              </Button>
            </div>
            <div className="home-midscene-note">
              <KeyRound className="h-4 w-4" />
              <span>{t('startup.midscene.note')}</span>
            </div>
          </aside>
        </section>
      </main>
      <footer className="home-empty-status">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {t('startup.footer.ready')}
          </span>
          <span>|</span>
          <span>{t('startup.footer.guide')}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>TestBuddy</span>
          <ServerCog className="h-3.5 w-3.5" />
          <TerminalSquare className="h-3.5 w-3.5" />
        </div>
      </footer>
    </section>
  );
}
