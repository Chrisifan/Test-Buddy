import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createInitialStudioState, createPrdDocumentAsset } from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { DocumentAnalysisPage } from './DocumentAnalysisPage.js';

const state = createInitialStudioState();
const project = state.projects[0];

function renderPage(locale: 'zh-CN' | 'en-US' = 'zh-CN', currentProject = project) {
  return render(
    <I18nProvider locale={locale}>
      <DocumentAnalysisPage
        onCreateAllCasesFromDocument={vi.fn()}
        onCreateCaseFromPath={vi.fn()}
        onCreateDocument={vi.fn()}
        onCreateRecordingFromPath={vi.fn()}
        onSelectDocument={vi.fn()}
        onUpdateDocument={vi.fn()}
        project={currentProject}
        selectedDocumentId={currentProject.documents[0]?.id ?? ''}
      />
    </I18nProvider>,
  );
}

describe('DocumentAnalysisPage', () => {
  it('uses Chinese document analysis controls by default', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '需求文档分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '筛选' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最新优先' })).toBeInTheDocument();
    expect(screen.getByText('上传新文档')).toBeInTheDocument();
    expect(screen.queryByText('Upload New Document')).not.toBeInTheDocument();
  });

  it('switches document analysis actions to English', () => {
    const document = createPrdDocumentAsset({
      name: 'dashboard-prd.md',
      kind: 'markdown',
      size: 120,
      sourceText: 'Dashboard users can filter charts. The result table supports sorting and pagination.',
    });
    renderPage('en-US', { ...project, documents: [document] });

    expect(screen.getByRole('heading', { level: 1, name: 'Requirements Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze and Generate Paths' })).toBeInTheDocument();
    expect(screen.getByText('Supports text, Markdown, and text-based PDF files.')).toBeInTheDocument();
    expect(screen.getByLabelText('Document Name')).toHaveValue('Dashboard PRD.md');
    expect(screen.getByText('Coverage Areas')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create Case' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Create Recording' }).length).toBeGreaterThan(0);
  });
});
