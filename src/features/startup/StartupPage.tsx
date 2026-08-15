import {
  Bot,
  Check,
  FileText,
  KeyRound,
  MonitorSmartphone,
  MousePointerClick,
} from 'lucide-react';

import type { MidsceneConfig } from '../../../shared/studio.js';
import { createTranslator, type SupportedLocale } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

function StartupFlowVisual({ brandLogo }: { brandLogo: string }) {
  const testNodes = [FileText, MousePointerClick, MonitorSmartphone];

  return (
    <div aria-hidden="true" className="startup-flow-visual" data-testid="startup-flow-visual">
      <div className="startup-test-orbit" data-testid="startup-flow-orbit">
        {[1, 2, 3, 4, 5].map((trace) => (
          <span className={`startup-test-orbit-trace is-trace-${trace}`} data-testid="startup-flow-trace" key={trace} />
        ))}
        <span className="startup-test-hub" data-testid="startup-flow-hub">
          <img alt="" className="startup-test-hub-logo" data-testid="startup-flow-logo" src={brandLogo} />
          <span className="startup-test-hub-check" data-testid="startup-flow-success"><Check /></span>
        </span>
        {testNodes.map((Icon, index) => {
          const TestIcon = Icon as typeof FileText;
          return (
            <span className={`startup-test-orbit-node is-node-${index + 1}`} data-testid="startup-flow-node" key={index}>
              <span className="startup-test-orbit-node-core"><TestIcon /></span>
              <span className="startup-test-orbit-node-check"><Check /></span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

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
  const startupFeatures = [
    [FileText, t('startup.feature.prd'), t('startup.feature.prdDescription')],
    [Bot, t('startup.feature.nl'), t('startup.feature.nlDescription')],
    [MousePointerClick, t('startup.feature.recording'), t('startup.feature.recordingDescription')],
  ];

  return (
    <section aria-label={t('startup.aria.screen')} className="startup-shell">
      <aside aria-label="TestBuddy" className="startup-brand-panel" data-testid="startup-brand-panel">
        <StartupFlowVisual brandLogo={brandLogo} />

        <div className="startup-brand-capabilities">
          <div className="startup-brand-capabilities-grid">
            {startupFeatures.map(([Icon, title, description]) => {
              const FeatureIcon = Icon as typeof FileText;
              return (
                <div className="startup-brand-capability" data-testid="startup-brand-capability" key={title as string}>
                  <FeatureIcon aria-hidden="true" />
                  <span>{title as string}</span>
                  <small>{description as string}</small>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="startup-workspace" data-testid="startup-workspace">
        <section className="startup-workspace-inner">
          <aside className="home-midscene-card" aria-label={t('startup.aria.midsceneQuickConfig')}>
            <div className="startup-midscene-heading">
              <div className="startup-midscene-title">
                <h2>{t('startup.midscene.title')}</h2>
                <span>{t('startup.midscene.description')}</span>
              </div>
              <div className="startup-midscene-meta">
                <span className={`home-midscene-state ${midsceneReady ? 'is-ready' : ''}`}>
                  {midsceneReady ? t('startup.midscene.state.ready') : t('startup.midscene.state.required')}
                </span>
                <a className="startup-help-link" href="https://midscenejs.com" rel="noreferrer" target="_blank">View Docs</a>
              </div>
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

            <div className="startup-midscene-footer">
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
            </div>
          </aside>

          <p className="startup-security-note"><KeyRound aria-hidden="true" />{t('startup.securityNote')}</p>
        </section>
      </main>
    </section>
  );
}
