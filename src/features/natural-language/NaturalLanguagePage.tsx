import type {
  ChatEntry,
  CommandMode,
  MidsceneConfig,
  RuntimeProfile,
} from '../../../shared/studio.js';
import type { AgentRunResult } from '../../../shared/agent.js';

import { BrainCircuit, ClipboardPlus, RadioTower, Send, SquareActivity } from 'lucide-react';

import { EvidenceCard, MetricTile, PageHeader, Surface, PageBody, PageShell } from '../../components/workbench.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '../../i18n/index.js';

const getModeLabel = (mode: CommandMode, t: (key: string) => string): string => {
  if (mode === 'aiAssert') {
    return t('nl.mode.assert');
  }

  if (mode === 'aiQuery') {
    return t('nl.mode.query');
  }

  return t('nl.mode.action');
};

const getRoleLabel = (role: ChatEntry['role'], t: (key: string) => string): string => {
  if (role === 'assistant') {
    return t('nl.role.runtime');
  }

  if (role === 'system') {
    return t('nl.role.system');
  }

  return t('nl.role.user');
};

const getEnvironmentLabel = (environment: string, t: (key: string) => string): string => {
  if (environment === 'production') return t('nl.environment.production');
  if (environment === 'local') return t('nl.environment.local');
  if (environment === 'staging') return t('nl.environment.staging');
  return environment;
};

export const NaturalLanguagePage = ({
  commandMode,
  chatInput,
  targetEnvironment,
  deepThink,
  deepLocate,
  isSending,
  isRunning,
  sessionActive,
  recentChatEntries,
  runtimeProfile,
  midsceneConfig,
  latestAgentRun,
  onChangeCommandMode,
  onChangeChatInput,
  onChangeTargetEnvironment,
  onChangeDeepThink,
  onChangeDeepLocate,
  onToggleSession,
  onSaveLatestRunAsTestCase,
  onSavePromptAsStep,
  onSendMessage,
}: {
  commandMode: CommandMode;
  chatInput: string;
  targetEnvironment: string;
  deepThink: boolean;
  deepLocate: boolean;
  isSending: boolean;
  isRunning: boolean;
  sessionActive: boolean;
  recentChatEntries: ChatEntry[];
  runtimeProfile: RuntimeProfile;
  midsceneConfig: MidsceneConfig;
  latestAgentRun?: Pick<AgentRunResult, 'status'>;
  onChangeCommandMode: (mode: CommandMode) => void;
  onChangeChatInput: (value: string) => void;
  onChangeTargetEnvironment: (value: string) => void;
  onChangeDeepThink: (value: boolean) => void;
  onChangeDeepLocate: (value: boolean) => void;
  onToggleSession: () => void;
  onSaveLatestRunAsTestCase: () => void;
  onSavePromptAsStep: () => void;
  onSendMessage: () => void;
}) => {
  const { t } = useI18n();
  const sessionStatus = sessionActive ? t('nl.session.active') : t('nl.session.standby');

  return (
    <PageShell>
      <PageHeader
        action={
          <Button disabled={isSending || isRunning} onClick={onToggleSession} type="button" variant="outline">
            <RadioTower className="h-4 w-4" />
            {sessionActive ? t('nl.session.stop') : t('nl.session.start')}
          </Button>
        }
        meta={[
          t('nl.meta.mode', { mode: getModeLabel(commandMode, t) }),
          t('nl.meta.environment', { environment: getEnvironmentLabel(targetEnvironment, t) }),
          t('nl.meta.session', { status: sessionStatus }),
        ].map((item) => (
          <Badge className="page-header-meta" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('nl.header.title')}
      />

      <PageBody>
      <section className="nl-metric-grid">
        <MetricTile label={t('nl.meta.session', { status: sessionStatus })} tone={sessionActive ? 'running' : 'neutral'} value={sessionStatus} />
        <MetricTile label={t('nl.meta.mode', { mode: getModeLabel(commandMode, t) })} tone="primary" value={getModeLabel(commandMode, t)} />
        <MetricTile label={t('nl.meta.environment', { environment: getEnvironmentLabel(targetEnvironment, t) })} value={getEnvironmentLabel(targetEnvironment, t)} />
        <MetricTile label={t('workflow.runtime.browser')} value={runtimeProfile.browser} />
      </section>
      <section className="designer-split nl-workbench nl-studio" aria-label={t('nl.aria.workbench')}>
        <aside className="designer-panel nl-command-panel grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
          <div className="designer-panel-header grid gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">{t('nl.session.title')}</h2>
              <div className={`flex items-center gap-2 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${sessionActive ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                <span className={`h-2 w-2 rounded-full ${sessionActive ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                {sessionStatus}
              </div>
            </div>
            <Tabs onValueChange={(value) => onChangeCommandMode(value as CommandMode)} value={commandMode}>
              <TabsList className="grid h-auto grid-cols-3 rounded-[6px] bg-muted p-1">
                {(['ai', 'aiAssert', 'aiQuery'] as const).map((mode) => (
                  <TabsTrigger
                    className="rounded-[4px] py-2 text-[11px] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                    key={mode}
                    value={mode}
                  >
                    {getModeLabel(mode, t)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="grid gap-2">
              <Select onValueChange={onChangeTargetEnvironment} value={targetEnvironment}>
                <SelectTrigger className="rounded-[4px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staging">{t('nl.environment.staging')}</SelectItem>
                  <SelectItem value="production">{t('nl.environment.production')}</SelectItem>
                  <SelectItem value="local">{t('nl.environment.local')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={deepThink} onCheckedChange={(checked) => onChangeDeepThink(Boolean(checked))} />
                  {t('nl.deepThink')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={deepLocate} onCheckedChange={(checked) => onChangeDeepLocate(Boolean(checked))} />
                  {t('nl.deepLocate')}
                </label>
              </div>
            </div>
          </div>

          <div className="designer-panel-body flex-1 space-y-3">
            {recentChatEntries.map((entry) => (
              <article
                className={`nl-chat-bubble max-w-[92%] rounded-[14px] px-3 py-2 text-sm leading-6 ${
                  entry.role === 'user'
                    ? 'ml-auto rounded-tr-[4px] bg-primary text-primary-foreground'
                    : 'rounded-tl-[4px] bg-muted text-foreground'
                }`}
                key={entry.id}
              >
                <p>{entry.text}</p>
                <p className={`mt-1 text-[10px] ${entry.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  {getRoleLabel(entry.role, t)}
                </p>
              </article>
            ))}
            {!recentChatEntries.length ? (
              <EvidenceCard title={t('nl.empty.title')} description={t('nl.empty.description')} />
            ) : null}
          </div>

          <div className="nl-command-composer shrink-0 border-t border-border bg-card p-4">
            <div className="relative">
              <Textarea
                className="min-h-[96px] pr-12 font-mono text-sm leading-6"
                onChange={(event) => onChangeChatInput(event.target.value)}
                placeholder={t('nl.command.placeholder')}
                rows={4}
                value={chatInput}
              />
              <Button className="absolute bottom-3 right-3 h-8 w-8 rounded-[4px] p-0" disabled={isSending} onClick={onSendMessage} type="button">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={onSavePromptAsStep} size="sm" type="button" variant="outline">{t('nl.saveAsStep')}</Button>
              {latestAgentRun?.status === 'passed' ? (
                <Button disabled={isSending || isRunning} onClick={onSaveLatestRunAsTestCase} size="sm" type="button" variant="outline">
                  <ClipboardPlus className="h-4 w-4" />
                  {t('nl.saveAsCase')}
                </Button>
              ) : null}
              <Button disabled={isSending || isRunning} onClick={onToggleSession} size="sm" type="button" variant="outline">
                {sessionActive ? t('nl.session.stop') : t('nl.session.start')}
              </Button>
            </div>
          </div>
        </aside>

        <section className="designer-panel nl-browser-panel min-h-0">
          <div className="designer-browser-stage">
            <div className="designer-browser-bar">
              <span className="designer-browser-dot bg-red-300" />
              <span className="designer-browser-dot bg-amber-300" />
              <span className="designer-browser-dot bg-emerald-400" />
              <div className="ml-2 flex h-7 flex-1 items-center rounded-[4px] border border-border bg-card px-3 font-mono text-[11px] text-muted-foreground">
                {runtimeProfile.baseUrl || 'https://app.demo-workspace.com'}
              </div>
            </div>
            <div className="designer-browser-viewport">
              <div className="nl-browser-empty-card w-full max-w-md rounded-[8px] border border-border bg-card p-5 shadow-sm">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <SquareActivity className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-center text-lg font-bold">{t('nl.stage.title')}</h3>
                <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
                  {t('nl.stage.description')}
                </p>
                <div className="mt-4 rounded-[4px] border-2 border-dashed border-primary/30 px-3 py-2 text-center text-xs font-semibold text-primary">
                  {t('nl.stage.tools')}
                </div>
              </div>
            </div>
          </div>

        </section>

        <aside className="designer-panel nl-planner-panel min-h-0">
          <header className="designer-panel-header">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{t('nl.flow.title')}</h2>
              <span className={`nl-planner-state ${sessionActive ? 'is-active' : ''}`}>{sessionStatus}</span>
            </div>
          </header>
          <div className="nl-evidence-grid">
            <Surface className="p-4" variant="panel">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t('nl.flow.title')}</p>
                <Button size="sm" type="button" variant="outline">{t('nl.flow.run')}</Button>
              </div>
              <div className="mt-3 grid gap-2">
                {recentChatEntries.slice(-3).map((entry, index) => (
                  <div className="flex items-center gap-3 rounded-[4px] border border-border bg-muted px-3 py-2" key={entry.id}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-primary/10 font-mono text-[10px] text-primary">{index + 1}</span>
                    <span className="truncate text-sm">{entry.text}</span>
                  </div>
                ))}
                {!recentChatEntries.length ? <p className="text-sm text-muted-foreground">{t('nl.flow.empty')}</p> : null}
              </div>
            </Surface>
            <Surface className="p-4" variant="panel">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-80">{t('nl.confidence')}</p>
              <p className="mt-2 text-xl font-bold tracking-[-0.03em] text-foreground">
                {midsceneConfig.modelSecret.hasKey ? t('settings.status.ready') : t('nl.model.pending')}
              </p>
              <p className="mt-3 truncate font-mono text-xs text-muted-foreground">MidScene {midsceneConfig.modelName || t('nl.model.unset')}</p>
            </Surface>
          </div>
        </aside>
      </section>
      </PageBody>
    </PageShell>
  );
};
