import { lazy } from 'react';

const pageComponentLoaders = {
  projects: () =>
    import('../features/project/ProjectManagementPage.js').then(({ ProjectManagementPage: Page }) => ({ default: Page })),
  documents: () =>
    import('../features/documents/DocumentAnalysisPage.js').then(({ DocumentAnalysisPage: Page }) => ({ default: Page })),
  cases: () =>
    import('../features/cases/TestCaseManagementPage.js').then(({ TestCaseManagementPage: Page }) => ({ default: Page })),
  suites: () =>
    import('../features/suites/SuiteManagementPage.js').then(({ SuiteManagementPage: Page }) => ({ default: Page })),
  flows: () =>
    import('../features/flows/ReusableFlowsPage.js').then(({ ReusableFlowsPage: Page }) => ({ default: Page })),
  runs: () =>
    import('../features/runs/RunRecordsPage.js').then(({ RunRecordsPage: Page }) => ({ default: Page })),
  maintenance: () =>
    import('../features/maintenance/MaintenanceQueuePage.js').then(({ MaintenanceQueuePage: Page }) => ({ default: Page })),
  nl: () =>
    import('../features/natural-language/NaturalLanguagePage.js').then(({ NaturalLanguagePage: Page }) => ({ default: Page })),
  workflow: () =>
    import('../features/workflow/WorkflowPage.js').then(({ WorkflowPage: Page }) => ({ default: Page })),
  recording: () =>
    import('../features/recording/RecordingPage.js').then(({ RecordingPage: Page }) => ({ default: Page })),
  settings: () =>
    import('../features/settings/SettingsModal.js').then(({ SettingsModal: Modal }) => ({ default: Modal })),
} as const;

export type PageComponentKey = keyof typeof pageComponentLoaders;

export const loadPageComponent = <Key extends PageComponentKey>(key: Key) => {
  return pageComponentLoaders[key]();
};

export const ProjectManagementPage = lazy(pageComponentLoaders.projects);
export const DocumentAnalysisPage = lazy(pageComponentLoaders.documents);
export const TestCaseManagementPage = lazy(pageComponentLoaders.cases);
export const SuiteManagementPage = lazy(pageComponentLoaders.suites);
export const ReusableFlowsPage = lazy(pageComponentLoaders.flows);
export const RunRecordsPage = lazy(pageComponentLoaders.runs);
export const MaintenanceQueuePage = lazy(pageComponentLoaders.maintenance);
export const NaturalLanguagePage = lazy(pageComponentLoaders.nl);
export const WorkflowPage = lazy(pageComponentLoaders.workflow);
export const RecordingPage = lazy(pageComponentLoaders.recording);
export const SettingsModal = lazy(pageComponentLoaders.settings);
