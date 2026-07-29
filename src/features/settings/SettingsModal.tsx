import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AgentModelConfig,
  AgentModelRole,
  AgentRoleModelConfig,
  AppearanceConfig,
  LocaleMode,
  MidsceneConfig,
  RuntimeProfile,
  ThemeMode,
} from '../../../shared/studio.js';

import { Bot, BrainCircuit, CircleHelp, Moon, MonitorCog, MousePointerClick, Palette, PlayCircle, Settings2, Sun, Waypoints, Workflow } from 'lucide-react';
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
import { PageBody, PageHeader, PageShell } from '../../components/workbench.js';

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

export type SettingsSectionId = 'appearance' | 'midscene' | 'agentModels' | 'runtime' | 'network';

const settingsSections: Array<{
  id: SettingsSectionId;
  labelKey: string;
  href: string;
  icon: typeof Palette;
}> = [
  {
    id: 'appearance',
    labelKey: 'settings.nav.appearance',
    href: '#appearance',
    icon: Palette,
  },
  {
    id: 'midscene',
    labelKey: 'settings.nav.midscene',
    href: '#midscene',
    icon: Waypoints,
  },
  {
    id: 'agentModels',
    labelKey: 'settings.nav.agentModels',
    href: '#agentModels',
    icon: BrainCircuit,
  },
  {
    id: 'runtime',
    labelKey: 'settings.nav.runtime',
    href: '#runtime',
    icon: PlayCircle,
  },
  {
    id: 'network',
    labelKey: 'settings.nav.endpoint',
    href: '#network',
    icon: Settings2,
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
  pageMode = false,
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
  onUpdateAppearance,
  onUpdateAgentModelConfig,
  onUpdateMidsceneConfig,
  onUpdateRuntimeProfile,
}: {
  open: boolean;
  pageMode?: boolean;
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
  onUpdateAppearance: (patch: Partial<AppearanceConfig>) => void;
  onUpdateAgentModelConfig: (role: AgentModelRole, patch: Partial<AgentRoleModelConfig>) => void;
  onUpdateMidsceneConfig: (patch: Partial<MidsceneConfig>) => void;
  onUpdateRuntimeProfile: (patch: Partial<RuntimeProfile>) => void;
}) {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollSpyLockedRef = useRef(false);
  const scrollSpyTargetTopRef = useRef<number | null>(null);
  const scrollSpyUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<SettingsSectionId, HTMLElement | null>>({
    appearance: null,
    midscene: null,
    agentModels: null,
    runtime: null,
    network: null,
  });
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);

  function scrollToSection(section: SettingsSectionId, behavior: ScrollBehavior = 'smooth') {
    const container = scrollContainerRef.current;
    const element = sectionRefs.current[section];
    setActiveSection(section);

    if (scrollSpyUnlockTimerRef.current) {
      clearTimeout(scrollSpyUnlockTimerRef.current);
      scrollSpyUnlockTimerRef.current = null;
    }

    if (!container || !element) {
      return;
    }

    const targetTop = section === 'appearance' ? 0 : Math.max(0, element.offsetTop - 16);
    scrollSpyLockedRef.current = behavior === 'smooth';
    scrollSpyTargetTopRef.current = behavior === 'smooth' ? targetTop : null;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        top: targetTop,
        behavior,
      });
    } else {
      container.scrollTop = targetTop;
    }

    if (behavior === 'smooth') {
      scrollSpyUnlockTimerRef.current = setTimeout(() => {
        scrollSpyLockedRef.current = false;
        scrollSpyTargetTopRef.current = null;
        setActiveSection(section);
        scrollSpyUnlockTimerRef.current = null;
      }, 700);
    } else {
      scrollSpyLockedRef.current = false;
      scrollSpyTargetTopRef.current = null;
    }
  }

  function handleScroll() {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    if (scrollSpyLockedRef.current) {
      const targetTop = scrollSpyTargetTopRef.current;
      if (targetTop !== null && Math.abs(container.scrollTop - targetTop) <= 2) {
        scrollSpyLockedRef.current = false;
        scrollSpyTargetTopRef.current = null;
      } else {
        return;
      }
    }

    const nextActive =
      settingsSections
        .map((section) => ({
          id: section.id,
          top: sectionRefs.current[section.id]?.offsetTop ?? Number.POSITIVE_INFINITY,
        }))
        .filter((section) => section.top <= container.scrollTop + 72)
        .at(-1)?.id ?? 'appearance';

    setActiveSection(nextActive);
  }

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    setActiveSection(initialSection);
    const frame = requestAnimationFrame(() => scrollToSection(initialSection, 'auto'));
    return () => {
      cancelAnimationFrame(frame);
      if (scrollSpyUnlockTimerRef.current) {
        clearTimeout(scrollSpyUnlockTimerRef.current);
        scrollSpyUnlockTimerRef.current = null;
      }
      scrollSpyLockedRef.current = false;
      scrollSpyTargetTopRef.current = null;
    };
  }, [initialSection, open, pageMode]);

  if (!open && !pageMode) {
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
      className={`rounded-[4px] px-3 py-1.5 ${
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
  const pageAction = (
    <div className="settings-page-action flex items-center gap-2">
      {statusBadge}
      <Button
        className="min-w-[132px] rounded-[4px]"
        disabled={showMissingRequiredState}
        onClick={onSave}
        type="button"
      >
        {saveLabel}
      </Button>
    </div>
  );

  const settingsShell = (
    <div className={`settings-dialog-shell flex min-h-0 w-full flex-col overflow-hidden rounded-[8px] ${pageMode ? 'settings-page-shell' : ''}`}>
      {!pageMode ? (
          <DialogHeader className="settings-dialog-topbar flex h-16 shrink-0 flex-row items-center justify-between border-b border-border px-5 py-0 text-left">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-primary/12 text-primary">
                <Settings2 className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-xl font-semibold tracking-[-0.035em]">{t('settings.title')}</DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.description')}
                </DialogDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {statusBadge}
              <DialogClose className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-border bg-card text-muted-foreground shadow-sm transition hover:border-primary/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 dark:bg-black/70">
                <span aria-hidden="true" className="text-2xl leading-none">
                  ×
                </span>
                <span className="sr-only">{t('common.close')}</span>
              </DialogClose>
            </div>
          </DialogHeader>
      ) : null}

          <div className={`flex min-h-0 flex-1 ${pageMode ? 'settings-page-workspace' : ''}`}>
            {!pageMode ? (
              <nav className="settings-dialog-aside hidden w-48 shrink-0 border-r border-border p-4 md:grid md:content-start md:gap-1">
                {settingsSections.map((section) => {
                  const NavIcon = section.icon;
                  return (
                    <button
                      className={`flex items-center gap-3 rounded-[4px] border-l-4 px-3 py-2 text-sm transition ${
                        activeSection === section.id
                          ? 'border-l-4 border-primary bg-primary/10 font-semibold text-primary'
                          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                      key={section.id}
                      onClick={() => scrollToSection(section.id)}
                      type="button"
                    >
                      <NavIcon className="h-4 w-4" />
                      {t(section.labelKey)}
                    </button>
                  );
                })}
              </nav>
            ) : null}

            <main
              className={`settings-dialog-scroll min-h-0 flex-1 space-y-10 overflow-y-auto p-6 ${pageMode ? 'settings-page-scroll' : ''}`}
              onScroll={handleScroll}
              ref={scrollContainerRef}
            >
              <section className="scroll-mt-8" id="appearance" ref={(node) => { sectionRefs.current.appearance = node; }}>
                <div className="mb-5 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.appearance.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.03em]">{t('settings.appearance.title')}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('settings.appearance.currentTheme')}：{currentThemeLabel}。{t('settings.appearance.description')}
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const title = t(option.titleKey);
                    const description = t(option.descriptionKey);
                    return (
                      <button
                        className={`grid cursor-pointer gap-3 rounded-[8px] border p-4 text-center transition ${
                          appearance.themeMode === option.mode
                            ? 'border-primary bg-primary/8 text-primary shadow-sm'
                            : 'border-border bg-card hover:border-primary/40'
                        }`}
                        key={option.mode}
                        onClick={() => onUpdateAppearance({ themeMode: option.mode })}
                        type="button"
                      >
                        <span
                          className={`flex aspect-video items-center justify-center rounded-[6px] border ${
                            option.mode === 'dark'
                              ? 'border-slate-700 bg-slate-900'
                              : option.mode === 'system'
                                ? 'border-border bg-gradient-to-br from-white to-slate-900'
                                : 'border-border bg-white'
                          }`}
                        >
                          <Icon className="h-6 w-6 text-primary" />
                        </span>
                        <span className="text-sm font-semibold">{title}</span>
                        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-6 rounded-[8px] border border-border bg-muted/60 p-4">
                  <h3 className="text-sm font-semibold">{t('settings.appearance.languageTitle')}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('settings.appearance.languageDescription')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {localeOptions.map((option) => (
                      <button
                        className={`rounded-full border px-4 py-2 text-sm transition ${
                          appearance.localeMode === option.mode
                            ? 'border-primary bg-primary/10 font-semibold text-primary'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        }`}
                        key={option.mode}
                        onClick={() => onUpdateAppearance({ localeMode: option.mode })}
                        type="button"
                      >
                        <span>{t(option.titleKey)}</span>
                        <span className="ml-2 text-xs opacity-70">{t(option.descriptionKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="scroll-mt-8" id="midscene" ref={(node) => { sectionRefs.current.midscene = node; }}>
                <div className="mb-5 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.midscene.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.03em]">{t('settings.midscene.title')}</h2>
                <div className="mt-5 grid gap-5">
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
                <div className="mt-6 rounded-[8px] border border-border bg-muted p-4">
                  <h3 className="text-sm font-semibold">{t('settings.midscene.unlockedTitle')}</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {[
                      [Bot, t('settings.midscene.feature.nl'), t('settings.midscene.feature.nlDescription')],
                      [Workflow, t('settings.midscene.feature.workflow'), t('settings.midscene.feature.workflowDescription')],
                      [MousePointerClick, t('settings.midscene.feature.recording'), t('settings.midscene.feature.recordingDescription')],
                    ].map(([Icon, title, description]) => {
                      const FeatureIcon = Icon as typeof Bot;
                      return (
                        <div className="rounded-[6px] border border-border bg-card p-3" key={title as string}>
                          <FeatureIcon className="h-4 w-4 text-primary" />
                          <p className="mt-3 text-sm font-semibold">{title as string}</p>
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

              <section className="scroll-mt-8" id="agentModels" ref={(node) => { sectionRefs.current.agentModels = node; }}>
                <div className="mb-5 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.agent.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.03em]">{t('settings.agent.title')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('settings.agent.description')}
                </p>
                <div className="mt-5 grid gap-3">
                  {agentRoleOptions.map((roleOption) => {
                    const roleConfig = agentModelConfig[roleOption.role];
                    const inheritedModel = midsceneConfig.modelName || t('common.notConfigured');
                    const roleFieldPrefix = `agent-${roleOption.role}`;
                    const isIndependent = roleConfig.provider === 'openaiCompatible';
                    const roleTitle = t(roleOption.titleKey);

                    return (
                      <div
                        className="rounded-[8px] bg-muted/70 p-4"
                        data-testid={`agent-model-role-${roleOption.role}`}
                        key={roleOption.role}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-[220px] flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-semibold tracking-[-0.025em]">{roleTitle}</h3>
                              <Badge className="rounded-[4px] bg-primary/10 text-primary" variant="outline">
                                {roleConfig.enabled ? t('common.enabled') : t('common.paused')}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(roleOption.descriptionKey)}</p>
                          </div>
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

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className={`rounded-full px-3 py-1.5 text-xs transition ${
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
                            className={`rounded-full px-3 py-1.5 text-xs transition ${
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
                          <div className="form-grid mt-4">
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
                          <p className="mt-4 rounded-[6px] bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
                            {t('settings.agent.inheritedModel', { model: inheritedModel || t('common.notConfigured') })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="scroll-mt-8" id="runtime" ref={(node) => { sectionRefs.current.runtime = node; }}>
                <div className="mb-5 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.runtime.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.03em]">{t('settings.runtime.title')}</h2>
                <div className="mt-5 grid gap-6">
                  <div className="grid gap-3">
                    <Label>{t('settings.runtime.browserEngine')}</Label>
                    <div className="flex flex-wrap gap-2">
                      {(['chromium', 'firefox', 'webkit'] as const).map((browser) => (
                        <button
                          className={`rounded-full border px-4 py-2 text-sm transition ${
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
                  <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[8px] border border-border bg-muted p-4">
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

              <section className="scroll-mt-8" id="network" ref={(node) => { sectionRefs.current.network = node; }}>
                <div className="mb-5 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    {t('settings.network.section')}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.03em]">{t('settings.network.title')}</h2>
                <div className="mt-5 rounded-[8px] border border-border bg-muted p-5">
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
                {!midsceneReady ? (
                  <div className="mt-5 rounded-[8px] border border-destructive/30 bg-destructive/8 p-4">
                    <p className="text-sm leading-7 text-muted-foreground">
                      {t('settings.midscene.requiredHint')}
                    </p>
                  </div>
                ) : null}
              </section>
            </main>
          </div>

      {!pageMode ? (
        <DialogFooter className="settings-dialog-footer shrink-0 border-t border-border px-5 py-4">
          <Button className="rounded-[4px]" onClick={onClose} type="button" variant="outline">
            {t('common.skip')}
          </Button>
          <Button
            className="min-w-[132px] rounded-[4px]"
            disabled={showMissingRequiredState}
            onClick={onSave}
            type="button"
          >
            {saveLabel}
          </Button>
        </DialogFooter>
      ) : null}
    </div>
  );

  if (pageMode) {
    return (
      <PageShell>
        <PageHeader
          action={pageAction}
          title={t('settings.title')}
        />
        <PageBody className="settings-page-body">
          {settingsShell}
        </PageBody>
      </PageShell>
    );
  }

  return (
    <Dialog onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent
        className="settings-dialog-content flex max-h-[min(920px,calc(100vh-48px))] w-[min(960px,calc(100vw-48px))] overflow-hidden rounded-[8px] border border-border bg-card p-0 shadow-[0_18px_56px_rgba(0,0,0,0.22)]"
        showCloseButton={false}
      >
        {settingsShell}
      </DialogContent>
    </Dialog>
  );
}
