import { useEffect, useState } from 'react';
import type {
  AgentModelConfig,
  AgentModelRole,
  AgentRoleModelConfig,
  AppearanceConfig,
  LocaleMode,
  MidsceneConfig,
  MidsceneConnectionTestResult,
  RuntimeProfile,
  ThemeMode,
} from '../../../shared/studio.js';

import { Bot, BrainCircuit, ChevronDown, CircleCheck, CircleHelp, CircleX, LoaderCircle, Moon, MonitorCog, MousePointerClick, Palette, PlayCircle, Settings2, Sun, Waypoints, Wifi, Workflow } from 'lucide-react';
import { createTranslator, type SupportedLocale } from '@/i18n';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const themeOptions: Array<{
  mode: ThemeMode;
  titleKey: string;
  descriptionKey: string;
  icon: typeof Sun;
}> = [
  {
    mode: 'light',
    titleKey: 'settings.theme.light',
    descriptionKey: 'settings.theme.lightDescription',
    icon: Sun,
  },
  {
    mode: 'dark',
    titleKey: 'settings.theme.dark',
    descriptionKey: 'settings.theme.darkDescription',
    icon: Moon,
  },
  {
    mode: 'system',
    titleKey: 'settings.theme.system',
    descriptionKey: 'settings.theme.systemDescription',
    icon: MonitorCog,
  },
];

const localeOptions: Array<{
  mode: LocaleMode;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    mode: 'zh-CN',
    titleKey: 'settings.language.zh',
    descriptionKey: 'settings.language.zhDescription',
  },
  {
    mode: 'en-US',
    titleKey: 'settings.language.en',
    descriptionKey: 'settings.language.enDescription',
  },
  {
    mode: 'system',
    titleKey: 'settings.language.system',
    descriptionKey: 'settings.language.systemDescription',
  },
];

export type SettingsSectionId = 'appearance' | 'midscene' | 'agentModels' | 'runtime';

const settingsSections: Array<{
  id: SettingsSectionId;
  labelKey: string;
  icon: typeof Palette;
}> = [
  {
    id: 'appearance',
    labelKey: 'settings.nav.general',
    icon: Palette,
  },
  {
    id: 'midscene',
    labelKey: 'settings.nav.midscene',
    icon: Waypoints,
  },
  {
    id: 'agentModels',
    labelKey: 'settings.nav.agentModels',
    icon: BrainCircuit,
  },
  {
    id: 'runtime',
    labelKey: 'settings.nav.execution',
    icon: PlayCircle,
  },
];

const agentRoleOptions: Array<{
  role: AgentModelRole;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    role: 'planner',
    titleKey: 'settings.agent.planner',
    descriptionKey: 'settings.agent.plannerDescription',
  },
  {
    role: 'executor',
    titleKey: 'settings.agent.executor',
    descriptionKey: 'settings.agent.executorDescription',
  },
  {
    role: 'verifier',
    titleKey: 'settings.agent.verifier',
    descriptionKey: 'settings.agent.verifierDescription',
  },
  {
    role: 'reporter',
    titleKey: 'settings.agent.reporter',
    descriptionKey: 'settings.agent.reporterDescription',
  },
];

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Label>{label}</Label>
      {hint ? (
        <span className="group relative inline-flex shrink-0">
          <button
            aria-label={hint}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            type="button"
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
          <span
            className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 rounded-[4px] border border-border bg-popover px-2.5 py-2 text-xs leading-5 text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            role="tooltip"
          >
            {hint}
          </span>
        </span>
      ) : null}
    </div>
  );
}

export function SettingsModal({
  open,
  initialSection = 'appearance',
  midsceneConfig,
  agentModelConfig,
  runtimeProfile,
  midsceneReady,
  requiresMidsceneBeforeSave = false,
  appearance,
  effectiveTheme,
  locale,
  onClose,
  onSave,
  onTestMidsceneConnection,
  onUpdateAppearance,
  onUpdateAgentModelConfig,
  onUpdateMidsceneConfig,
  onUpdateRuntimeProfile,
}: {
  open: boolean;
  initialSection?: SettingsSectionId;
  midsceneConfig: MidsceneConfig;
  agentModelConfig: AgentModelConfig;
  runtimeProfile: RuntimeProfile;
  midsceneReady: boolean;
  requiresMidsceneBeforeSave?: boolean;
  appearance: AppearanceConfig;
  effectiveTheme: 'light' | 'dark';
  locale: SupportedLocale;
  onClose: () => void;
  onSave: () => void;
  onTestMidsceneConnection: (config: MidsceneConfig) => Promise<MidsceneConnectionTestResult>;
  onUpdateAppearance: (patch: Partial<AppearanceConfig>) => void;
  onUpdateAgentModelConfig: (role: AgentModelRole, patch: Partial<AgentRoleModelConfig>) => void;
  onUpdateMidsceneConfig: (patch: Partial<MidsceneConfig>) => void;
  onUpdateRuntimeProfile: (patch: Partial<RuntimeProfile>) => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [expandedAgentRole, setExpandedAgentRole] = useState<AgentModelRole>();
  const [isTestingMidsceneConnection, setIsTestingMidsceneConnection] = useState(false);
  const [midsceneConnectionResult, setMidsceneConnectionResult] = useState<MidsceneConnectionTestResult>();

  useEffect(() => {
    setMidsceneConnectionResult(undefined);
  }, [midsceneConfig.modelApiKey, midsceneConfig.modelBaseUrl, midsceneConfig.modelFamily, midsceneConfig.modelName]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveSection(initialSection);
    setExpandedAgentRole(undefined);
  }, [initialSection, open]);

  if (!open) {
    return null;
  }

  const t = createTranslator(locale);
  const currentThemeLabel =
    effectiveTheme === 'dark' ? t('settings.theme.dark') : t('settings.theme.light');
  const showMissingRequiredState = requiresMidsceneBeforeSave && !midsceneReady;
  const statusLabel = midsceneReady
    ? t('settings.status.ready')
    : requiresMidsceneBeforeSave
      ? t('settings.status.missingRequired')
      : t('settings.status.midsceneOptional');

  const statusBadge = (
    <Badge
      className={`rounded-[3px] ${
        showMissingRequiredState
          ? 'bg-destructive/12 text-destructive'
          : midsceneReady
            ? 'bg-primary/12 text-primary'
            : 'bg-muted text-muted-foreground'
      }`}
      variant="outline"
    >
      {statusLabel}
    </Badge>
  );
  const saveLabel = requiresMidsceneBeforeSave ? t('common.saveAndContinue') : t('common.saveSettings');
  const midsceneConnectionMessage = midsceneConnectionResult
    ? midsceneConnectionResult.status === 'passed'
      ? t('settings.midscene.connectionPassed', { duration: midsceneConnectionResult.durationMs })
      : midsceneConnectionResult.failure === 'configuration'
        ? t('settings.midscene.connectionConfiguration')
        : midsceneConnectionResult.failure === 'http'
          ? t('settings.midscene.connectionHttp', { status: midsceneConnectionResult.httpStatus ?? '—' })
          : midsceneConnectionResult.failure === 'response'
            ? t('settings.midscene.connectionResponse')
            : t('settings.midscene.connectionNetwork')
    : undefined;

  async function handleTestMidsceneConnection() {
    if (isTestingMidsceneConnection || !midsceneReady) {
      return;
    }

    setIsTestingMidsceneConnection(true);
    try {
      setMidsceneConnectionResult(await onTestMidsceneConnection(midsceneConfig));
    } catch {
      setMidsceneConnectionResult({
        status: 'failed',
        modelName: midsceneConfig.modelName.trim(),
        durationMs: 0,
        failure: 'network',
      });
    } finally {
      setIsTestingMidsceneConnection(false);
    }
  }
  const settingsShell = (
    <div className="settings-dialog-shell flex min-h-0 w-full flex-col overflow-hidden rounded-[8px]">
      <DialogHeader className="settings-dialog-topbar flex h-[52px] shrink-0 flex-row items-center justify-between border-b border-border px-3.5 py-0 text-left">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-primary/12 text-primary">
            <Settings2 className="h-3.5 w-3.5" />
          </span>
          <div>
            <DialogTitle className="text-base font-semibold">{t('settings.title')}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.description')}
            </DialogDescription>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge}
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-border bg-card text-muted-foreground shadow-sm transition hover:border-primary/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 dark:bg-black/70">
            <span aria-hidden="true" className="text-lg leading-none">×</span>
            <span className="sr-only">{t('common.close')}</span>
          </DialogClose>
        </div>
      </DialogHeader>

      <nav className="settings-dialog-mobile-nav flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 md:hidden">
        {settingsSections.map((section) => {
          const NavIcon = section.icon;
          return (
            <button
              aria-current={activeSection === section.id ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 text-xs font-medium transition ${
                activeSection === section.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              <NavIcon className="h-3.5 w-3.5" />
              {t(section.labelKey)}
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1">
        <nav className="settings-dialog-aside hidden w-48 shrink-0 border-r border-border p-4 md:grid md:content-start md:gap-1">
          {settingsSections.map((section) => {
            const NavIcon = section.icon;
            return (
              <button
                aria-current={activeSection === section.id ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-[4px] border-l-4 px-3 py-2 text-sm transition ${
                  activeSection === section.id
                    ? 'border-l-4 border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <NavIcon className="h-4 w-4" />
                {t(section.labelKey)}
              </button>
            );
          })}
        </nav>

        <main className="settings-dialog-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {activeSection === 'appearance' ? (
              <section id="appearance">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.appearance.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-lg font-semibold">{t('settings.appearance.title')}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('settings.appearance.currentTheme')}：{currentThemeLabel}。{t('settings.appearance.description')}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const title = t(option.titleKey);
                    const description = t(option.descriptionKey);
                    return (
                      <button
                        className={`grid cursor-pointer gap-2 rounded-[6px] border p-3 text-center transition ${
                          appearance.themeMode === option.mode
                            ? 'border-primary bg-primary/8 text-primary shadow-sm'
                            : 'border-border bg-card hover:border-primary/40'
                        }`}
                        key={option.mode}
                        onClick={() => onUpdateAppearance({ themeMode: option.mode })}
                        type="button"
                      >
                        <span
                          className={`flex aspect-[16/7] items-center justify-center rounded-[5px] border ${
                            option.mode === 'dark'
                              ? 'border-slate-700 bg-slate-900'
                              : option.mode === 'system'
                                ? 'border-border bg-gradient-to-br from-white to-slate-900'
                                : 'border-border bg-white'
                          }`}
                        >
                          <Icon className="h-5 w-5 text-primary" />
                        </span>
                        <span className="text-sm font-semibold">{title}</span>
                        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-[6px] border border-border bg-muted/60 p-3">
                  <h3 className="text-sm font-semibold">{t('settings.appearance.languageTitle')}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('settings.appearance.languageDescription')}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {localeOptions.map((option) => (
                      <button
                        className={`rounded-[4px] border px-2.5 py-1.5 text-xs transition ${
                          appearance.localeMode === option.mode
                            ? 'border-primary bg-primary/10 font-semibold text-primary'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        }`}
                        key={option.mode}
                        onClick={() => onUpdateAppearance({ localeMode: option.mode })}
                        type="button"
                      >
                        <span>{t(option.titleKey)}</span>
                        <span className="ml-1.5 text-[11px] opacity-70">{t(option.descriptionKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
          ) : null}

          {activeSection === 'midscene' ? (
              <section id="midscene">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.midscene.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-lg font-semibold">{t('settings.midscene.title')}</h2>
                <div className="mt-4 grid gap-4">
                  <div className="form-field is-url">
                    <FieldLabel label="MIDSCENE_MODEL_BASE_URL" hint={t('settings.midscene.baseUrlHint')} />
                    <Input
                      onChange={(event) => onUpdateMidsceneConfig({ modelBaseUrl: event.target.value })}
                      placeholder="https://api.openai.com/v1"
                      value={midsceneConfig.modelBaseUrl}
                    />
                  </div>
                  <div className="form-grid">
                    <div className="form-field">
                      <Label>MIDSCENE_MODEL_API_KEY</Label>
                      <Input
                        onChange={(event) => onUpdateMidsceneConfig({ modelApiKey: event.target.value })}
                        placeholder="sk-..."
                        type="password"
                        value={midsceneConfig.modelApiKey}
                      />
                    </div>
                    <div className="form-field">
                      <Label>MIDSCENE_MODEL_NAME</Label>
                      <Input
                        onChange={(event) => onUpdateMidsceneConfig({ modelName: event.target.value })}
                        placeholder="gpt-4o / qwen-vl-max / doubao-..."
                        value={midsceneConfig.modelName}
                      />
                    </div>
                    <div className="form-field">
                      <FieldLabel label="MIDSCENE_MODEL_FAMILY" hint={t('settings.midscene.familyHint')} />
                      <Input
                        onChange={(event) => onUpdateMidsceneConfig({ modelFamily: event.target.value })}
                        placeholder="openai / qwen / doubao / gemini / ui-tars"
                        value={midsceneConfig.modelFamily}
                      />
                    </div>
                    <div className="form-field">
                      <Label>MIDSCENE_PREFERRED_LANGUAGE</Label>
                      <Input
                        onChange={(event) => onUpdateMidsceneConfig({ preferredLanguage: event.target.value })}
                        placeholder="Chinese"
                        value={midsceneConfig.preferredLanguage}
                      />
                    </div>
                    <div className="form-field">
                      <Label>MIDSCENE_REPLANNING_CYCLE_LIMIT</Label>
                      <Input
                        onChange={(event) => onUpdateMidsceneConfig({ replanningCycleLimit: event.target.value })}
                        placeholder="10"
                        value={midsceneConfig.replanningCycleLimit}
                      />
                    </div>
                    <div className="form-field">
                      <Label>MIDSCENE_OPENAI_HTTP_PROXY</Label>
                      <Input
                        onChange={(event) => onUpdateMidsceneConfig({ openaiHttpProxy: event.target.value })}
                        placeholder="http://127.0.0.1:7890"
                        value={midsceneConfig.openaiHttpProxy}
                      />
                    </div>
                    <div className="form-field">
                      <Label>{t('settings.midscene.contextLabel')}</Label>
                      <Textarea
                        className="min-h-[96px]"
                        onChange={(event) => onUpdateMidsceneConfig({ defaultContext: event.target.value })}
                        placeholder={t('settings.midscene.contextPlaceholder')}
                        value={midsceneConfig.defaultContext}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border bg-muted/60 px-3 py-2.5" data-testid="midscene-connection-test">
                  <div className="flex min-w-0 items-center gap-2">
                    <Wifi className="h-4 w-4 shrink-0 text-primary" />
                    <h3 className="text-sm font-semibold">{t('settings.midscene.connectionTitle')}</h3>
                  </div>
                  <Button
                    className="min-w-[116px] rounded-[4px]"
                    disabled={!midsceneReady || isTestingMidsceneConnection}
                    onClick={handleTestMidsceneConnection}
                    type="button"
                    variant="outline"
                  >
                    {isTestingMidsceneConnection ? (
                      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wifi aria-hidden="true" className="h-4 w-4" />
                    )}
                    {isTestingMidsceneConnection
                      ? t('settings.midscene.connectionTesting')
                      : t('settings.midscene.connectionTest')}
                  </Button>
                  {midsceneConnectionMessage ? (
                    <div
                      className={`flex w-full items-center gap-2 text-xs ${
                        midsceneConnectionResult?.status === 'passed' ? 'text-primary' : 'text-destructive'
                      }`}
                      role="status"
                    >
                      {midsceneConnectionResult?.status === 'passed' ? (
                        <CircleCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CircleX aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{midsceneConnectionMessage}</span>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 rounded-[6px] border border-border bg-muted p-3">
                  <h3 className="text-sm font-semibold">{t('settings.midscene.unlockedTitle')}</h3>
                  <div className="mt-2.5 grid gap-2 md:grid-cols-3">
                    {[
                      [Bot, t('settings.midscene.feature.nl'), t('settings.midscene.feature.nlDescription')],
                      [Workflow, t('settings.midscene.feature.workflow'), t('settings.midscene.feature.workflowDescription')],
                      [MousePointerClick, t('settings.midscene.feature.recording'), t('settings.midscene.feature.recordingDescription')],
                    ].map(([Icon, title, description]) => {
                      const FeatureIcon = Icon as typeof Bot;
                      return (
                        <div className="rounded-[4px] border border-border bg-card p-2.5" key={title as string}>
                          <FeatureIcon className="h-4 w-4 text-primary" />
                          <p className="mt-2 text-sm font-semibold">{title as string}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description as string}</p>
                        </div>
                      );
                    })}
                  </div>
                  {!midsceneReady ? (
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {t('settings.midscene.requiredHint')}
                    </p>
                  ) : null}
                </div>
              </section>
          ) : null}

          {activeSection === 'agentModels' ? (
              <section id="agentModels">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.agent.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-lg font-semibold">{t('settings.agent.title')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('settings.agent.description')}
                </p>
                <div className="mt-4 grid gap-2">
                  {agentRoleOptions.map((roleOption) => {
                    const roleConfig = agentModelConfig[roleOption.role];
                    const inheritedModel = midsceneConfig.modelName || t('common.notConfigured');
                    const roleFieldPrefix = `agent-${roleOption.role}`;
                    const isIndependent = roleConfig.provider === 'openaiCompatible';
                    const roleTitle = t(roleOption.titleKey);
                    const isExpanded = expandedAgentRole === roleOption.role;

                    return (
                      <div
                        className="rounded-[6px] bg-muted/70 p-3"
                        data-testid={`agent-model-role-${roleOption.role}`}
                        key={roleOption.role}
                      >
                        <div className="flex items-start gap-2.5">
                          <button
                            aria-expanded={isExpanded}
                            className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                            onClick={() => setExpandedAgentRole((current) => current === roleOption.role ? undefined : roleOption.role)}
                            type="button"
                          >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold">{roleTitle}</h3>
                              <Badge className="rounded-[4px] bg-primary/10 text-primary" variant="outline">
                                {roleConfig.enabled ? t('common.enabled') : t('common.paused')}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(roleOption.descriptionKey)}</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {isIndependent
                                ? t('settings.agent.independentModel')
                                : t('settings.agent.inheritedModel', { model: inheritedModel || t('common.notConfigured') })}
                            </p>
                          </div>
                          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Checkbox
                              checked={roleConfig.enabled}
                              onCheckedChange={(checked) =>
                                onUpdateAgentModelConfig(roleOption.role, { enabled: Boolean(checked) })
                              }
                            />
                            {t('settings.agent.roleEnabled')}
                          </label>
                        </div>

                        {isExpanded ? (
                          <div className="mt-3 border-t border-border pt-3">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                className={`rounded-[4px] px-2.5 py-1 text-xs transition ${
                                  roleConfig.provider === 'reuseMidscene'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-background text-muted-foreground hover:text-foreground'
                                }`}
                                onClick={() => onUpdateAgentModelConfig(roleOption.role, { provider: 'reuseMidscene' })}
                                type="button"
                              >
                                {t('settings.agent.reuseMidscene')}
                              </button>
                              <button
                                className={`rounded-[4px] px-2.5 py-1 text-xs transition ${
                                  isIndependent
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-background text-muted-foreground hover:text-foreground'
                                }`}
                                onClick={() => onUpdateAgentModelConfig(roleOption.role, { provider: 'openaiCompatible' })}
                                type="button"
                              >
                                {t('settings.agent.independentModel')}
                              </button>
                            </div>

                          {isIndependent ? (
                          <div className="form-grid mt-3">
                            <div className="form-field is-url">
                              <Label htmlFor={`${roleFieldPrefix}-base-url`}>{roleTitle} Base URL</Label>
                              <Input
                                id={`${roleFieldPrefix}-base-url`}
                                onChange={(event) =>
                                  onUpdateAgentModelConfig(roleOption.role, { modelBaseUrl: event.target.value })
                                }
                                placeholder="https://api.openai.com/v1"
                                value={roleConfig.modelBaseUrl}
                              />
                            </div>
                            <div className="form-field">
                              <Label htmlFor={`${roleFieldPrefix}-api-key`}>{roleTitle} API Key</Label>
                              <Input
                                id={`${roleFieldPrefix}-api-key`}
                                onChange={(event) =>
                                  onUpdateAgentModelConfig(roleOption.role, { modelApiKey: event.target.value })
                                }
                                placeholder="sk-..."
                                type="password"
                                value={roleConfig.modelApiKey}
                              />
                            </div>
                            <div className="form-field">
                              <Label htmlFor={`${roleFieldPrefix}-model-name`}>
                                {t('settings.agent.modelNameLabel', { role: roleTitle })}
                              </Label>
                              <Input
                                id={`${roleFieldPrefix}-model-name`}
                                onChange={(event) =>
                                  onUpdateAgentModelConfig(roleOption.role, { modelName: event.target.value })
                                }
                                placeholder="gpt-4.1-mini / qwen-plus / doubao-..."
                                value={roleConfig.modelName}
                              />
                            </div>
                            <div className="form-field">
                              <Label htmlFor={`${roleFieldPrefix}-model-family`}>
                                {t('settings.agent.modelFamilyLabel', { role: roleTitle })}
                              </Label>
                              <Input
                                id={`${roleFieldPrefix}-model-family`}
                                onChange={(event) =>
                                  onUpdateAgentModelConfig(roleOption.role, { modelFamily: event.target.value })
                                }
                                placeholder="openai / qwen / doubao / gemini"
                                value={roleConfig.modelFamily}
                              />
                            </div>
                            <div className="form-field is-medium">
                              <Label htmlFor={`${roleFieldPrefix}-temperature`}>{roleTitle} Temperature</Label>
                              <Input
                                id={`${roleFieldPrefix}-temperature`}
                                onChange={(event) =>
                                  onUpdateAgentModelConfig(roleOption.role, { temperature: event.target.value })
                                }
                                placeholder="0.2"
                                value={roleConfig.temperature}
                              />
                            </div>
                          </div>
                          ) : (
                          <p className="mt-3 rounded-[4px] bg-background px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
                            {t('settings.agent.inheritedModel', { model: inheritedModel || t('common.notConfigured') })}
                          </p>
                          )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
          ) : null}

          {activeSection === 'runtime' ? (
            <>
              <section id="runtime">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.runtime.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-lg font-semibold">{t('settings.runtime.title')}</h2>
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-2">
                    <Label>{t('settings.runtime.browserEngine')}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(['chromium', 'firefox', 'webkit'] as const).map((browser) => (
                        <button
                          className={`rounded-[4px] border px-2.5 py-1.5 text-xs transition ${
                            runtimeProfile.browser === browser
                              ? 'border-primary bg-primary/10 font-semibold text-primary'
                              : 'border-border bg-muted text-muted-foreground hover:border-primary/40'
                          }`}
                          key={browser}
                          onClick={() => onUpdateRuntimeProfile({ browser })}
                          type="button"
                        >
                          {browser === 'chromium' ? 'Chromium' : browser === 'firefox' ? 'Firefox' : 'WebKit'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="form-field is-medium">
                      <Label>{t('settings.runtime.viewport')}</Label>
                      <Select
                        onValueChange={(value) => onUpdateRuntimeProfile({ viewport: value as RuntimeProfile['viewport'] })}
                        value={runtimeProfile.viewport}
                      >
                        <SelectTrigger className="rounded-[4px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="desktop">{t('common.viewport.desktop')}</SelectItem>
                          <SelectItem value="laptop">{t('common.viewport.laptop')}</SelectItem>
                          <SelectItem value="mobile">{t('common.viewport.mobile')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="form-field is-medium">
                      <Label>{t('settings.runtime.locale')}</Label>
                      <Input
                        onChange={(event) => onUpdateRuntimeProfile({ locale: event.target.value })}
                        placeholder="zh-CN"
                        value={runtimeProfile.locale}
                      />
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[6px] border border-border bg-muted p-3">
                    <span>
                      <span className="block text-sm font-semibold">{t('settings.runtime.headless')}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t('settings.runtime.headlessDescription')}
                      </span>
                    </span>
                    <Checkbox
                      checked={runtimeProfile.headless}
                      onCheckedChange={(checked) => onUpdateRuntimeProfile({ headless: Boolean(checked) })}
                    />
                  </label>
                </div>
              </section>

              <section className="mt-6" id="network">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.network.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-lg font-semibold">{t('settings.network.title')}</h2>
                <div className="mt-4 rounded-[6px] border border-border bg-muted p-3">
                  <div className="form-field is-url">
                    <Label>{t('settings.network.baseUrl')}</Label>
                    <Input
                      onChange={(event) => onUpdateRuntimeProfile({ baseUrl: event.target.value })}
                      placeholder="https://your-app.example.com"
                      value={runtimeProfile.baseUrl}
                    />
                    <p className="form-hint">{t('settings.network.baseUrlHint')}</p>
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>

      <DialogFooter className="settings-dialog-footer shrink-0 border-t border-border px-3.5 py-2.5">
          <Button className="rounded-[4px]" onClick={onClose} type="button" variant="outline">
            {t('common.close')}
          </Button>
          <Button
            className="min-w-[116px] rounded-[4px]"
            disabled={showMissingRequiredState}
            onClick={onSave}
            type="button"
          >
            {saveLabel}
          </Button>
      </DialogFooter>
    </div>
  );

  return (
    <Dialog onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent
        className="settings-dialog-content flex h-[min(640px,calc(100vh-32px))] w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-[8px] border border-border bg-card p-0 shadow-[0_18px_56px_rgba(0,0,0,0.22)] sm:max-w-[760px]"
        showCloseButton={false}
      >
        {settingsShell}
      </DialogContent>
    </Dialog>
  );
}
