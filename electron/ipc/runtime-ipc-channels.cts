const runtimeIpcChannels = Object.freeze({
  getInfo: 'runtime:get-info',
  runTestCase: 'runtime:run-test-case',
  runSuite: 'runtime:run-suite',
  cancelRun: 'runtime:cancel-run',
  loadRunDetail: 'runtime:load-run-detail',
  loadSuiteRunRecord: 'runtime:load-suite-run-record',
  listMaintenanceDrafts: 'runtime:list-maintenance-drafts',
  createMaintenanceDraft: 'runtime:create-maintenance-draft',
  acceptMaintenanceDraft: 'runtime:accept-maintenance-draft',
  rejectMaintenanceDraft: 'runtime:reject-maintenance-draft',
  openMaintenanceEvidence: 'runtime:open-maintenance-evidence',
  planArtifactRetention: 'runtime:plan-artifact-retention',
  confirmArtifactRetention: 'runtime:confirm-artifact-retention',
  planHistoricalRerun: 'runtime:plan-historical-rerun',
  runHistoricalRerun: 'runtime:run-historical-rerun',
  openArtifact: 'runtime:open-artifact',
  exportArtifact: 'runtime:export-artifact',
  attachManualEvidence: 'runtime:attach-manual-evidence',
} as const);

export = { runtimeIpcChannels };
