const runtimeIpcChannels = Object.freeze({
  getInfo: 'runtime:get-info',
  runTestCase: 'runtime:run-test-case',
  runSuite: 'runtime:run-suite',
  cancelRun: 'runtime:cancel-run',
  loadRunDetail: 'runtime:load-run-detail',
  planHistoricalRerun: 'runtime:plan-historical-rerun',
  runHistoricalRerun: 'runtime:run-historical-rerun',
  openArtifact: 'runtime:open-artifact',
  exportArtifact: 'runtime:export-artifact',
  attachManualEvidence: 'runtime:attach-manual-evidence',
} as const);

export = { runtimeIpcChannels };
