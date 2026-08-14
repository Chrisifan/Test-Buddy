import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ClipboardList,
  FileText,
  FolderKanban,
  House,
  Layers3,
  MessageSquareText,
  MousePointerClick,
  PlaySquare,
  Search,
  Settings2,
  Trash2,
  Workflow,
} from 'lucide-react';

import testbuddyHammerBot from './assets/testbuddy-hammer-bot.png';
import testbuddyHammerBotDark from './assets/testbuddy-hammer-bot-dark.png';

import {
  createEmptyGroup,
  createEmptyProject,
  createEmptyRecordingAsset,
  createEmptyTestCase,
  createTestCaseFromAgentRun,
  createReporterFixDraft,
  createInitialStudioState,
  createPrdDocumentAsset,
  createRecordingStep,
  createRecordingFromGeneratedPath,
  copyTestStep,
  createNextTestCaseVersion,
  createTestStep,
  createTestCaseFromRecording,
  createTestCaseFromGeneratedPath,
  detachRecordingFromTestCases,
  findTestCaseVersion,
  findDefaultRecordingForCaseStep,
  getTestCasePrdPath,
  getTestCaseRunBlocker,
  isRecordingLinkedToGeneratedPath,
  isTestCaseLinkedToGeneratedPath,
  initialRunLog,
  insertTestStep,
  isMidsceneConfigured,
  moveTestStep,
  listLatestTestCaseVersions,
  prunePrdCoverageTriage,
  removeTestStep,
  testCaseToWorkflow,
  type AgentModelConfig,
  type AgentModelRole,
  type AgentRoleModelConfig,
  type RecordingAsset,
  type BrowserSessionState,
  type ChatEntry,
  type CommandMode,
  type CredentialRef,
  type MidsceneConfig,
  type AppearanceConfig,
  type PrdDocumentKind,
  type PrdCoverageTarget,
  type PrdCoverageTriageDecisionStatus,
  type ProjectAssetBinding,
  type ProjectAssetReloadResult,
  type RecordingCapturedEvent,
  type ProjectDraft,
  type RuntimeInfo,
  type RuntimeProfile,
  type RunArtifact,
  type RunDetail,
  type RunSummary,
  type RunTone,
  type SuiteAsset,
  type SuiteRunDetail,
  type VersionedTestAssetReference,
  type StartupGuideState,
  type StudioState,
  type TestCaseDraft,
  type TestCaseRunBlocker,
  type TestStepDraft,
  type WorkflowDraft,
  updatePrdDocumentAnalysis,
} from '../shared/studio.js';
import type { AgentReporterSummary, AgentRunResult } from '../shared/agent.js';
import type { AppPage } from './app/pageMeta.js';
import { NavButton } from './components/NavButton.js';
import { StatusPill } from './components/StatusPill.js';
import { Button } from './components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog.js';
import { HomePage } from './features/home/HomePage.js';
import type { SettingsSectionId } from './features/settings/SettingsModal.js';
import { StartupPage } from './features/startup/StartupPage.js';
import { createTranslator, I18nProvider, resolveLocale } from './i18n';
import { getRuntimeInfo, loadStudioState, saveStudioState } from './lib/persistence';
import { formatRunDuration } from './lib/duration.js';
import {
  attachManualEvidence,
  analyzePrdDocument,
  captureBrowserSnapshot,
  cancelRun,
  endSession,
  exportProjectReport,
  navigateBrowserSession,
  onRunEvent,
  onRecordingEvent,
  runRecording,
  runSuite,
  runTestCase,
  runWorkflow,
  saveCredential,
  sendChatCommand,
  startBrowserSession,
  startSession,
  testMidsceneConnection,
} from './lib/runtime';

const initialState = createInitialStudioState();
const PAGE_EXIT_DURATION_MS = 120;
const SAVE_DEBOUNCE_MS = 350;
const initialTranslator = createTranslator(resolveLocale(initialState.appearance.localeMode));
const ProjectManagementPage = lazy(() =>
  import('./features/project/ProjectManagementPage.js').then(({ ProjectManagementPage: Page }) => ({ default: Page })),
);
const DocumentAnalysisPage = lazy(() =>
  import('./features/documents/DocumentAnalysisPage.js').then(({ DocumentAnalysisPage: Page }) => ({ default: Page })),
);
const TestCaseManagementPage = lazy(() =>
  import('./features/cases/TestCaseManagementPage.js').then(({ TestCaseManagementPage: Page }) => ({ default: Page })),
);
const SuiteManagementPage = lazy(() =>
  import('./features/suites/SuiteManagementPage.js').then(({ SuiteManagementPage: Page }) => ({ default: Page })),
);
const RunRecordsPage = lazy(() =>
  import('./features/runs/RunRecordsPage.js').then(({ RunRecordsPage: Page }) => ({ default: Page })),
);
const NaturalLanguagePage = lazy(() =>
  import('./features/natural-language/NaturalLanguagePage.js').then(({ NaturalLanguagePage: Page }) => ({ default: Page })),
);
const WorkflowPage = lazy(() =>
  import('./features/workflow/WorkflowPage.js').then(({ WorkflowPage: Page }) => ({ default: Page })),
);
const RecordingPage = lazy(() =>
  import('./features/recording/RecordingPage.js').then(({ RecordingPage: Page }) => ({ default: Page })),
);
const SettingsModal = lazy(() =>
  import('./features/settings/SettingsModal.js').then(({ SettingsModal: Modal }) => ({ default: Modal })),
);

type SaveMode = 'debounced' | 'immediate';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type PendingDeletion =
  | { kind: 'project'; id: string; description: string }
  | { kind: 'group'; id: string; description: string }
  | { kind: 'recording'; id: string; description: string };

function latestSuiteReference(project: ProjectDraft | undefined): VersionedTestAssetReference | undefined {
  const latestSuite = [...(project?.suites ?? [])]
    .sort((left, right) => right.version - left.version || left.id.localeCompare(right.id))[0];
  return latestSuite ? { id: latestSuite.id, version: latestSuite.version } : undefined;
}

function latestTestCaseReference(project: ProjectDraft | undefined, id?: string): VersionedTestAssetReference | undefined {
  const latest = listLatestTestCaseVersions(project ?? { testCases: [] })
    .find((testCase) => !id || testCase.id === id);
  return latest ? { id: latest.id, version: latest.version ?? 1 } : undefined;
}

function RouteLoadingPlaceholder() {
  return <div aria-busy="true" className="h-full min-h-0 animate-pulse rounded-[var(--panel-radius)] bg-muted/30" />;
}

function createTimestampLabel(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

function isGatedFeaturePage(page: AppPage): page is 'nl' | 'workflow' | 'recording' {
  return page === 'nl' || page === 'workflow' || page === 'recording';
}

export function App() {
  const [activePage, setActivePage] = useState<AppPage>('home');
  const [isPageExiting, setIsPageExiting] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({
    platform: 'browser',
    persistence: 'localStorage',
  });
  const [projects, setProjects] = useState<ProjectDraft[]>(initialState.projects);
  const [projectAssetBindings, setProjectAssetBindings] = useState<ProjectAssetBinding[]>(initialState.projectAssetBindings);
  const [selectedProjectId, setSelectedProjectId] = useState(initialState.selectedProjectId);
  const [selectedGroupId, setSelectedGroupId] = useState(initialState.selectedGroupId);
  const [selectedTestCaseReference, setSelectedTestCaseReference] = useState<VersionedTestAssetReference | undefined>(
    () => initialState.selectedTestCaseReference ?? latestTestCaseReference(initialState.projects[0], initialState.selectedTestCaseId),
  );
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>();
  const [selectedRecordingId, setSelectedRecordingId] = useState(initialState.selectedRecordingId);
  const [selectedSuiteReference, setSelectedSuiteReference] = useState<VersionedTestAssetReference | undefined>(
    () => latestSuiteReference(initialState.projects[0]),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    initialState.projects[0]?.documents[0]?.id ?? '',
  );
  const [runDetails, setRunDetails] = useState<RunDetail[]>(initialState.runDetails);
  const [selectedRunId, setSelectedRunId] = useState(initialState.recentRuns[0]?.id ?? '');
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>(initialState.recentRuns);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>(initialState.chatEntries);
  const [runtimeProfile, setRuntimeProfile] = useState<RuntimeProfile>(initialState.runtimeProfile);
  const [midsceneConfig, setMidsceneConfig] = useState<MidsceneConfig>(initialState.midsceneConfig);
  const [agentModelConfig, setAgentModelConfig] = useState<AgentModelConfig>(initialState.agentModelConfig);
  const [appearance, setAppearance] = useState<AppearanceConfig>(initialState.appearance);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [systemLanguage, setSystemLanguage] = useState('zh-CN');
  const [browserSession, setBrowserSession] = useState<BrowserSessionState>(initialState.browserSession);
  const [commandMode, setCommandMode] = useState<CommandMode>('ai');
  const [targetEnvironment, setTargetEnvironment] = useState('staging');
  const [chatInput, setChatInput] = useState(initialTranslator('app.runtime.defaultPrompt'));
  const [sessionActive, setSessionActive] = useState(false);
  const [deepThink, setDeepThink] = useState(true);
  const [deepLocate, setDeepLocate] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeSuiteRunId, setActiveSuiteRunId] = useState<string>();
  const [lastSuiteRun, setLastSuiteRun] = useState<SuiteRunDetail>();
  const [isBrowserBusy, setIsBrowserBusy] = useState(false);
  const [semanticAnalyzingDocumentId, setSemanticAnalyzingDocumentId] = useState<string | null>(null);
  const [semanticAnalysisError, setSemanticAnalysisError] = useState<{
    documentId: string;
    message: string;
  } | null>(null);
  const [navigateUrl, setNavigateUrl] = useState(initialState.projects[0]?.defaultUrl ?? '');
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('appearance');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [startupGuide, setStartupGuide] = useState<StartupGuideState>(initialState.startupGuide);
  const [pendingPage, setPendingPage] = useState<AppPage | null>(null);
  const [runStatus, setRunStatus] = useState<RunTone>('neutral');
  const [runTitle, setRunTitle] = useState(initialTranslator('app.runtime.notRun'));
  const [runId, setRunId] = useState('run-draft');
  const [runLogs, setRunLogs] = useState(initialRunLog);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [storageLoadError, setStorageLoadError] = useState(false);
  const pageTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRecordingIdRef = useRef(selectedRecordingId);
  const pendingTestCaseRunContextRef = useRef<{
    projectId: string;
    testCaseId: string;
    documentId?: string;
    environmentId: string;
    environmentName: string;
  } | null>(null);
  const activeSuiteRunIdRef = useRef<string | undefined>(undefined);
  const previousLocaleRef = useRef(resolveLocale(initialState.appearance.localeMode));
  const latestStudioStateRef = useRef<StudioState | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVersionRef = useRef(0);
  const nextSaveModeRef = useRef<SaveMode>('debounced');

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedEnvironment =
    selectedProject?.environments.find((environment) => environment.id === selectedProject.selectedEnvironmentId) ??
    selectedProject?.environments[0];
  const selectedGroup =
    selectedProject?.groups.find((group) => group.id === selectedGroupId) ?? selectedProject?.groups[0];
  const selectedTestCaseId = selectedTestCaseReference?.id ?? '';
  const selectedTestCase =
    selectedProject && selectedTestCaseReference
      ? findTestCaseVersion(selectedProject, selectedTestCaseReference)
      : undefined;
  const selectedCaseEnvironment =
    selectedProject?.environments.find((environment) => environment.id === selectedTestCase?.environmentId) ??
    selectedEnvironment;
  const selectedTestCaseRunBlocker: TestCaseRunBlocker | undefined =
    selectedProject && selectedTestCase
      ? getTestCaseRunBlocker(selectedTestCase, selectedProject.recordings)
      : undefined;
  const selectedRecording =
    selectedProject?.recordings.find((recording) => recording.id === selectedRecordingId) ??
    selectedProject?.recordings[0];
  const workflows = selectedProject?.testCases.map(testCaseToWorkflow) ?? [];
  const selectedWorkflow = selectedTestCase ? testCaseToWorkflow(selectedTestCase) : workflows[0];
  const recentChatEntries = chatEntries.slice(-6);
  const latestNaturalLanguageAgentRun = runDetails.find(
    (detail) =>
      detail.agentRun?.intent.source === 'naturalLanguage' &&
      detail.agentRun.intent.projectId === selectedProject?.id,
  )?.agentRun;
  const midsceneReady = isMidsceneConfigured(midsceneConfig);
  const effectiveTheme =
    appearance.themeMode === 'system'
      ? systemPrefersDark
        ? 'dark'
        : 'light'
      : appearance.themeMode;
  const brandLogo = effectiveTheme === 'dark' ? testbuddyHammerBotDark : testbuddyHammerBot;
  const effectiveLocale = resolveLocale(appearance.localeMode, systemLanguage);
  const t = createTranslator(effectiveLocale);

  function persistLatestStudioState(mode: SaveMode) {
    if (storageLoadError || !latestStudioStateRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const version = ++saveVersionRef.current;
    const save = async () => {
      setSaveStatus('saving');
      try {
        await saveStudioState(latestStudioStateRef.current!);
        if (version !== saveVersionRef.current) {
          return;
        }

        setSaveStatus('saved');
        if (clearSavedTimerRef.current) {
          clearTimeout(clearSavedTimerRef.current);
        }
        clearSavedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1600);
      } catch {
        if (version === saveVersionRef.current) {
          setSaveStatus('error');
        }
      }
    };

    if (mode === 'immediate') {
      void save();
    } else {
      saveTimerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    }
  }

  useEffect(() => {
    const previousLocale = previousLocaleRef.current;
    if (previousLocale === effectiveLocale) {
      return;
    }

    const previousTranslator = createTranslator(previousLocale);
    setChatInput((current) => current === previousTranslator('app.runtime.defaultPrompt') ? t('app.runtime.defaultPrompt') : current);
    setRunTitle((current) => current === previousTranslator('app.runtime.notRun') ? t('app.runtime.notRun') : current);
    previousLocaleRef.current = effectiveLocale;
  }, [effectiveLocale, t]);
  useEffect(() => {
    void (async () => {
      try {
        const [state, runtime] = await Promise.all([loadStudioState(), getRuntimeInfo()]);
        setRuntimeInfo(runtime);
        setProjects(state.projects);
        setProjectAssetBindings(state.projectAssetBindings);
        setSelectedProjectId(state.selectedProjectId);
        setSelectedGroupId(state.selectedGroupId);
        setSelectedTestCaseReference(
          state.selectedTestCaseReference ?? latestTestCaseReference(
            state.projects.find((project) => project.id === state.selectedProjectId),
            state.selectedTestCaseId,
          ),
        );
        setCaseDraft(undefined);
        setSelectedRecordingId(state.selectedRecordingId);
        const hydratedProject = state.projects.find((project) => project.id === state.selectedProjectId);
        setSelectedSuiteReference(latestSuiteReference(hydratedProject));
        setSelectedDocumentId(hydratedProject?.documents[0]?.id ?? '');
        setRunDetails(state.runDetails);
        setRecentRuns(state.recentRuns);
        setSelectedRunId(state.recentRuns[0]?.id ?? '');
        setChatEntries(state.chatEntries);
        setRuntimeProfile(state.runtimeProfile);
        setMidsceneConfig(state.midsceneConfig);
        setAgentModelConfig(state.agentModelConfig);
        setAppearance(state.appearance);
        setStartupGuide(state.startupGuide);
        setBrowserSession(state.browserSession);
        setNavigateUrl(hydratedProject?.defaultUrl ?? state.runtimeProfile.baseUrl);
      } catch {
        setStorageLoadError(true);
      }
      setIsHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setSystemLanguage(window.navigator.language || 'zh-CN');
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark');
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.lang = effectiveLocale;
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      favicon.href = `./testbuddy-icon-${effectiveTheme}.png`;
    }
  }, [effectiveLocale, effectiveTheme]);

  useEffect(() => {
    if (!isHydrated || storageLoadError) {
      return;
    }

    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    const payload: StudioState = {
      selectedProjectId,
      selectedGroupId,
      selectedTestCaseReference,
      selectedRecordingId,
      projects,
      projectAssetBindings,
      runDetails,
      recentRuns,
      chatEntries,
      runtimeProfile,
      midsceneConfig,
      agentModelConfig,
      appearance,
      startupGuide,
      browserSession,
      selectedWorkflowId: selectedTestCaseId,
      workflows: selectedProject?.testCases.map(testCaseToWorkflow) ?? [],
    };

    latestStudioStateRef.current = payload;
    const saveMode = nextSaveModeRef.current;
    nextSaveModeRef.current = 'debounced';
    persistLatestStudioState(saveMode);
  }, [
    browserSession,
    chatEntries,
    appearance,
    agentModelConfig,
    isHydrated,
    midsceneConfig,
    projects,
    projectAssetBindings,
    recentRuns,
    runDetails,
    runtimeProfile,
    selectedGroupId,
    selectedProjectId,
    selectedTestCaseReference,
    selectedTestCaseId,
    selectedRecordingId,
    storageLoadError,
    startupGuide,
  ]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (clearSavedTimerRef.current) {
        clearTimeout(clearSavedTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    selectedRecordingIdRef.current = selectedRecordingId;
  }, [selectedRecordingId]);

  useEffect(() => {
    const unsubscribe = onRunEvent((event) => {
      if (activeSuiteRunIdRef.current && event.runId.startsWith(`${activeSuiteRunIdRef.current}-`)) {
        const line = event.line;
        if (event.type === 'log' && line) {
          setRunLogs((current) => [...current, line]);
        }
        return;
      }
      if (event.type === 'status') {
        const runContext = pendingTestCaseRunContextRef.current;
        const summary = event.summary;
        setIsRunning(event.status === 'running');
        setRunId(event.runId);
        setRunTitle(event.title);
        if (event.status) {
          setRunStatus(event.status);
        }
        if (summary) {
          setRecentRuns((current) => [
            {
              id: event.runId,
              name: event.title,
              status: event.status ?? 'running',
              duration: event.duration ?? '00:00:00',
              summary,
              projectId: runContext?.projectId ?? selectedProjectId,
              testCaseId: runContext?.testCaseId ?? selectedTestCaseId,
              ...(runContext?.documentId ? { documentId: runContext.documentId } : {}),
              environmentId: runContext?.environmentId ?? selectedEnvironment?.id,
              environmentName: runContext?.environmentName ?? selectedEnvironment?.name,
              startedAt: new Date().toISOString(),
            },
            ...current.filter((run) => run.id !== event.runId),
          ]);
        }
      }

      if (event.type === 'log' && event.line) {
        setRunLogs((current) => [...current, event.line as string]);
      }

      if (event.type === 'complete') {
        setIsRunning(false);
        if (event.status) {
          setRunStatus(event.status);
        }
        if (event.detail) {
          setRunDetails((current) => [event.detail as RunDetail, ...current.filter((run) => run.id !== event.runId)]);
          setSelectedRunId(event.runId);
        }
        setRecentRuns((current) =>
          current.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  status: event.status ?? run.status,
                  duration: event.duration ?? run.duration,
                  summary: event.summary ?? run.summary,
                }
              : run,
          ),
        );
      }
    });

    return unsubscribe;
  }, [selectedEnvironment?.id, selectedEnvironment?.name, selectedProjectId, selectedTestCaseId]);

  useEffect(() => {
    return () => {
      if (pageTransitionTimer.current) {
        clearTimeout(pageTransitionTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onRecordingEvent((event) => {
      appendCapturedRecordingStep(event);
    });
    return unsubscribe;
  }, [selectedRecordingId]);

  function switchPage(page: AppPage) {
    if (page === activePage) {
      return;
    }

    if (pageTransitionTimer.current) {
      clearTimeout(pageTransitionTimer.current);
      pageTransitionTimer.current = null;
    }

    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setIsPageExiting(false);
      setActivePage(page);
      return;
    }

    setIsPageExiting(true);
    pageTransitionTimer.current = setTimeout(() => {
      setActivePage(page);
      setIsPageExiting(false);
      pageTransitionTimer.current = null;
    }, PAGE_EXIT_DURATION_MS);
  }

  function updateRuntimeProfile(patch: Partial<RuntimeProfile>) {
    const nextRuntimeProfile = {
      ...(latestStudioStateRef.current?.runtimeProfile ?? runtimeProfile),
      ...patch,
    };
    if (latestStudioStateRef.current) {
      latestStudioStateRef.current = {
        ...latestStudioStateRef.current,
        runtimeProfile: nextRuntimeProfile,
      };
    }
    setRuntimeProfile((current) => ({
      ...current,
      ...patch,
    }));
  }

  function updateMidsceneConfig(patch: Partial<MidsceneConfig>) {
    const nextMidsceneConfig = {
      ...(latestStudioStateRef.current?.midsceneConfig ?? midsceneConfig),
      ...patch,
    };
    if (latestStudioStateRef.current) {
      latestStudioStateRef.current = {
        ...latestStudioStateRef.current,
        midsceneConfig: nextMidsceneConfig,
      };
    }
    setMidsceneConfig((current) => ({
      ...current,
      ...patch,
    }));
  }

  function updateAgentModelConfig(role: AgentModelRole, patch: Partial<AgentRoleModelConfig>) {
    const currentAgentModelConfig = latestStudioStateRef.current?.agentModelConfig ?? agentModelConfig;
    const nextAgentModelConfig = {
      ...currentAgentModelConfig,
      [role]: {
        ...currentAgentModelConfig[role],
        ...patch,
      },
    };
    if (latestStudioStateRef.current) {
      latestStudioStateRef.current = {
        ...latestStudioStateRef.current,
        agentModelConfig: nextAgentModelConfig,
      };
    }
    setAgentModelConfig((current) => ({
      ...current,
      [role]: {
        ...current[role],
        ...patch,
      },
    }));
  }

  function updateAppearance(patch: Partial<AppearanceConfig>) {
    const nextAppearance = {
      ...(latestStudioStateRef.current?.appearance ?? appearance),
      ...patch,
    };
    if (latestStudioStateRef.current) {
      latestStudioStateRef.current = {
        ...latestStudioStateRef.current,
        appearance: nextAppearance,
      };
    }
    setAppearance((current) => ({
      ...current,
      ...patch,
    }));
  }

  function completeStartupGuide(mode: 'configured' | 'skipped') {
    setStartupGuide({
      completed: true,
      completedAt: new Date().toISOString(),
      mode,
    });
  }

  function updateSelectedProject(
    updater: (project: ProjectDraft) => ProjectDraft,
    saveMode: SaveMode = 'debounced',
  ) {
    if (!selectedProject) {
      return;
    }

    nextSaveModeRef.current = saveMode;

    setProjects((current) =>
      current.map((project) =>
        project.id === selectedProject.id
          ? (() => {
              const updatedProject = updater(project);
              return {
                ...updatedProject,
                prdCoverageTriage: prunePrdCoverageTriage(
                  updatedProject.documents,
                  updatedProject.prdCoverageTriage,
                ),
                updatedAt: new Date().toISOString(),
              };
            })()
          : project,
      ),
    );
  }

  function updateSelectedTestCase(
    updater: (testCase: TestCaseDraft) => TestCaseDraft,
    _saveMode: SaveMode = 'debounced',
  ) {
    if (!caseDraft) {
      return;
    }

    const preview = updater(caseDraft);
    if (preview.groupId !== caseDraft.groupId) {
      setSelectedGroupId(preview.groupId);
    }
    setCaseDraft((current) => current ? updater(current) : current);
  }

  function handleEditCaseVersion() {
    if (!selectedTestCase) {
      return;
    }
    setCaseDraft(structuredClone(selectedTestCase));
  }

  function handleDiscardCaseDraft() {
    setCaseDraft(undefined);
  }

  function handlePublishCase() {
    if (!selectedProject || !selectedTestCase || !caseDraft) {
      return;
    }
    const { id: _id, version: _version, ...patch } = caseDraft;
    const nextCase = createNextTestCaseVersion(selectedProject, selectedTestCase, {
      ...patch,
      lastEdited: t('app.runtime.justNow'),
    });
    updateSelectedProject((project) => ({
      ...project,
      testCases: [...project.testCases, nextCase],
    }), 'immediate');
    setSelectedTestCaseReference({ id: nextCase.id, version: nextCase.version ?? 1 });
    setSelectedGroupId(nextCase.groupId);
    setCaseDraft(undefined);
  }

  function updateSelectedWorkflow(updater: (workflow: WorkflowDraft) => WorkflowDraft) {
    if (!caseDraft) {
      return;
    }

    updateSelectedTestCase((testCase) => {
      const nextWorkflow = updater(testCaseToWorkflow(testCase));
      return {
        ...testCase,
        kind: nextWorkflow.kind,
        name: nextWorkflow.name,
        category: nextWorkflow.category,
        url: nextWorkflow.url,
        notes: nextWorkflow.notes,
        steps: nextWorkflow.steps,
      };
    });
  }

  function syncSelectionToProject(project?: ProjectDraft) {
    setSelectedProjectId(project?.id ?? '');
    setSelectedGroupId(project?.groups[0]?.id ?? '');
    setSelectedTestCaseReference(latestTestCaseReference(project));
    setCaseDraft(undefined);
    setSelectedRecordingId(project?.recordings[0]?.id ?? '');
    setSelectedSuiteReference(latestSuiteReference(project));
    setSelectedDocumentId(project?.documents[0]?.id ?? '');
    setNavigateUrl(project?.defaultUrl ?? '');
    setBrowserSession((current) => ({
      ...current,
      projectId: project?.id,
      environmentId: project?.selectedEnvironmentId,
    }));
  }

  function appendSystemMessage(text: string) {
    setChatEntries((current) => [
      ...current,
      {
        id: `chat-${Date.now()}-system`,
        role: 'system',
        text,
      },
    ]);
  }

  function getRequiredSettingsSection(page?: AppPage): SettingsSectionId {
    if (page && isGatedFeaturePage(page) && !midsceneReady) {
      return 'midscene';
    }

    return 'appearance';
  }

  function openSettings(page?: AppPage, section?: SettingsSectionId) {
    setPendingPage(page ?? null);
    setSettingsInitialSection(section ?? getRequiredSettingsSection(page));
    setIsSettingsOpen(true);
  }

  function closeSettings() {
    setIsSettingsOpen(false);
    setPendingPage(null);
  }

  function goToPage(page: AppPage) {
    if (isGatedFeaturePage(page) && !midsceneReady) {
      openSettings(page);
      return;
    }

    switchPage(page);
  }

  function ensureMidsceneReady(targetPage?: AppPage): boolean {
    if (midsceneReady) {
      return true;
    }

    openSettings(targetPage ?? activePage);
    return false;
  }

  function handleCreateProject() {
    const next = createEmptyProject(projects.length + 1);
    setProjects((current) => [next, ...current]);
    syncSelectionToProject(next);
    switchPage('projects');
  }

  function handleProjectAssetBound(binding: ProjectAssetBinding) {
    setProjectAssetBindings((current) => [
      binding,
      ...current.filter((candidate) => candidate.projectId !== binding.projectId),
    ]);
  }

  function handleProjectAssetReloaded(result: ProjectAssetReloadResult) {
    setProjects((current) => current.map((project) => project.id === result.project.id ? result.project : project));
    setProjectAssetBindings((current) => [
      result.binding,
      ...current.filter((binding) => binding.projectId !== result.binding.projectId),
    ]);
    if (selectedProjectId === result.project.id) {
      syncSelectionToProject(result.project);
    }
  }

  function handleSelectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    syncSelectionToProject(project);
  }

  function handleDeleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    setPendingDeletion({
      kind: 'project',
      id: projectId,
      description: t('app.confirm.deleteProject', { name: project.name }),
    });
  }

  function performDeleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const nextProjects = projects.filter((item) => item.id !== projectId);
    const nextProject = nextProjects[0];
    const nextSelectedGroupId = nextProject?.groups[0]?.id ?? '';
    const nextSelectedTestCaseReference = latestTestCaseReference(nextProject);
    const nextSelectedRecordingId = nextProject?.recordings[0]?.id ?? '';
    const nextSelectedSuiteReference = latestSuiteReference(nextProject);
    const nextSelectedDocumentId = nextProject?.documents[0]?.id ?? '';
    const nextSelectedRunId = recentRuns.find((run) => run.projectId !== projectId)?.id ?? '';

    setProjects(nextProjects);
    setProjectAssetBindings((current) => current.filter((binding) => binding.projectId !== projectId));
    setRunDetails((current) => current.filter((run) => run.projectId !== projectId));
    setRecentRuns((current) => current.filter((run) => run.projectId !== projectId));
    setSelectedProjectId(nextProject?.id ?? '');
    setSelectedGroupId(nextSelectedGroupId);
    setSelectedTestCaseReference(nextSelectedTestCaseReference);
    setCaseDraft(undefined);
    setSelectedRecordingId(nextSelectedRecordingId);
    setSelectedSuiteReference(nextSelectedSuiteReference);
    setSelectedDocumentId(nextSelectedDocumentId);
    setSelectedRunId(nextSelectedRunId);
    setNavigateUrl(nextProject?.defaultUrl ?? '');
    setBrowserSession((current) => ({
      ...current,
      projectId: nextProject?.id,
      environmentId: nextProject?.selectedEnvironmentId,
    }));
    switchPage(nextProject ? 'projects' : 'home');
  }

  function handleCreateDocument(payload: {
    name: string;
    kind: PrdDocumentKind;
    size: number;
    sourceText: string;
  }) {
    if (!selectedProject) {
      return;
    }

    const document = createPrdDocumentAsset(payload);
    updateSelectedProject((project) => ({
      ...project,
      documents: [document, ...project.documents],
    }));
    setSelectedDocumentId(document.id);
    switchPage('documents');
  }

  function handleUpdateDocument(documentId: string, sourceText: string) {
    updateSelectedProject((project) => ({
      ...project,
      documents: project.documents.map((document) =>
        document.id === documentId
          ? updatePrdDocumentAnalysis({
              ...document,
              sourceText,
              size: sourceText.length,
            })
          : document,
      ),
    }));
  }

  async function handleAnalyzeDocument(documentId: string) {
    if (!selectedProject) {
      return;
    }

    const document = selectedProject.documents.find((item) => item.id === documentId);
    if (!document) {
      return;
    }

    setSemanticAnalyzingDocumentId(documentId);
    setSemanticAnalysisError(null);
    try {
      const analysis = await analyzePrdDocument({
        document,
        midsceneConfig,
        agentModelConfig,
      });
      updateSelectedProject(
        (project) => ({
          ...project,
          documents: project.documents.map((item) =>
            item.id === documentId ? analysis.document : item,
          ),
        }),
        'immediate',
      );
    } catch {
      setSemanticAnalysisError({
        documentId,
        message: t('documents.analysis.unexpectedFailure'),
      });
    } finally {
      setSemanticAnalyzingDocumentId(null);
    }
  }

  function handleCreateCaseFromPath(documentId: string, pathId: string) {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    const document = selectedProject.documents.find((item) => item.id === documentId);
    const path = document?.generatedPaths.find((item) => item.id === pathId);
    if (!path) {
      return;
    }

    const existingGroup = selectedProject.groups.find((group) => group.name === path.groupName);
    const generatedGroup = existingGroup
      ? null
      : {
          id: `group-prd-${Date.now()}`,
          name: path.groupName,
          description: t('app.generated.prdGroupDescription', { name: path.groupName }),
          createdAt: new Date().toISOString(),
        };
    const groupId = existingGroup?.id ?? generatedGroup?.id ?? selectedGroup?.id ?? selectedProject.groups[0]?.id ?? '';
    const testCase = createTestCaseFromGeneratedPath({
      path,
      documentId,
      groupId,
      environmentId: selectedEnvironment.id,
      url: selectedProject.defaultUrl,
      seed: selectedProject.testCases.length + 1,
    });

    updateSelectedProject((project) => ({
      ...project,
      groups: generatedGroup ? [...project.groups, generatedGroup] : project.groups,
      testCases: [testCase, ...project.testCases],
    }));
    setSelectedGroupId(groupId);
    setSelectedTestCaseReference({ id: testCase.id, version: testCase.version ?? 1 });
    switchPage('cases');
  }

  function ensureGroupForGeneratedPath(groupName: string) {
    const existingGroup = selectedProject?.groups.find((group) => group.name === groupName);
    if (existingGroup) {
      return {
        groupId: existingGroup.id,
        generatedGroup: null,
      };
    }

    const generatedGroup = {
      id: `group-prd-${Date.now()}`,
      name: groupName,
      description: t('app.generated.prdGroupDescription', { name: groupName }),
      createdAt: new Date().toISOString(),
    };

    return {
      groupId: generatedGroup.id,
      generatedGroup,
    };
  }

  function handleCreateRecordingFromPath(documentId: string, pathId: string) {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    const document = selectedProject.documents.find((item) => item.id === documentId);
    const path = document?.generatedPaths.find((item) => item.id === pathId);
    if (!path) {
      return;
    }

    const { groupId, generatedGroup } = ensureGroupForGeneratedPath(path.groupName);
    const recording = createRecordingFromGeneratedPath({
      path,
      documentId,
      groupId,
      environmentId: selectedEnvironment.id,
      startUrl: selectedProject.defaultUrl,
      seed: selectedProject.recordings.length + 1,
    });

    updateSelectedProject((project) => ({
      ...project,
      groups: generatedGroup ? [...project.groups, generatedGroup] : project.groups,
      recordings: [recording, ...project.recordings],
    }));
    setSelectedGroupId(groupId);
    setSelectedRecordingId(recording.id);
    switchPage('recording');
  }

  function handleCreateAllCasesFromDocument(documentId: string) {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    const document = selectedProject.documents.find((item) => item.id === documentId);
    if (!document) {
      return;
    }

    const pathsToCreate = document.generatedPaths.filter(
      (path) => !selectedProject.testCases.some((testCase) => isTestCaseLinkedToGeneratedPath(testCase, documentId, path)),
    );
    if (!pathsToCreate.length) {
      return;
    }

    const generatedGroups = pathsToCreate
      .map((path) => path.groupName)
      .filter(
        (groupName, index, list) =>
          list.indexOf(groupName) === index &&
          !selectedProject.groups.some((group) => group.name === groupName),
      )
      .map((groupName, index) => ({
        id: `group-prd-${Date.now()}-${index}`,
        name: groupName,
        description: t('app.generated.prdGroupDescription', { name: groupName }),
        createdAt: new Date().toISOString(),
      }));
    const groupsByName = new Map(
      [...selectedProject.groups, ...generatedGroups].map((group) => [group.name, group]),
    );
    const nextCases = pathsToCreate.map((path, index) =>
      createTestCaseFromGeneratedPath({
        path,
        documentId,
        groupId: groupsByName.get(path.groupName)?.id ?? selectedProject.groups[0]?.id ?? '',
        environmentId: selectedEnvironment.id,
        url: selectedProject.defaultUrl,
        seed: selectedProject.testCases.length + index + 1,
      }),
    );

    updateSelectedProject((project) => ({
      ...project,
      groups: [...project.groups, ...generatedGroups],
      testCases: [...nextCases, ...project.testCases],
    }));
    setSelectedGroupId(nextCases[0]?.groupId ?? selectedProject.groups[0]?.id ?? '');
    setSelectedTestCaseReference(nextCases[0] ? { id: nextCases[0].id, version: nextCases[0].version ?? 1 } : selectedTestCaseReference);
    switchPage('cases');
  }

  function handleCreateAllCasesFromMatrix() {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    const pathsToCreate = selectedProject.documents.flatMap((document) =>
      document.generatedPaths
        .filter(
          (path) =>
            !selectedProject.testCases.some((testCase) => isTestCaseLinkedToGeneratedPath(testCase, document.id, path)),
        )
        .map((path) => ({ documentId: document.id, path })),
    );
    if (!pathsToCreate.length) {
      return;
    }

    const generatedGroups = pathsToCreate
      .map(({ path }) => path.groupName)
      .filter(
        (groupName, index, list) =>
          list.indexOf(groupName) === index &&
          !selectedProject.groups.some((group) => group.name === groupName),
      )
      .map((groupName, index) => ({
        id: `group-prd-matrix-${Date.now()}-${index}`,
        name: groupName,
        description: t('app.generated.prdGroupDescription', { name: groupName }),
        createdAt: new Date().toISOString(),
      }));
    const groupsByName = new Map(
      [...selectedProject.groups, ...generatedGroups].map((group) => [group.name, group]),
    );
    const nextCases = pathsToCreate.map(({ documentId, path }, index) =>
      createTestCaseFromGeneratedPath({
        path,
        documentId,
        groupId: groupsByName.get(path.groupName)?.id ?? selectedProject.groups[0]?.id ?? '',
        environmentId: selectedEnvironment.id,
        url: selectedProject.defaultUrl,
        seed: selectedProject.testCases.length + index + 1,
      }),
    );

    updateSelectedProject((project) => ({
      ...project,
      groups: [...project.groups, ...generatedGroups],
      testCases: [...nextCases, ...project.testCases],
    }));
    setSelectedGroupId(nextCases[0]?.groupId ?? selectedProject.groups[0]?.id ?? '');
    setSelectedTestCaseReference(nextCases[0] ? { id: nextCases[0].id, version: nextCases[0].version ?? 1 } : selectedTestCaseReference);
    switchPage('cases');
  }

  function handleCreateAllRecordingsFromMatrix() {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    const pathsToCreate = selectedProject.documents.flatMap((document) =>
      document.generatedPaths
        .filter(
          (path) =>
            !selectedProject.recordings.some((recording) =>
              isRecordingLinkedToGeneratedPath(recording, document.id, path),
            ),
        )
        .map((path) => ({ documentId: document.id, path })),
    );
    if (!pathsToCreate.length) {
      return;
    }

    const generatedGroups = pathsToCreate
      .map(({ path }) => path.groupName)
      .filter(
        (groupName, index, list) =>
          list.indexOf(groupName) === index &&
          !selectedProject.groups.some((group) => group.name === groupName),
      )
      .map((groupName, index) => ({
        id: `group-prd-matrix-recording-${Date.now()}-${index}`,
        name: groupName,
        description: t('app.generated.prdGroupDescription', { name: groupName }),
        createdAt: new Date().toISOString(),
      }));
    const groupsByName = new Map(
      [...selectedProject.groups, ...generatedGroups].map((group) => [group.name, group]),
    );
    const nextRecordings = pathsToCreate.map(({ documentId, path }, index) =>
      createRecordingFromGeneratedPath({
        path,
        documentId,
        groupId: groupsByName.get(path.groupName)?.id ?? selectedProject.groups[0]?.id ?? '',
        environmentId: selectedEnvironment.id,
        startUrl: selectedProject.defaultUrl,
        seed: selectedProject.recordings.length + index + 1,
      }),
    );

    updateSelectedProject((project) => ({
      ...project,
      groups: [...project.groups, ...generatedGroups],
      recordings: [...nextRecordings, ...project.recordings],
    }));
    setSelectedGroupId(nextRecordings[0]?.groupId ?? selectedProject.groups[0]?.id ?? '');
    setSelectedRecordingId(nextRecordings[0]?.id ?? selectedRecordingId);
    switchPage('recording');
  }

  function handleUpdatePrdCoverageTriage(
    documentId: string,
    pathId: string,
    target: PrdCoverageTarget,
    status: PrdCoverageTriageDecisionStatus | undefined,
    note: string,
  ) {
    if (!status) {
      updateSelectedProject((project) => ({
        ...project,
        prdCoverageTriage: project.prdCoverageTriage.filter(
          (decision) => !(decision.documentId === documentId && decision.pathId === pathId && decision.target === target),
        ),
      }));
      return;
    }

    const normalizedNote = note.trim();
    if (!normalizedNote) {
      return;
    }
    const updatedAt = new Date().toISOString();
    updateSelectedProject((project) => ({
      ...project,
      prdCoverageTriage: [
        {
          documentId,
          pathId,
          target,
          status,
          note: normalizedNote,
          updatedAt,
        },
        ...project.prdCoverageTriage.filter(
          (decision) => !(decision.documentId === documentId && decision.pathId === pathId && decision.target === target),
        ),
      ],
    }));
  }

  function handleCreateGroup() {
    if (!selectedProject) {
      return;
    }
    const group = createEmptyGroup(selectedProject.groups.length + 1);
    updateSelectedProject((project) => ({
      ...project,
      groups: [...project.groups, group],
    }));
    setSelectedGroupId(group.id);
  }

  function handleDeleteGroup(groupId: string) {
    if (!selectedProject) {
      return;
    }

    const group = selectedProject.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    setPendingDeletion({
      kind: 'group',
      id: groupId,
      description: t('app.confirm.deleteGroup', { name: group.name }),
    });
  }

  function performDeleteGroup(groupId: string) {
    if (!selectedProject) {
      return;
    }

    const group = selectedProject.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    const remainingGroups = selectedProject.groups.filter((item) => item.id !== groupId);
    const fallbackGroup =
      remainingGroups[0] ??
      {
        id: `group-${Date.now()}`,
        name: t('app.generated.defaultGroup'),
        description: t('app.generated.defaultGroupDescription'),
        createdAt: new Date().toISOString(),
      };
    const nextGroups = remainingGroups.length ? remainingGroups : [fallbackGroup];
    const nextGroupId = selectedGroupId === groupId ? fallbackGroup.id : selectedGroupId;
    const movedSelectedCase = selectedTestCase?.groupId === groupId
      ? createNextTestCaseVersion(selectedProject, selectedTestCase, { groupId: fallbackGroup.id })
      : undefined;

    updateSelectedProject((project) => {
      const nextTestCases = project.testCases.flatMap((testCase) =>
        testCase.groupId === groupId
          ? [testCase, createNextTestCaseVersion(project, testCase, { groupId: fallbackGroup.id })]
          : [testCase],
      );
      const nextRecordings = project.recordings.map((recording) =>
        recording.groupId === groupId ? { ...recording, groupId: fallbackGroup.id } : recording,
      );
      const nextSelectedTestCase =
        nextTestCases.find((testCase) => testCase.id === selectedTestCaseId) ??
        nextTestCases.find((testCase) => testCase.groupId === nextGroupId) ??
        nextTestCases[0];
      const nextSelectedRecording =
        nextRecordings.find((item) => item.id === selectedRecordingId) ??
        nextRecordings.find((item) => item.groupId === nextGroupId) ??
        nextRecordings[0];

      setSelectedGroupId(nextGroupId);
      setSelectedTestCaseReference(movedSelectedCase
        ? { id: movedSelectedCase.id, version: movedSelectedCase.version ?? 1 }
        : nextSelectedTestCase
          ? { id: nextSelectedTestCase.id, version: nextSelectedTestCase.version ?? 1 }
          : undefined);
      setSelectedRecordingId(nextSelectedRecording?.id ?? '');

      return {
        ...project,
        groups: nextGroups,
        testCases: nextTestCases,
        recordings: nextRecordings,
      };
    });
  }

  function handleCreateTestCase() {
    if (!selectedProject || !selectedGroup || !selectedEnvironment) {
      return;
    }
    const testCase = createEmptyTestCase(
      selectedProject.testCases.length + 1,
      selectedGroup.id,
      selectedEnvironment.id,
    );
    updateSelectedProject((project) => ({
      ...project,
      testCases: [testCase, ...project.testCases],
    }));
    setSelectedTestCaseReference({ id: testCase.id, version: testCase.version ?? 1 });
  }

  function handleCreateRecording(source: 'live' | 'imported' = 'live') {
    if (!selectedProject || !selectedGroup || !selectedEnvironment) {
      return;
    }

    const recording = createEmptyRecordingAsset({
      seed: selectedProject.recordings.length + 1,
      source,
      groupId: selectedGroup.id,
      environmentId: selectedEnvironment.id,
      startUrl: selectedEnvironment.url || selectedProject.defaultUrl,
    });

    updateSelectedProject((project) => ({
      ...project,
      recordings: [recording, ...project.recordings],
    }));
    setSelectedRecordingId(recording.id);
    setSelectedGroupId(recording.groupId);
    switchPage('recording');
  }

  function appendRecordingSampleStep(
    kind: RecordingAsset['steps'][number]['kind'],
    title: string,
    detail: string,
    session: BrowserSessionState = browserSession,
    recordingId: string | undefined = selectedRecording?.id,
  ) {
    if (!recordingId) {
      return;
    }

    setProjects((current) =>
      current.map((project) => ({
        ...project,
        recordings: project.recordings.map((recording) =>
          recording.id === recordingId
            ? {
                ...recording,
                updatedAt: new Date().toISOString(),
                steps: [
                  ...recording.steps,
                  {
                    ...createRecordingStep(recording.steps.length + 1, kind),
                    title,
                    detail,
                    pageUrl: session.currentUrl || recording.startUrl,
                    screenshotPath: session.screenshotPath,
                    capturedAt: new Date().toISOString(),
                  },
                ],
              }
            : recording,
        ),
      })),
    );
  }

  function appendCapturedRecordingStep(event: RecordingCapturedEvent) {
    const targetRecordingId = selectedRecordingIdRef.current;
    if (!targetRecordingId) {
      return;
    }

    setProjects((current) =>
      current.map((project) => {
        const recordingIndex = project.recordings.findIndex((recording) => recording.id === targetRecordingId);
        if (recordingIndex === -1) {
          return project;
        }

        const nextRecordings = project.recordings.map((recording, index) => {
          if (index !== recordingIndex) {
            return recording;
          }

          const lastStep = recording.steps.at(-1);
          const duplicate =
            lastStep?.kind === event.kind &&
            lastStep.detail === event.detail &&
            lastStep.pageUrl === event.pageUrl;
          if (duplicate) {
            return recording;
          }

          return {
            ...recording,
            updatedAt: new Date().toISOString(),
            startUrl: recording.startUrl || event.pageUrl,
            steps: [
              ...recording.steps,
              {
                id: event.id,
                kind: event.kind,
                title: event.title,
                detail: event.detail,
                pageUrl: event.pageUrl,
                capturedAt: event.capturedAt,
                selector: event.selector,
                value: event.value,
              },
            ],
          };
        });

        return {
          ...project,
          recordings: nextRecordings,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }

  function handleSelectRecording(recordingId: string) {
    setSelectedRecordingId(recordingId);
    const recording = selectedProject?.recordings.find((item) => item.id === recordingId);
    if (recording) {
      setSelectedGroupId(recording.groupId);
    }
  }

  function handleConfirmManualStep(
    runId: string,
    stepId: string,
    status: 'passed' | 'failed',
    note: string,
    screenshotPath?: string,
    attachments: RunArtifact[] = [],
  ) {
    const confirmedAt = new Date().toISOString();
    let nextSummary = '';
    let nextStatus: RunTone = status;

    setRunDetails((current) =>
      current.map((detail) => {
        if (detail.id !== runId) {
          return detail;
        }

        const steps = detail.steps.map((step) =>
          step.stepId === stepId
            ? {
                ...step,
                status,
                message: `${step.message}\n人工确认：${status === 'passed' ? '通过' : '失败'}。${note}`,
              }
            : step,
        );
        nextStatus = steps.some((step) => step.status === 'failed')
          ? 'failed'
          : steps.some((step) => step.status === 'neutral')
            ? 'neutral'
            : 'passed';
        nextSummary =
          nextStatus === 'failed'
            ? `人工检查失败：${note}`
            : nextStatus === 'passed'
              ? '全部步骤已完成并获得执行或人工确认。'
              : '人工检查已确认，仍有步骤等待执行。';
        const manualArtifactId = `${runId}-artifact-manual-${stepId}`;
        const manualArtifact = screenshotPath
          ? {
              id: manualArtifactId,
              type: 'snapshot' as const,
              label: '人工检查截图证据',
              path: screenshotPath,
            }
          : undefined;
        const previousEvidence = detail.manualEvidence?.find((evidence) => evidence.stepId === stepId);
        const previousManualArtifactIds = new Set([
          manualArtifactId,
          ...(previousEvidence?.attachments ?? []).map((attachment) => attachment.id),
        ]);
        const manualArtifacts: RunArtifact[] = [
          ...(manualArtifact ? [manualArtifact] : []),
          ...attachments,
        ];
        const attachmentLabels = attachments.map((attachment) => attachment.label).join('、');
        const attachmentSummary = attachmentLabels ? `（已附加文件：${attachmentLabels}）` : '';
        const manualEvidence = [
          ...(detail.manualEvidence ?? []).filter((evidence) => evidence.stepId !== stepId),
          {
            stepId,
            status,
            note,
            confirmedAt,
            ...(screenshotPath ? { screenshotPath } : {}),
            ...(attachments.length ? { attachments } : {}),
          },
        ];
        const currentAgentRun = detail.agentRun;
        const agentRun = currentAgentRun
          ? (() => {
              const manualArtifactEventPrefix = `${currentAgentRun.runId}-event-manual-artifact-${stepId}`;
              const remainingEvents = currentAgentRun.events.filter(
                (event) =>
                  event.type !== 'agent:run-finished' &&
                  !(event.type === 'agent:assertion-result' && event.stepId === stepId) &&
                  !(event.type === 'agent:artifact-created' && event.id.startsWith(manualArtifactEventPrefix)),
              );
              const verificationEvent = {
                id: `${currentAgentRun.runId}-event-manual-${stepId}`,
                runId: currentAgentRun.runId,
                type: 'agent:assertion-result' as const,
                stepId,
                message: `人工检查${status === 'passed' ? '通过' : '失败'}：${note}${screenshotPath ? '（已附加当前页面截图）' : ''}${attachmentSummary}`,
                status,
                verification: {
                  id: `${currentAgentRun.runId}-verification-manual-${stepId}`,
                  stepId,
                  status,
                  summary: `人工检查${status === 'passed' ? '通过' : '失败'}。`,
                  evidence: `${note}${screenshotPath ? `；已附加截图：${screenshotPath}` : ''}${attachmentLabels ? `；已附加文件：${attachmentLabels}` : ''}`,
                  ...(status === 'failed' ? { failureReason: note } : {}),
                  createdAt: confirmedAt,
                },
                createdAt: confirmedAt,
              };
              const artifactEvents = manualArtifacts.map((artifact) =>
                ({
                    id: `${manualArtifactEventPrefix}-${artifact.id}`,
                    runId: currentAgentRun.runId,
                    type: 'agent:artifact-created' as const,
                    stepId,
                    message: artifact.type === 'snapshot' ? '已附加人工检查截图证据。' : `已附加人工检查文件：${artifact.label}。`,
                    status,
                    artifact,
                    createdAt: confirmedAt,
                  }),
              );
              const { failureReason: previousFailureReason, ...agentRunWithoutPreviousFailure } = currentAgentRun;
              return {
                ...agentRunWithoutPreviousFailure,
                status: nextStatus,
                summary: nextSummary,
                events: [
                  ...remainingEvents,
                  verificationEvent,
                  ...artifactEvents,
                  {
                    id: `${currentAgentRun.runId}-event-finished`,
                    runId: currentAgentRun.runId,
                    type: 'agent:run-finished' as const,
                    message: nextSummary,
                    status: nextStatus,
                    createdAt: confirmedAt,
                  },
                ],
                artifacts: [
                  ...currentAgentRun.artifacts.filter((artifact) => !previousManualArtifactIds.has(artifact.id)),
                  ...manualArtifacts,
                ],
                ...(nextStatus === 'failed' ? { failureReason: note } : {}),
              };
            })()
          : undefined;
        const { failureReason: previousFailureReason, ...detailWithoutPreviousFailure } = detail;

        return {
          ...detailWithoutPreviousFailure,
          status: nextStatus,
          summary: nextSummary,
          logs: [
            ...detail.logs,
            `[${createTimestampLabel()}] 人工检查${status === 'passed' ? '通过' : '失败'}：${note}${screenshotPath ? '（已附加当前页面截图）' : ''}${attachmentSummary}`,
          ],
          steps,
          artifacts: [
            ...detail.artifacts.filter((artifact) => !previousManualArtifactIds.has(artifact.id)),
            ...manualArtifacts,
          ],
          manualEvidence,
          ...(agentRun ? { agentRun } : {}),
          ...(nextStatus === 'failed' ? { failureReason: note } : {}),
        };
      }),
    );
    setRecentRuns((current) =>
      current.map((run) =>
        run.id === runId
          ? {
              ...run,
              status: nextStatus,
              summary: nextSummary,
            }
          : run,
      ),
    );
  }

  async function handleCaptureManualEvidence(): Promise<string | undefined> {
    setIsBrowserBusy(true);
    try {
      const session = await captureBrowserSnapshot();
      setBrowserSession(session);
      return session.screenshotPath;
    } catch {
      appendSystemMessage(t('app.runtime.browserCaptureFailed'));
      return undefined;
    } finally {
      setIsBrowserBusy(false);
    }
  }

  async function handleAttachManualEvidence(): Promise<RunArtifact | undefined> {
    try {
      return await attachManualEvidence();
    } catch {
      appendSystemMessage(t('app.runtime.manualEvidenceAttachFailed'));
      return undefined;
    }
  }

  function handleUpdateRecording(updater: (recording: RecordingAsset) => RecordingAsset) {
    if (!selectedProject || !selectedRecording) {
      return;
    }

    updateSelectedProject((project) => ({
      ...project,
      recordings: project.recordings.map((recording) =>
        recording.id === selectedRecording.id
          ? {
              ...updater(recording),
              updatedAt: new Date().toISOString(),
            }
          : recording,
      ),
    }));
  }

  function handleAppendRecordingStep(kind: RecordingAsset['steps'][number]['kind'] = 'click') {
    if (!selectedRecording) {
      return;
    }

    handleUpdateRecording((recording) => ({
      ...recording,
      steps: [
        ...recording.steps,
        createRecordingStep(recording.steps.length + 1, kind),
      ],
    }));
  }

  async function handleStartRecordingSession() {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    let activeRecording = selectedRecording;
    if (!selectedRecording) {
      const recording = createEmptyRecordingAsset({
        seed: selectedProject.recordings.length + 1,
        source: 'live',
        groupId: selectedGroup?.id ?? selectedProject.groups[0]?.id ?? '',
        environmentId: selectedEnvironment.id,
        startUrl: selectedEnvironment.url || selectedProject.defaultUrl,
      });
      selectedRecordingIdRef.current = recording.id;
      activeRecording = recording;
      updateSelectedProject((project) => ({
        ...project,
        recordings: [recording, ...project.recordings],
      }));
      setSelectedRecordingId(recording.id);
      setSelectedGroupId(recording.groupId);
    }

    setIsBrowserBusy(true);
    try {
      const session = await startBrowserSession({
        project: selectedProject,
        environment: selectedEnvironment,
      });
      setBrowserSession(session);
      setNavigateUrl(session.currentUrl || selectedEnvironment.url);
      appendSystemMessage(t('app.runtime.recordingConnected'));
      if (session.currentUrl && activeRecording) {
        appendRecordingSampleStep('navigate', t('app.runtime.navigationTitle'), t('app.runtime.openPage', { url: session.currentUrl }), session, activeRecording.id);
      }
    } catch {
      appendSystemMessage(t('app.runtime.recordingStartFailed'));
    } finally {
      setIsBrowserBusy(false);
    }
  }

  async function handleCaptureRecordingSnapshot() {
    setIsBrowserBusy(true);
    try {
      const session = await captureBrowserSnapshot();
      setBrowserSession(session);
      appendRecordingSampleStep(
        'snapshot',
        t('app.runtime.captureSnapshotTitle'),
        t('app.runtime.captureSnapshotDescription', { url: session.currentUrl || selectedRecording?.startUrl || '' }),
        session,
      );
    } catch {
      appendSystemMessage(t('app.runtime.recordingCaptureFailed'));
    } finally {
      setIsBrowserBusy(false);
    }
  }

  function handleCreateTestCaseFromRecording(recordingId: string) {
    if (!selectedProject) {
      return;
    }

    const recording = selectedProject.recordings.find((item) => item.id === recordingId);
    if (!recording) {
      return;
    }

    const testCase = createTestCaseFromRecording({
      recording,
      seed: selectedProject.testCases.length + 1,
    });

    updateSelectedProject((project) => ({
      ...project,
      testCases: [testCase, ...project.testCases],
    }));
    setSelectedGroupId(testCase.groupId);
    setSelectedTestCaseReference({ id: testCase.id, version: testCase.version ?? 1 });
    switchPage('cases');
  }

  async function handleRunRecording() {
    if (!selectedProject || !selectedRecording || isRunning) {
      return;
    }
    const environment =
      selectedProject.environments.find((item) => item.id === selectedRecording.environmentId) ?? selectedEnvironment;
    if (!environment || !selectedRecording.steps.length) {
      return;
    }

    setIsRunning(true);
    setRunStatus('running');
    setRunTitle(t('app.runtime.replayTitle', { name: selectedRecording.name }));
    setRunLogs([
      `[${createTimestampLabel()}] Recording replay: ${selectedRecording.name}`,
      `[${createTimestampLabel()}] Environment: ${environment.name}`,
      `[${createTimestampLabel()}] Nodes: ${selectedRecording.steps.length}`,
    ]);

    try {
      const result = await runRecording({
        project: selectedProject,
        recording: selectedRecording,
        environment,
      });
      setRunId(result.runId);
      setRunTitle(result.title);
      setRunStatus(result.agentRun.status);
      setIsRunning(false);
      setRunDetails((current) => [result.detail, ...current.filter((run) => run.id !== result.runId)]);
      setRecentRuns((current) => [
        {
          id: result.runId,
          name: result.title,
          status: result.agentRun.status,
          duration: result.detail.duration,
          summary: result.detail.summary,
          projectId: selectedProject.id,
          testCaseId: selectedRecording.id,
          ...(result.detail.documentId ? { documentId: result.detail.documentId } : {}),
          environmentId: environment.id,
          environmentName: environment.name,
          startedAt: result.agentRun.startedAt,
        },
        ...current.filter((run) => run.id !== result.runId),
      ]);
      setSelectedRunId(result.runId);
      switchPage('runs');
    } catch {
      setIsRunning(false);
      setRunStatus('failed');
      appendSystemMessage(t('app.runtime.replayFailed'));
    }
  }

  function handleDeleteRecording(recordingId: string) {
    if (!selectedProject) {
      return;
    }

    const target = selectedProject.recordings.find((item) => item.id === recordingId);
    if (!target) {
      return;
    }

    const affectedSteps = selectedProject.testCases.reduce(
      (count, testCase) =>
        count + testCase.steps.filter((step) => step.type === 'recordingReplay' && step.recordingId === recordingId).length,
      0,
    );
    const confirmMessage = affectedSteps
      ? t('app.confirm.deleteRecordingReferenced', { name: target.name, count: affectedSteps })
      : t('app.confirm.deleteRecording', { name: target.name });

    setPendingDeletion({ kind: 'recording', id: recordingId, description: confirmMessage });
  }

  function performDeleteRecording(recordingId: string) {
    if (!selectedProject) {
      return;
    }

    const target = selectedProject.recordings.find((item) => item.id === recordingId);
    if (!target) {
      return;
    }

    const nextRecordings = selectedProject.recordings.filter((item) => item.id !== recordingId);
    const detached = detachRecordingFromTestCases(selectedProject.testCases, recordingId);
    updateSelectedProject((project) => ({
      ...project,
      recordings: nextRecordings,
      testCases: project.testCases.flatMap((testCase, index) => (
        detached.testCases[index]?.steps.every((step, stepIndex) => step === testCase.steps[stepIndex])
          ? [testCase]
          : [testCase, createNextTestCaseVersion(project, testCase, detached.testCases[index]!)]
      )),
    }));
    setSelectedRecordingId(nextRecordings[0]?.id ?? '');
  }

  function confirmPendingDeletion() {
    if (!pendingDeletion) {
      return;
    }

    const deletion = pendingDeletion;
    setPendingDeletion(null);

    if (deletion.kind === 'project') {
      performDeleteProject(deletion.id);
    } else if (deletion.kind === 'group') {
      performDeleteGroup(deletion.id);
    } else {
      performDeleteRecording(deletion.id);
    }
  }

  function handleCreateStep(type: TestStepDraft['type'], index: number): string | undefined {
    if (!selectedProject || !caseDraft) {
      return undefined;
    }

    const recording =
      type === 'recordingReplay'
        ? findDefaultRecordingForCaseStep(
            selectedProject.recordings,
            caseDraft.groupId,
            caseDraft.environmentId,
          )
        : undefined;
    const step = createTestStep(type, caseDraft.steps.length + 1, recording);

    updateSelectedTestCase((testCase) => ({
      ...testCase,
      steps: insertTestStep(testCase.steps, step, index),
    }), 'immediate');
    return step.id;
  }

  function handleAppendStep(type: TestStepDraft['type'] = 'ai') {
    return handleCreateStep(type, caseDraft?.steps.length ?? 0);
  }

  function handleMoveStep(stepId: string, index: number) {
    updateSelectedTestCase((testCase) => ({
      ...testCase,
      steps: moveTestStep(testCase.steps, stepId, index),
    }), 'immediate');
  }

  function handleCopyStep(stepId: string): string | undefined {
    if (!caseDraft?.steps.some((step) => step.id === stepId)) {
      return undefined;
    }

    const copyId = `step-${Date.now()}-${caseDraft.steps.length + 1}`;
    updateSelectedTestCase((testCase) => ({
      ...testCase,
      steps: copyTestStep(testCase.steps, stepId, copyId),
    }), 'immediate');
    return copyId;
  }

  function handleDeleteStep(stepId: string) {
    updateSelectedTestCase((testCase) => ({
      ...testCase,
      steps: removeTestStep(testCase.steps, stepId),
    }), 'immediate');
  }

  function handleSelectTestCase(reference: VersionedTestAssetReference) {
    if (caseDraft) {
      return;
    }
    const testCase = selectedProject && findTestCaseVersion(selectedProject, reference);
    if (!testCase) {
      return;
    }

    setSelectedGroupId(testCase.groupId);
    setSelectedTestCaseReference(reference);
  }

  function handlePublishSuite(suite: SuiteAsset) {
    if (!selectedProject) {
      return;
    }
    updateSelectedProject((project) => ({
      ...project,
      suites: [...project.suites, suite],
    }), 'immediate');
    setSelectedSuiteReference({ id: suite.id, version: suite.version });
  }

  async function handleRunSuite(reference: VersionedTestAssetReference) {
    if (!selectedProject || isRunning) {
      return;
    }
    const suite = selectedProject.suites.find((candidate) => candidate.id === reference.id && candidate.version === reference.version);
    if (!suite) {
      return;
    }

    const suiteRunId = `suite-run-${Date.now()}`;
    activeSuiteRunIdRef.current = suiteRunId;
    setActiveSuiteRunId(suiteRunId);
    setIsRunning(true);
    setRunId(suiteRunId);
    setRunTitle(suite.name);
    setRunStatus('running');
    setRunLogs([
      `[${createTimestampLabel()}] Dispatching Suite: ${suite.name}@${suite.version}`,
      `[${createTimestampLabel()}] Project: ${selectedProject.name}`,
      `[${createTimestampLabel()}] Effective desktop concurrency: 1`,
    ]);

    try {
      const result = await runSuite({
        runId: suiteRunId,
        project: selectedProject,
        suite: reference,
        runtimeProfile,
        midsceneConfig,
        agentModelConfig,
        browserSession,
      });
      const caseDetails = result.detail.caseDetails;
      setLastSuiteRun(result.detail);
      setRunId(result.runId);
      setRunTitle(result.title);
      setRunStatus(result.detail.suite.status);
      setRunDetails((current) => [
        ...caseDetails,
        ...current.filter((run) => !caseDetails.some((detail) => detail.id === run.id)),
      ]);
      setRecentRuns((current) => [
        ...caseDetails.map((detail) => ({
          id: detail.id,
          name: detail.title,
          status: detail.status,
          duration: detail.duration,
          summary: detail.summary,
          projectId: selectedProject.id,
          testCaseId: detail.testCaseId,
          ...(detail.documentId ? { documentId: detail.documentId } : {}),
          environmentId: detail.environmentId,
          environmentName: selectedProject.environments.find((environment) => environment.id === detail.environmentId)?.name,
          startedAt: detail.startedAt,
        })),
        ...current.filter((run) => !caseDetails.some((detail) => detail.id === run.id)),
      ]);
      const firstDetail = caseDetails[0];
      if (firstDetail) {
        setSelectedRunId(firstDetail.id);
        switchPage('runs');
      }
    } catch {
      setRunStatus('failed');
      appendSystemMessage(t('app.runtime.suiteFailed'));
    } finally {
      activeSuiteRunIdRef.current = undefined;
      setActiveSuiteRunId(undefined);
      setIsRunning(false);
    }
  }

  async function handleCancelSuite(runId: string) {
    await handleCancelRun(runId);
  }

  async function handleSaveCredential(payload: {
    label: string;
    username: string;
    secret: string;
  }): Promise<CredentialRef | null> {
    if (!selectedProject) {
      return null;
    }
    const ref = await saveCredential({
      projectId: selectedProject.id,
      label: payload.label,
      username: payload.username,
      kind: 'password',
      secret: payload.secret,
    });
    updateSelectedProject((project) => ({
      ...project,
      credentialRefs: [ref, ...project.credentialRefs],
    }));
    return ref;
  }

  async function handleStartBrowserSession() {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }
    setIsBrowserBusy(true);
    try {
      const session = await startBrowserSession({
        project: selectedProject,
        environment: selectedEnvironment,
      });
      setBrowserSession(session);
      setNavigateUrl(session.currentUrl || selectedEnvironment.url);
    } catch {
      appendSystemMessage(t('app.runtime.browserStartFailed'));
    } finally {
      setIsBrowserBusy(false);
    }
  }

  async function handleNavigateBrowser() {
    const url = navigateUrl.trim();
    if (!url) {
      return;
    }
    setIsBrowserBusy(true);
    try {
      setBrowserSession(await navigateBrowserSession({ url }));
    } catch {
      appendSystemMessage(t('app.runtime.navigationFailed'));
    } finally {
      setIsBrowserBusy(false);
    }
  }

  async function handleCaptureBrowser() {
    setIsBrowserBusy(true);
    try {
      setBrowserSession(await captureBrowserSnapshot());
    } catch {
      appendSystemMessage(t('app.runtime.browserCaptureFailed'));
    } finally {
      setIsBrowserBusy(false);
    }
  }

  function appendAgentRunResult(agentRun: AgentRunResult) {
    const environment = selectedProject?.environments.find(
      (candidate) => candidate.id === agentRun.intent.environmentId,
    );
    const environmentId = agentRun.intent.environmentId ?? selectedEnvironment?.id ?? targetEnvironment;
    const environmentName = environment?.name ?? selectedEnvironment?.name ?? targetEnvironment;
    const projectId = agentRun.intent.projectId ?? selectedProject?.id ?? '';
    const testCaseId = agentRun.intent.testCaseId ?? selectedTestCase?.id ?? '';
    const documentId = agentRun.intent.documentId;
    const logs = agentRun.events.map((event) => `[${createTimestampLabel()}] ${event.type}: ${event.message}`);
    const fallbackDurationMs = agentRun.endedAt
      ? Date.parse(agentRun.endedAt) - Date.parse(agentRun.startedAt)
      : undefined;
    const duration = formatRunDuration(agentRun.metrics?.durationMs ?? fallbackDurationMs);
    const detail: RunDetail = {
      id: agentRun.runId,
      projectId,
      testCaseId,
      ...(documentId ? { documentId } : {}),
      environmentId,
      title: agentRun.plan.title,
      status: agentRun.status,
      startedAt: agentRun.startedAt,
      duration,
      summary: agentRun.summary,
      logs,
      steps: agentRun.plan.steps.map((step, index) => ({
        id: `agent-run-step-${agentRun.runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: agentRun.status,
        message: `${step.action}: ${step.instruction}`,
      })),
      artifacts: agentRun.artifacts,
      agentRun,
    };
    if (agentRun.endedAt) {
      detail.endedAt = agentRun.endedAt;
    }
    if (agentRun.failureReason) {
      detail.failureReason = agentRun.failureReason;
    }
    const summary: RunSummary = {
      id: agentRun.runId,
      name: agentRun.plan.title,
      status: agentRun.status,
      duration,
      summary: agentRun.summary,
      projectId,
      testCaseId,
      ...(documentId ? { documentId } : {}),
      environmentId,
      environmentName,
      startedAt: agentRun.startedAt,
    };

    setRunDetails((current) => [detail, ...current.filter((run) => run.id !== detail.id)]);
    setRecentRuns((current) => [summary, ...current.filter((run) => run.id !== summary.id)]);
    setSelectedRunId(agentRun.runId);
    const observedSession = agentRun.events.find((event) => event.browserSession)?.browserSession;
    if (observedSession) {
      setBrowserSession((current) => ({
        ...current,
        status: observedSession.status as BrowserSessionState['status'],
        currentUrl: observedSession.currentUrl,
        pageTitle: observedSession.pageTitle ?? current.pageTitle,
        screenshotPath: observedSession.screenshotPath ?? current.screenshotPath,
        message: t('app.runtime.agentSnapshotCaptured'),
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  async function handleSendMessage() {
    const prompt = chatInput.trim();
    if (!prompt || isSending || !ensureMidsceneReady('nl')) {
      return;
    }

    setIsSending(true);
    try {
      const response = await sendChatCommand({
        mode: commandMode,
        prompt,
        targetEnvironment,
        deepThink,
        deepLocate,
        runtimeProfile,
        midsceneConfig,
        agentModelConfig,
        browserSession,
        ...(selectedProject ? { project: selectedProject } : {}),
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
        projectId: selectedProject?.id,
        ...(selectedGroup ? { groupId: selectedGroup.id } : {}),
        ...(selectedEnvironment ? { environmentId: selectedEnvironment.id } : {}),
        testCaseId: selectedTestCase?.id,
      });

      setChatEntries((current) => [...current, response.userEntry, response.assistantEntry]);
      if (response.agentRun) {
        appendAgentRunResult(response.agentRun);
      }
      setChatInput('');
    } catch {
      appendSystemMessage(t('app.runtime.commandFailed'));
    } finally {
      setIsSending(false);
    }
  }

  async function handleToggleSession() {
    if (isSending || isRunning || !ensureMidsceneReady('nl')) {
      return;
    }

    try {
      const entry = sessionActive
        ? await endSession()
        : await startSession({
            targetEnvironment,
            runtimeProfile,
          });
      setSessionActive(!sessionActive);
      setChatEntries((current) => [...current, entry]);
    } catch {
      appendSystemMessage(t('app.runtime.sessionToggleFailed'));
    }
  }

  function handleSavePromptAsStep() {
    const prompt = chatInput.trim();
    if (!prompt || !caseDraft) {
      return;
    }

    updateSelectedTestCase((testCase) => ({
      ...testCase,
      steps: [
        ...testCase.steps,
        {
          id: `step-${Date.now()}`,
          type: commandMode,
          title: t('app.generated.nlStep', {
            type: t(commandMode === 'aiAssert' ? 'cases.step.assert' : commandMode === 'aiQuery' ? 'cases.step.query' : 'cases.step.action'),
          }),
          body: prompt,
        },
      ],
    }));
  }

  function handleSaveLatestRunAsTestCase() {
    if (
      !selectedProject ||
      !selectedGroup ||
      !selectedEnvironment ||
      !latestNaturalLanguageAgentRun ||
      latestNaturalLanguageAgentRun.status !== 'passed' ||
      latestNaturalLanguageAgentRun.intent.projectId !== selectedProject.id
    ) {
      return;
    }

    const environment =
      selectedProject.environments.find(
        (candidate) => candidate.id === latestNaturalLanguageAgentRun.intent.environmentId,
      ) ?? selectedEnvironment;
    const group =
      selectedProject.groups.find((candidate) => candidate.id === latestNaturalLanguageAgentRun.intent.groupId) ??
      selectedGroup;
    const testCase = createTestCaseFromAgentRun({
      agentRun: latestNaturalLanguageAgentRun,
      groupId: group.id,
      environmentId: environment.id,
      url: environment.url || selectedProject.defaultUrl,
      seed: selectedProject.testCases.length + 1,
    });
    if (!testCase) {
      return;
    }

    updateSelectedProject((project) => ({
      ...project,
      testCases: [testCase, ...project.testCases],
    }));
    setSelectedGroupId(testCase.groupId);
    setSelectedTestCaseReference({ id: testCase.id, version: testCase.version ?? 1 });
    switchPage('cases');
  }

  async function handleRunWorkflow() {
    if (!selectedWorkflow || isRunning || !ensureMidsceneReady('workflow')) {
      return;
    }

    setIsRunning(true);
    setRunStatus('running');
    setRunLogs([
      `[${createTimestampLabel()}] Dispatching workflow: ${selectedWorkflow.name}`,
      `[${createTimestampLabel()}] Environment: ${targetEnvironment}`,
      `[${createTimestampLabel()}] Midscene model: ${midsceneConfig.modelName || 'unassigned'}`,
      `[${createTimestampLabel()}] Runtime profile: ${runtimeProfile.browser} / ${runtimeProfile.viewport}`,
    ]);

    try {
      const result = await runWorkflow({
        workflow: selectedWorkflow,
        targetEnvironment,
        runtimeProfile,
        midsceneConfig,
        agentModelConfig,
        browserSession,
        ...(selectedProject ? { project: selectedProject } : {}),
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
      });
      setRunId(result.runId);
      setRunTitle(result.title);
      setRunStatus(result.agentRun.status);
      setIsRunning(false);
      setRunDetails((current) => [result.detail, ...current.filter((run) => run.id !== result.runId)]);
      setRecentRuns((current) => [
        {
          id: result.runId,
          name: result.title,
          status: result.agentRun.status,
          duration: result.detail.duration,
          summary: result.detail.summary,
          projectId: selectedProject?.id,
          testCaseId: selectedWorkflow.id,
          environmentId: selectedEnvironment?.id,
          environmentName: selectedEnvironment?.name ?? targetEnvironment,
          startedAt: result.agentRun.startedAt,
        },
        ...current.filter((run) => run.id !== result.runId),
      ]);
      setSelectedRunId(result.runId);
      switchPage('runs');
    } catch {
      setIsRunning(false);
      setRunStatus('failed');
      setRunTitle(selectedWorkflow.name);
      setRunLogs((current) => [...current, `[${createTimestampLabel()}] Runtime dispatch failed`]);
      appendSystemMessage(t('app.runtime.workflowFailed'));
    }
  }

  async function handleRunTestCase(
    selection: TestCaseDraft | VersionedTestAssetReference | undefined = selectedTestCase,
    environmentToRun = selectedCaseEnvironment,
  ) {
    let testCaseToRun: TestCaseDraft | undefined;
    if (selection && 'steps' in selection) {
      testCaseToRun = selection;
    } else if (selectedProject && selection) {
      testCaseToRun = findTestCaseVersion(selectedProject, selection);
    }
    const runBlocker = selectedProject && testCaseToRun
      ? getTestCaseRunBlocker(testCaseToRun, selectedProject.recordings)
      : undefined;
    if (
      !selectedProject ||
      !testCaseToRun ||
      !environmentToRun ||
      runBlocker ||
      isRunning
    ) {
      return;
    }

    const documentId = getTestCasePrdPath(testCaseToRun)?.documentId;
    setIsRunning(true);
    pendingTestCaseRunContextRef.current = {
      projectId: selectedProject.id,
      testCaseId: testCaseToRun.id,
      ...(documentId ? { documentId } : {}),
      environmentId: environmentToRun.id,
      environmentName: environmentToRun.name,
    };
    setRunStatus('running');
    setRunLogs([
      `[${createTimestampLabel()}] Dispatching test case: ${testCaseToRun.name}`,
      `[${createTimestampLabel()}] Project: ${selectedProject.name}`,
      `[${createTimestampLabel()}] Environment: ${environmentToRun.name}`,
    ]);

    try {
      const result = await runTestCase({
        project: selectedProject,
        testCase: testCaseToRun,
        environment: environmentToRun,
        runtimeProfile,
        midsceneConfig,
        agentModelConfig,
        browserSession,
      });
      setRunId(result.runId);
      setRunTitle(result.title);
      setRunStatus(result.detail.status);
      setIsRunning(false);
      setRunDetails((current) => [result.detail, ...current.filter((run) => run.id !== result.runId)]);
      setRecentRuns((current) => [
        {
          id: result.runId,
          name: result.title,
          status: result.detail.status,
          duration: result.detail.duration,
          summary: result.detail.summary,
          projectId: selectedProject.id,
          testCaseId: testCaseToRun.id,
          ...(result.detail.documentId ? { documentId: result.detail.documentId } : {}),
          environmentId: environmentToRun.id,
          environmentName: environmentToRun.name,
          startedAt: result.detail.startedAt,
        },
        ...current.filter((run) => run.id !== result.runId),
      ]);
      setSelectedRunId(result.runId);
      setBrowserSession((current) => ({
        ...current,
        projectId: selectedProject.id,
        environmentId: environmentToRun.id,
      }));
      pendingTestCaseRunContextRef.current = null;
      switchPage('runs');
    } catch {
      pendingTestCaseRunContextRef.current = null;
      setIsRunning(false);
      setRunStatus('failed');
      appendSystemMessage(t('app.runtime.caseFailed'));
    }
  }

  function handleRerunTestCase(run: RunDetail) {
    if (!selectedProject) {
      return;
    }

    const testCaseReference = latestTestCaseReference(selectedProject, run.testCaseId);
    const testCase = testCaseReference && findTestCaseVersion(selectedProject, testCaseReference);
    const environment = selectedProject.environments.find((item) => item.id === run.environmentId);
    if (!testCase || !environment) {
      appendSystemMessage(t('app.runtime.rerunUnavailable'));
      return;
    }

    setSelectedTestCaseReference({ id: testCase.id, version: testCase.version ?? 1 });
    setSelectedGroupId(testCase.groupId);
    void handleRunTestCase(testCase, environment);
  }

  async function handleExportProjectReport() {
    if (!selectedProject) {
      return;
    }
    try {
      const exported = await exportProjectReport({ projectId: selectedProject.id, locale: effectiveLocale });
      appendSystemMessage(t(exported ? 'app.runtime.projectReportExported' : 'app.runtime.projectReportExportCancelled'));
    } catch {
      appendSystemMessage(t('app.runtime.projectReportExportFailed'));
    }
  }

  async function handleCancelRun(activeRunId: string) {
    try {
      const cancelled = await cancelRun(activeRunId);
      appendSystemMessage(t(cancelled ? 'app.runtime.runCancelled' : 'app.runtime.runCancelUnavailable'));
    } catch {
      appendSystemMessage(t('app.runtime.runCancelFailed'));
    }
  }

  function handleCreateReporterFixDraft(run: RunDetail, reporter: AgentReporterSummary) {
    if (!selectedProject || run.projectId !== selectedProject.id) {
      return;
    }

    const source = selectedProject.testCases.find((testCase) => testCase.id === run.testCaseId);
    if (!source) {
      return;
    }

    const draft = createReporterFixDraft(source, reporter, selectedProject.testCases.length + 1);
    if (!draft) {
      return;
    }

    updateSelectedProject((project) => ({
      ...project,
      testCases: [draft, ...project.testCases],
    }), 'immediate');
    setSelectedGroupId(draft.groupId);
    setSelectedTestCaseReference({ id: draft.id, version: draft.version ?? 1 });
    switchPage('cases');
  }

  function handleSaveSettings() {
    const requiresMidsceneBeforeSave = pendingPage ? isGatedFeaturePage(pendingPage) : false;

    if (requiresMidsceneBeforeSave && !midsceneReady) {
      return;
    }

    if (requiresMidsceneBeforeSave && !startupGuide.completed) {
      completeStartupGuide('configured');
    }

    // An explicit save must not depend on the background debounce completing before a reload.
    persistLatestStudioState('immediate');
    if (pendingPage) {
      switchPage(pendingPage);
      setPendingPage(null);
    }
    setIsSettingsOpen(false);
  }

  if (storageLoadError) {
    return (
      <section aria-live="assertive" className="grid h-screen place-items-center bg-background px-6 text-foreground" role="alert">
        <div className="max-w-md rounded-[8px] border border-destructive/30 bg-card p-5 shadow-sm">
          <h1 className="text-lg font-semibold">{t('app.storageError.title')}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('app.storageError.description')}</p>
        </div>
      </section>
    );
  }

  if (isHydrated && !startupGuide.completed) {
    return (
      <StartupPage
        brandLogo={brandLogo}
        locale={effectiveLocale}
        midsceneConfig={midsceneConfig}
        midsceneReady={midsceneReady}
        onComplete={() => {
          if (midsceneReady) {
            completeStartupGuide('configured');
          }
        }}
        onSkip={() => completeStartupGuide('skipped')}
        onUpdateMidsceneConfig={updateMidsceneConfig}
      />
    );
  }

  return (
    <I18nProvider locale={effectiveLocale}>
    <div className="app-shell grid h-screen grid-cols-[240px_minmax(0,1fr)] overflow-hidden bg-background text-foreground max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
      <nav aria-label={t('app.nav.main')} className="app-rail flex min-h-0 shrink-0 flex-col px-3 pb-4 pt-11 max-md:hidden">
        <button
          className="nav-brand flex cursor-pointer items-center gap-2.5 px-2 text-left transition hover:opacity-92"
          onClick={() => goToPage('home')}
          type="button"
        >
          <img alt="" className="h-9 w-9 shrink-0 rounded-[8px] object-cover shadow-sm" src={brandLogo} />
          <span className="min-w-0">
            <span className="block truncate text-[18px] font-black leading-6 tracking-[-0.04em] text-primary">TestBuddy</span>
            <span className="block truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('app.brand.subtitle')}</span>
          </span>
        </button>

        <div className="nav-menu mt-9 flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
          <NavButton active={activePage === 'home'} icon={<House className="h-4 w-4" />} label={t('app.nav.overview')} onClick={() => goToPage('home')} />
          <NavButton active={activePage === 'projects'} icon={<FolderKanban className="h-4 w-4" />} label={t('app.nav.projects')} onClick={() => goToPage('projects')} />
          <NavButton active={activePage === 'documents'} icon={<FileText className="h-4 w-4" />} label={t('app.nav.documents')} onClick={() => goToPage('documents')} />
          <NavButton active={activePage === 'cases'} icon={<ClipboardList className="h-4 w-4" />} label={t('app.nav.cases')} onClick={() => goToPage('cases')} />
          <NavButton active={activePage === 'suites'} icon={<Layers3 className="h-4 w-4" />} label={t('app.nav.suites')} onClick={() => goToPage('suites')} />
          <NavButton active={activePage === 'runs'} icon={<PlaySquare className="h-4 w-4" />} label={t('app.nav.runs')} onClick={() => goToPage('runs')} />
          <NavButton active={activePage === 'nl'} icon={<MessageSquareText className="h-4 w-4" />} label={t('app.nav.naturalLanguage')} onClick={() => goToPage('nl')} />
          <NavButton active={activePage === 'workflow'} icon={<Workflow className="h-4 w-4" />} label={t('app.nav.workflow')} onClick={() => goToPage('workflow')} />
          <NavButton active={activePage === 'recording'} icon={<MousePointerClick className="h-4 w-4" />} label={t('app.nav.recording')} onClick={() => goToPage('recording')} />
        </div>

        <div className="nav-tools mt-4 grid gap-1 pt-3">
          <NavButton active={isSettingsOpen} icon={<Settings2 className="h-4 w-4" />} label={t('app.nav.settings')} onClick={() => openSettings(undefined, 'appearance')} />
          <Button
            aria-label={t('app.shell.openSettings')}
            className="hidden"
            onClick={() => openSettings(undefined, 'appearance')}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </nav>

      <nav aria-label={t('app.nav.mobileMain')} className="app-rail hidden items-center justify-between px-3 py-2 max-md:flex">
        <button
          aria-label="TestBuddy"
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[8px] shadow-sm"
          onClick={() => goToPage('home')}
          type="button"
        >
          <img alt="" className="h-full w-full object-cover" src={brandLogo} />
        </button>
        <div className="mobile-nav-menu flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2">
          <NavButton active={activePage === 'home'} icon={<House className="h-4 w-4" />} label={t('app.nav.overview')} onClick={() => goToPage('home')} showLabel={false} />
          <NavButton active={activePage === 'projects'} icon={<FolderKanban className="h-4 w-4" />} label={t('app.nav.projects')} onClick={() => goToPage('projects')} showLabel={false} />
          <NavButton active={activePage === 'documents'} icon={<FileText className="h-4 w-4" />} label={t('app.nav.documents')} onClick={() => goToPage('documents')} showLabel={false} />
          <NavButton active={activePage === 'cases'} icon={<ClipboardList className="h-4 w-4" />} label={t('app.nav.cases')} onClick={() => goToPage('cases')} showLabel={false} />
          <NavButton active={activePage === 'suites'} icon={<Layers3 className="h-4 w-4" />} label={t('app.nav.suites')} onClick={() => goToPage('suites')} showLabel={false} />
          <NavButton active={activePage === 'runs'} icon={<PlaySquare className="h-4 w-4" />} label={t('app.nav.runs')} onClick={() => goToPage('runs')} showLabel={false} />
          <NavButton active={activePage === 'nl'} icon={<MessageSquareText className="h-4 w-4" />} label={t('app.nav.naturalLanguage')} onClick={() => goToPage('nl')} showLabel={false} />
          <NavButton active={activePage === 'workflow'} icon={<Workflow className="h-4 w-4" />} label={t('app.nav.workflow')} onClick={() => goToPage('workflow')} showLabel={false} />
          <NavButton active={activePage === 'recording'} icon={<MousePointerClick className="h-4 w-4" />} label={t('app.nav.recording')} onClick={() => goToPage('recording')} showLabel={false} />
        </div>
        <Button aria-label={t('app.shell.openSettings')} className="h-10 w-10 rounded-[4px]" onClick={() => openSettings(undefined, 'appearance')} size="icon" type="button" variant="ghost">
          <Settings2 className="h-4 w-4" />
        </Button>
      </nav>

      <div className="app-workspace grid min-h-0 min-w-0 grid-rows-[64px_minmax(0,1fr)_40px] max-md:grid-rows-[minmax(0,1fr)]">
        <header className="app-topbar flex items-center justify-between gap-4 px-6 max-md:hidden">
          <div className="app-search flex h-10 w-[min(448px,40vw)] items-center gap-2 rounded-[4px] px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
              placeholder={t('app.shell.searchPlaceholder')}
              type="search"
            />
          </div>
          <div className="app-topbar-actions flex items-center gap-2">
            <Button className="rounded-[4px]" onClick={() => goToPage('projects')} type="button" variant="outline">
              <FolderKanban className="h-4 w-4" />
              {t('app.shell.projectSettings')}
            </Button>
            <Button className="rounded-[4px]" onClick={() => goToPage('recording')} type="button">
              <MousePointerClick className="h-4 w-4" />
              {t('app.shell.connectDevice')}
            </Button>
          </div>
        </header>
        <main
          className={`app-main page-transition-frame h-full min-h-0 min-w-0 overflow-hidden px-[var(--density-page-x)] py-[var(--density-page-y)] max-md:px-3 max-md:py-2 ${
            isPageExiting ? 'is-page-exiting' : ''
          }`}
        >
          <Suspense fallback={<RouteLoadingPlaceholder />}>
          {activePage === 'home' ? (
            <HomePage
              browserSession={browserSession}
              onCreateProject={handleCreateProject}
              onGoToPage={goToPage}
              projects={projects}
              recentRuns={recentRuns}
              runtimeInfo={runtimeInfo}
            />
          ) : null}

          {activePage === 'projects' ? (
              <ProjectManagementPage
                onCreateGroup={handleCreateGroup}
                onCreateProject={handleCreateProject}
                onDeleteGroup={handleDeleteGroup}
                onDeleteProject={handleDeleteProject}
                onProjectAssetBound={handleProjectAssetBound}
                onProjectAssetReloaded={handleProjectAssetReloaded}
                onSaveCredential={handleSaveCredential}
                onSelectGroup={setSelectedGroupId}
                onSelectProject={handleSelectProject}
                onUpdateProject={updateSelectedProject}
                projectAssetBindings={projectAssetBindings}
                projects={projects}
              selectedGroupId={selectedGroupId}
              selectedProject={selectedProject}
            />
          ) : null}

          {activePage === 'documents' ? (
            <DocumentAnalysisPage
              onCreateAllCasesFromDocument={handleCreateAllCasesFromDocument}
              onCreateAllCasesFromMatrix={handleCreateAllCasesFromMatrix}
              onCreateAllRecordingsFromMatrix={handleCreateAllRecordingsFromMatrix}
              onCreateCaseFromPath={handleCreateCaseFromPath}
              onCreateDocument={handleCreateDocument}
              onCreateRecordingFromPath={handleCreateRecordingFromPath}
              onAnalyzeDocument={handleAnalyzeDocument}
              onOpenProjects={() => goToPage('projects')}
              onSelectDocument={setSelectedDocumentId}
              onUpdateCoverageTriage={handleUpdatePrdCoverageTriage}
              onUpdateDocument={handleUpdateDocument}
              semanticAnalysisError={
                semanticAnalysisError?.documentId === selectedDocumentId
                  ? semanticAnalysisError.message
                  : null
              }
              semanticAnalyzingDocumentId={semanticAnalyzingDocumentId}
              project={selectedProject}
              selectedDocumentId={selectedDocumentId}
            />
          ) : null}

          {activePage === 'cases' ? (
            <TestCaseManagementPage
              draftTestCase={caseDraft}
              isRunning={isRunning}
              onCopyStep={handleCopyStep}
              onCreateStep={handleCreateStep}
              onCreateTestCase={handleCreateTestCase}
              onDeleteStep={handleDeleteStep}
              onDiscardCaseDraft={handleDiscardCaseDraft}
              onEditAsNewVersion={handleEditCaseVersion}
              onMoveStep={handleMoveStep}
              onPublishCase={handlePublishCase}
              onOpenProjects={() => goToPage('projects')}
              onRetrySave={() => persistLatestStudioState('immediate')}
              onRunTestCase={handleRunTestCase}
              onSelectTestCase={handleSelectTestCase}
              onUpdateTestCase={updateSelectedTestCase}
              project={selectedProject}
              publishedTestCase={selectedTestCase}
              runBlocker={selectedTestCaseRunBlocker}
              runStatus={runStatus}
              saveStatus={saveStatus}
              selectedReference={selectedTestCaseReference}
              selectedTestCase={selectedTestCase}
              selectedTestCaseId={selectedTestCaseId}
            />
          ) : null}

          {activePage === 'suites' ? (
            <SuiteManagementPage
              activeRunId={activeSuiteRunId}
              isRunning={isRunning}
              lastRun={lastSuiteRun}
              onCancelSuite={handleCancelSuite}
              onOpenProjects={() => goToPage('projects')}
              onOpenRun={(runId) => {
                setSelectedRunId(runId);
                switchPage('runs');
              }}
              onPublishSuite={handlePublishSuite}
              onRunSuite={handleRunSuite}
              onSelectSuite={setSelectedSuiteReference}
              project={selectedProject}
              selectedSuiteReference={selectedSuiteReference}
            />
          ) : null}

          {activePage === 'runs' ? (
            <RunRecordsPage
              isRunning={isRunning}
              onAttachManualEvidence={runtimeInfo.platform === 'desktop' ? handleAttachManualEvidence : undefined}
              onCaptureManualEvidence={handleCaptureManualEvidence}
              onCancelRun={runtimeInfo.platform === 'desktop' ? handleCancelRun : undefined}
              onConfirmManualStep={handleConfirmManualStep}
              onCreateReporterFixDraft={handleCreateReporterFixDraft}
              onExportProjectReport={runtimeInfo.platform === 'desktop' ? handleExportProjectReport : undefined}
              onRerunTestCase={handleRerunTestCase}
              onSelectRun={setSelectedRunId}
              project={selectedProject}
              recentRuns={recentRuns}
              runDetails={runDetails}
              selectedRunId={selectedRunId}
            />
          ) : null}

          {activePage === 'nl' ? (
            <NaturalLanguagePage
              chatInput={chatInput}
              commandMode={commandMode}
              deepLocate={deepLocate}
              deepThink={deepThink}
              isRunning={isRunning}
              isSending={isSending}
              midsceneConfig={midsceneConfig}
              onChangeChatInput={setChatInput}
              onChangeCommandMode={setCommandMode}
              onChangeDeepLocate={setDeepLocate}
              onChangeDeepThink={setDeepThink}
              onChangeTargetEnvironment={setTargetEnvironment}
              latestAgentRun={latestNaturalLanguageAgentRun}
              onSaveLatestRunAsTestCase={handleSaveLatestRunAsTestCase}
              onSavePromptAsStep={handleSavePromptAsStep}
              onSendMessage={handleSendMessage}
              onToggleSession={handleToggleSession}
              recentChatEntries={recentChatEntries}
              runtimeProfile={runtimeProfile}
              sessionActive={sessionActive}
              targetEnvironment={targetEnvironment}
            />
          ) : null}

          {activePage === 'workflow' ? (
            <WorkflowPage
              hasProject={Boolean(selectedProject)}
              isRunning={isRunning}
              onAppendStep={(type) => handleAppendStep(type)}
              onCreateWorkflow={handleCreateTestCase}
              onDeleteStep={(stepId) =>
                updateSelectedWorkflow((workflow) => ({
                  ...workflow,
                  steps: workflow.steps.filter((item) => item.id !== stepId),
                }))
              }
              onDuplicateStepType={(type) => handleAppendStep(type)}
              onOpenProjects={() => goToPage('projects')}
              onRunWorkflow={handleRunWorkflow}
              onSelectWorkflow={(id) => setSelectedTestCaseReference(latestTestCaseReference(selectedProject, id))}
              onUpdateRuntimeProfile={updateRuntimeProfile}
              onUpdateWorkflow={updateSelectedWorkflow}
              runId={runId}
              runLogs={runLogs}
              runStatus={runStatus}
              runTitle={runTitle}
              runtimeProfile={runtimeProfile}
              selectedWorkflow={selectedWorkflow}
              selectedWorkflowId={selectedTestCaseId}
              workflows={workflows}
            />
          ) : null}

          {activePage === 'recording' ? (
            <RecordingPage
              browserSession={browserSession}
              browserSessionMessage={browserSession.message}
              environment={selectedEnvironment}
              isReplaying={isRunning}
              onAppendStep={handleAppendRecordingStep}
              onCreateRecording={() => handleCreateRecording('live')}
              onCreateTestCaseFromRecording={handleCreateTestCaseFromRecording}
              onCaptureSnapshot={handleCaptureRecordingSnapshot}
              onDeleteRecording={handleDeleteRecording}
              onImportPlayback={() => handleCreateRecording('imported')}
              onOpenProjects={() => goToPage('projects')}
              onRunRecording={handleRunRecording}
              onStartRecording={handleStartRecordingSession}
              onSelectRecording={handleSelectRecording}
              onUpdateRecording={handleUpdateRecording}
              project={selectedProject}
              recording={selectedRecording}
            />
          ) : null}
          </Suspense>
        </main>
        <footer className="app-runtimebar flex items-center justify-between gap-4 px-6 font-mono text-[11px] max-md:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className={`app-runtimebar-signal ${
                browserSession.status === 'ready' ? 'is-ready' : isRunning || browserSession.status === 'starting' || browserSession.status === 'navigating' ? 'is-busy' : ''
              }`}
            />
            <span className="max-w-[min(520px,42vw)] truncate">{browserSession.message || browserSession.currentUrl || t('app.runtime.notRun')}</span>
            {browserSession.currentUrl ? <span className="text-border">/</span> : null}
            {browserSession.currentUrl ? <span className="max-w-[260px] truncate text-muted-foreground">{browserSession.currentUrl}</span> : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="max-w-[240px] truncate text-muted-foreground">{runTitle}</span>
            <StatusPill tone={runStatus} />
          </div>
        </footer>
      </div>

      <Suspense fallback={null}>
        <SettingsModal
          agentModelConfig={agentModelConfig}
          appearance={appearance}
          effectiveTheme={effectiveTheme}
          initialSection={settingsInitialSection}
          locale={effectiveLocale}
          midsceneConfig={midsceneConfig}
          midsceneReady={midsceneReady}
          onClose={closeSettings}
          onSave={handleSaveSettings}
          onTestMidsceneConnection={testMidsceneConnection}
          onUpdateAgentModelConfig={updateAgentModelConfig}
          onUpdateAppearance={updateAppearance}
          onUpdateMidsceneConfig={updateMidsceneConfig}
          onUpdateRuntimeProfile={updateRuntimeProfile}
          open={isSettingsOpen}
          requiresMidsceneBeforeSave={pendingPage ? isGatedFeaturePage(pendingPage) : false}
          runtimeProfile={runtimeProfile}
        />
      </Suspense>

      <Dialog onOpenChange={(open) => !open && setPendingDeletion(null)} open={Boolean(pendingDeletion)}>
        <DialogContent aria-describedby={undefined} className="max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('app.confirm.deleteTitle')}</DialogTitle>
            {pendingDeletion ? (
              <DialogDescription className="whitespace-pre-line leading-6">
                {pendingDeletion.description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingDeletion(null)} type="button" variant="outline">
              {t('app.confirm.cancel')}
            </Button>
            <Button onClick={confirmPendingDeletion} type="button" variant="destructive">
              <Trash2 className="size-4" />
              {t('app.confirm.deleteAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
    </I18nProvider>
  );
}
