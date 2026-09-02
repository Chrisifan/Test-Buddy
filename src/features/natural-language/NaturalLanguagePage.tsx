import type {
  BrowserSessionState,
  ChatEntry,
  CommandMode,
} from '../../../shared/studio.js';
import type { AgentRunResult } from '../../../shared/agent.js';

import { ClipboardPlus, MonitorDot, Play, Send, Square } from 'lucide-react';

import { EvidenceCard, PageHeader, PageBody, PageShell } from '../../components/workbench.js';
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

const getBrowserStatus = (
  browserSession: BrowserSessionState,
  sessionActive: boolean,
  t: (key: string) => string,
): { description: string; title: string } => {
  if (browserSession.status === 'ready') {
    return {
      description: t('nl.browser.connectedDescription'),
      title: t('nl.browser.connected'),
    };
  }

  if (browserSession.status === 'starting' || browserSession.status === 'navigating') {
    return {
      description: t('nl.browser.connectingDescription'),
      title: t('nl.browser.connecting'),
    };
  }

  if (browserSession.status === 'error') {
    return {
      description: t('nl.browser.errorDescription'),
      title: t('nl.browser.error'),
    };
  }

  if (browserSession.status === 'closed') {
    return {
      description: t('nl.browser.closedDescription'),
      title: t('nl.browser.closed'),
    };
  }

  if (sessionActive) {
    return {
      description: t('nl.browser.waitingDescription'),
      title: t('nl.browser.waiting'),
    };
  }

  return {
    description: t('nl.browser.disconnectedDescription'),
    title: t('nl.browser.disconnected'),
  };
};

export const NaturalLanguagePage = ({
  browserSession,
  commandMode,
  chatInput,
  targetEnvironment,
  deepThink,
  deepLocate,
  isSending,
  isRunning,
  sessionActive,
  recentChatEntries,
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
  browserSession: BrowserSessionState;
  commandMode: CommandMode;
  chatInput: string;
  targetEnvironment: string;
  deepThink: boolean;
  deepLocate: boolean;
  isSending: boolean;
  isRunning: boolean;
  sessionActive: boolean;
  recentChatEntries: ChatEntry[];
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
  const browserStatus = getBrowserStatus(browserSession, sessionActive, t);

  return (
    <PageShell>
      <PageHeader
        meta={[
          t('nl.meta.mode', { mode: getModeLabel(commandMode, t) }),
          t('nl.meta.environment', { environment: getEnvironmentLabel(targetEnvironment, t) }),
        ].map((item) => (
          <Badge className="page-header-meta" key={item} variant="outline">
            {item}
          </Badge>
        ))}
        title={t('nl.header.title')}
      />

      <PageBody>
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
              </div>
            </div>
          </aside>

          <section aria-label={t('nl.browser.status')} className="designer-panel nl-browser-panel min-h-0">
            <header className="designer-panel-header flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">{t('nl.browser.status')}</h2>
              <span className={`nl-browser-status-pill is-${browserSession.status}`}>{browserStatus.title}</span>
            </header>
            <div className="nl-browser-status-body">
              <div className="nl-browser-status-icon" aria-hidden="true">
                <MonitorDot className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground">{browserStatus.title}</p>
                <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{browserStatus.description}</p>
                {browserSession.currentUrl ? (
                  <p className="nl-browser-address mt-4" title={browserSession.currentUrl}>{browserSession.currentUrl}</p>
                ) : null}
                {browserSession.status !== 'idle' && browserSession.message ? (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{browserSession.message}</p>
                ) : null}
              </div>
              <Button className="justify-self-start" disabled={isSending || isRunning} onClick={onToggleSession} type="button">
                {sessionActive ? <Square className="size-4" /> : <Play className="size-4" />}
                {sessionActive ? t('nl.session.stop') : t('nl.session.start')}
              </Button>
            </div>
          </section>
        </section>
      </PageBody>
    </PageShell>
  );
};
