export type SupportedLocale = 'zh-CN' | 'en-US';
export type LocaleMode = SupportedLocale | 'system';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { enUS } from './locales/en-US.js';
import { zhCN } from './locales/zh-CN.js';

export { enUS, zhCN };

type MessageKey =
  | 'app.brand.subtitle'
  | 'app.nav.main'
  | 'app.nav.mobileMain'
  | 'app.nav.overview'
  | 'app.nav.projects'
  | 'app.nav.documents'
  | 'app.nav.cases'
  | 'app.nav.suites'
  | 'app.nav.runs'
  | 'app.nav.maintenance'
  | 'maintenance.kicker'
  | 'maintenance.title'
  | 'maintenance.count'
  | 'maintenance.empty'
  | 'maintenance.diff.source'
  | 'maintenance.diff.candidate'
  | 'maintenance.impact'
  | 'maintenance.none'
  | 'maintenance.evidence'
  | 'maintenance.evidence.open'
  | 'maintenance.audit'
  | 'maintenance.audit.created'
  | 'maintenance.audit.accepted'
  | 'maintenance.audit.rejected'
  | 'maintenance.audit.stale'
  | 'maintenance.confirmRevision'
  | 'maintenance.approve'
  | 'maintenance.reject'
  | 'maintenance.reject.rationale'
  | 'maintenance.status.draft'
  | 'maintenance.status.accepted'
  | 'maintenance.status.rejected'
  | 'maintenance.status.stale'
  | 'maintenance.outcome.stale'
  | 'maintenance.error.action'
  | 'app.nav.naturalLanguage'
  | 'app.nav.workflow'
  | 'app.nav.recording'
  | 'app.nav.settings'
  | 'app.shell.searchPlaceholder'
  | 'app.shell.connectDevice'
  | 'app.shell.projectSettings'
  | 'app.shell.openSettings'
  | 'app.shell.noProject'
  | 'app.storageError.title'
  | 'app.storageError.description'
  | 'app.confirm.deleteTitle'
  | 'app.confirm.cancel'
  | 'app.confirm.deleteAction'
  | 'common.close'
  | 'common.notConfigured'
  | 'common.saveAndContinue'
  | 'common.saveSettings'
  | 'common.skip'
  | 'common.enabled'
  | 'common.paused'
  | 'settings.title'
  | 'settings.description'
  | 'settings.status.ready'
  | 'settings.status.missingRequired'
  | 'settings.status.midsceneOptional'
  | 'settings.nav.general'
  | 'settings.nav.appearance'
  | 'settings.nav.midscene'
  | 'settings.nav.agentModels'
  | 'settings.nav.execution'
  | 'settings.nav.runtime'
  | 'settings.nav.endpoint'
  | 'settings.appearance.title'
  | 'settings.appearance.description'
  | 'settings.appearance.currentTheme'
  | 'settings.appearance.languageTitle'
  | 'settings.appearance.languageDescription'
  | 'settings.theme.light'
  | 'settings.theme.lightDescription'
  | 'settings.theme.dark'
  | 'settings.theme.darkDescription'
  | 'settings.theme.system'
  | 'settings.theme.systemDescription'
  | 'settings.language.zh'
  | 'settings.language.zhDescription'
  | 'settings.language.en'
  | 'settings.language.enDescription'
  | 'settings.language.system'
  | 'settings.language.systemDescription'
  | 'settings.midscene.title'
  | 'settings.modelSecret.save'
  | 'settings.modelSecret.replace'
  | 'settings.modelSecret.clear'
  | 'settings.modelSecret.stored'
  | 'settings.midscene.baseUrlHint'
  | 'settings.midscene.familyHint'
  | 'settings.midscene.contextLabel'
  | 'settings.midscene.contextPlaceholder'
  | 'settings.midscene.connectionTitle'
  | 'settings.midscene.connectionTest'
  | 'settings.midscene.connectionTesting'
  | 'settings.midscene.connectionPassed'
  | 'settings.midscene.connectionConfiguration'
  | 'settings.midscene.connectionHttp'
  | 'settings.midscene.connectionNetwork'
  | 'settings.midscene.connectionResponse'
  | 'settings.agent.title'
  | 'settings.agent.description'
  | 'settings.agent.planner'
  | 'settings.agent.plannerDescription'
  | 'settings.agent.executor'
  | 'settings.agent.executorDescription'
  | 'settings.agent.verifier'
  | 'settings.agent.verifierDescription'
  | 'settings.agent.reporter'
  | 'settings.agent.reporterDescription'
  | 'settings.agent.roleEnabled'
  | 'settings.agent.reuseMidscene'
  | 'settings.agent.independentModel'
  | 'settings.agent.inheritedModel'
  | 'settings.runtime.title'
  | 'settings.runtime.browserEngine'
  | 'settings.runtime.viewport'
  | 'settings.runtime.locale'
  | 'settings.runtime.headless'
  | 'settings.runtime.headlessDescription'
  | 'settings.network.section'
  | 'settings.network.title'
  | 'settings.network.baseUrl'
  | 'settings.network.baseUrlHint'
  | 'startup.aria.screen'
  | 'startup.aria.steps'
  | 'startup.aria.midsceneQuickConfig'
  | 'startup.step.configureMidscene'
  | 'startup.step.enterWorkbench'
  | 'startup.step.startTesting'
  | 'startup.step.done'
  | 'startup.step.current'
  | 'startup.step.waiting'
  | 'startup.step.ready'
  | 'startup.kicker'
  | 'startup.title'
  | 'startup.description'
  | 'startup.brand.welcome'
  | 'startup.brand.description'
  | 'startup.brand.metric.accuracy'
  | 'startup.brand.metric.setup'
  | 'startup.brand.metric.autonomous'
  | 'startup.capabilities.title'
  | 'startup.securityNote'
  | 'startup.feature.prd'
  | 'startup.feature.prdDescription'
  | 'startup.feature.nl'
  | 'startup.feature.nlDescription'
  | 'startup.feature.recording'
  | 'startup.feature.recordingDescription'
  | 'startup.midscene.section'
  | 'startup.midscene.title'
  | 'startup.midscene.description'
  | 'startup.midscene.state.ready'
  | 'startup.midscene.contextLabel'
  | 'startup.midscene.contextPlaceholder'
  | 'startup.midscene.save'
  | 'startup.midscene.skip'
  | 'startup.midscene.note'
  | 'startup.footer.ready'
  | 'startup.footer.guide'
  | 'cases.binding.title'
  | 'cases.binding.credential'
  | 'cases.binding.chooseCredential'
  | 'cases.binding.field'
  | 'cases.binding.chooseField'
  | 'cases.binding.username'
  | 'cases.binding.secret'
  | 'cases.binding.clear'
  | 'cases.binding.noCredentials'
  | 'cases.binding.fixtureOutput'
  | 'cases.binding.chooseFixtureOutput'
  | 'cases.binding.noFixtureOutputs'
  | 'cases.intent.businessGoal'
  | 'cases.intent.preconditions'
  | 'cases.intent.successCriteria'
  | 'cases.intent.defaultBusinessGoal';

export type Messages = Partial<Record<string, string>>;

const dictionaries: Record<SupportedLocale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export const resolveLocale = (mode: LocaleMode, systemLanguage = 'zh-CN'): SupportedLocale => {
  if (mode !== 'system') {
    return mode;
  }

  return systemLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
};

export const createTranslator = (locale: SupportedLocale) => {
  return (key: MessageKey | string, replacements: Record<string, string | number> = {}): string => {
    const message = dictionaries[locale][key as MessageKey] ?? zhCN[key as MessageKey] ?? key;
    return Object.entries(replacements).reduce(
      (nextMessage, [name, value]) => nextMessage.replaceAll(`{${name}}`, String(value)),
      message,
    );
  };
};

type I18nContextValue = {
  locale: SupportedLocale;
  t: ReturnType<typeof createTranslator>;
};

const defaultI18nValue: I18nContextValue = {
  locale: 'zh-CN',
  t: createTranslator('zh-CN'),
};

const I18nContext = createContext<I18nContextValue>(defaultI18nValue);

export const I18nProvider = ({ children, locale }: { children: ReactNode; locale: SupportedLocale }) => {
  return createElement(I18nContext.Provider, { value: { locale, t: createTranslator(locale) } }, children);
};

export const useI18n = (): I18nContextValue => useContext(I18nContext);
