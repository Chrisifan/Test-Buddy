import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createDemoStudioState,
  createPrdDocumentAsset,
  createRecordingFromGeneratedPath,
  createTestCaseFromGeneratedPath,
} from '../../../shared/studio.js';
import { I18nProvider } from '../../i18n/index.js';
import { DocumentAnalysisPage } from './DocumentAnalysisPage.js';

const state = createDemoStudioState();
const project = state.projects[0];

const renderPage = (
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
  currentProject = project,
  options: {
    onAnalyzeDocument?: (documentId: string) => void;
    onCreateAllCasesFromMatrix?: () => void;
    onCreateAllRecordingsFromMatrix?: () => void;
    onCreateCaseFromPath?: (documentId: string, pathId: string) => void;
    onCreateRecordingFromPath?: (documentId: string, pathId: string) => void;
    onUpdateCoverageTriage?: (
      documentId: string,
      pathId: string,
      target: 'case' | 'recording',
      status: 'deferred' | 'ignored' | undefined,
      note: string,
    ) => void;
    semanticAnalyzingDocumentId?: string | null;
    semanticAnalysisError?: string | null;
  } = {},
) => {
  return render(
    <I18nProvider locale={locale}>
      <DocumentAnalysisPage
        onCreateAllCasesFromDocument={vi.fn()}
        onCreateAllCasesFromMatrix={options.onCreateAllCasesFromMatrix ?? vi.fn()}
        onCreateAllRecordingsFromMatrix={options.onCreateAllRecordingsFromMatrix ?? vi.fn()}
        onAnalyzeDocument={options.onAnalyzeDocument ?? vi.fn()}
        onCreateCaseFromPath={options.onCreateCaseFromPath ?? vi.fn()}
        onCreateDocument={vi.fn()}
        onCreateRecordingFromPath={options.onCreateRecordingFromPath ?? vi.fn()}
        onSelectDocument={vi.fn()}
        onUpdateCoverageTriage={options.onUpdateCoverageTriage}
        onUpdateDocument={vi.fn()}
        project={currentProject}
        semanticAnalysisError={options.semanticAnalysisError ?? null}
        semanticAnalyzingDocumentId={options.semanticAnalyzingDocumentId ?? null}
        selectedDocumentId={currentProject.documents[0]?.id ?? ''}
      />
    </I18nProvider>,
  );
};

describe('DocumentAnalysisPage', () => {
  it('uses Chinese document analysis controls by default', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '需求文档分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '覆盖矩阵' })).toBeInTheDocument();
    expect(screen.getByText('上传新文档')).toBeInTheDocument();
    expect(screen.getByText('最近文档')).toBeInTheDocument();
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
    expect(screen.getByText('Upload New Document')).toBeInTheDocument();
    expect(screen.getByText('RECENT DOCUMENTS')).toBeInTheDocument();
    expect(screen.getByLabelText('dashboard-prd.md source')).toHaveValue(document.sourceText);
    expect(screen.getByText('Coverage Areas')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create Case' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Create Recording' }).length).toBeGreaterThan(0);
  });

  it('shows the originating PRD excerpt for traceable generated paths', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });

    renderPage('zh-CN', { ...project, documents: [document] });

    expect(screen.getByText('需求摘录：')).toBeInTheDocument();
    expect(screen.getByText('成员管理 - 管理员必须能新增成员，并在列表中展示邮箱与状态。')).toBeInTheDocument();
  });

  it('keeps model review as an explicit action and labels the active analysis source', () => {
    const onAnalyzeDocument = vi.fn();
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });

    renderPage('zh-CN', { ...project, documents: [document] }, { onAnalyzeDocument });

    expect(screen.getByText('规则分析')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '模型复核' }));
    expect(onAnalyzeDocument).toHaveBeenCalledWith(document.id);
  });

  it('aggregates document path coverage in the project matrix', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });
    renderPage('zh-CN', { ...project, documents: [document] });

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PRD 覆盖矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '文档' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '写入用例' })).toBeInTheDocument();
  });

  it('writes an uncovered path directly from the coverage matrix', () => {
    const onCreateCaseFromPath = vi.fn();
    const onCreateRecordingFromPath = vi.fn();
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const path = document.generatedPaths[0]!;
    renderPage(
      'zh-CN',
      { ...project, documents: [document] },
      { onCreateCaseFromPath, onCreateRecordingFromPath },
    );

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));
    fireEvent.click(screen.getByRole('button', { name: '写入用例' }));
    fireEvent.click(screen.getByRole('button', { name: '写入录制' }));

    expect(onCreateCaseFromPath).toHaveBeenCalledWith(document.id, path.id);
    expect(onCreateRecordingFromPath).toHaveBeenCalledWith(document.id, path.id);
  });

  it('writes every uncovered case from the coverage matrix in one action', () => {
    const onCreateAllCasesFromMatrix = vi.fn();
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。\n- 管理员必须能停用成员。',
    });
    renderPage('zh-CN', { ...project, documents: [document] }, { onCreateAllCasesFromMatrix });

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));
    fireEvent.click(screen.getByRole('button', { name: /写入全部缺口/ }));

    expect(onCreateAllCasesFromMatrix).toHaveBeenCalledOnce();
  });

  it('creates every uncovered recording from the coverage matrix in one action', () => {
    const onCreateAllRecordingsFromMatrix = vi.fn();
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。\n- 管理员必须能停用成员。',
    });
    renderPage('zh-CN', { ...project, documents: [document] }, { onCreateAllRecordingsFromMatrix });

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));
    fireEvent.click(screen.getByRole('button', { name: /创建全部录制/ }));

    expect(onCreateAllRecordingsFromMatrix).toHaveBeenCalledOnce();
  });

  it('filters the matrix to paths missing test cases', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。',
    });
    const path = document.generatedPaths[0]!;
    const existingCase = createTestCaseFromGeneratedPath({
      documentId: document.id,
      environmentId: project.environments[0]!.id,
      groupId: project.groups[0]!.id,
      path,
      seed: 1,
      url: project.defaultUrl,
    });
    renderPage('zh-CN', { ...project, documents: [document], testCases: [existingCase] });

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));
    fireEvent.click(screen.getByRole('combobox', { name: '覆盖筛选' }));
    fireEvent.click(screen.getByRole('option', { name: '缺少用例' }));

    expect(screen.getByText('没有匹配路径')).toBeInTheDocument();
    expect(screen.getByText('显示 0')).toBeInTheDocument();
  });

  it('requires a local rationale before deferring a PRD coverage target', () => {
    const onUpdateCoverageTriage = vi.fn();
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。',
    });
    const path = document.generatedPaths[0]!;
    renderPage('zh-CN', { ...project, documents: [document] }, { onUpdateCoverageTriage });

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));
    fireEvent.click(screen.getAllByRole('button', { name: '延后' })[0]!);
    expect(screen.getByRole('heading', { name: '延后覆盖项' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存治理决定' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('治理说明'), { target: { value: '等待结算接口联调完成' } });
    fireEvent.click(screen.getByRole('button', { name: '保存治理决定' }));
    expect(onUpdateCoverageTriage).toHaveBeenCalledWith(
      document.id,
      path.id,
      'case',
      'deferred',
      '等待结算接口联调完成',
    );
  });

  it('shows a resolved triage state after a governed target gains coverage', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。',
    });
    const path = document.generatedPaths[0]!;
    const generatedCase = createTestCaseFromGeneratedPath({
      documentId: document.id,
      environmentId: project.environments[0]!.id,
      groupId: project.groups[0]!.id,
      path,
      seed: 1,
      url: project.defaultUrl,
    });
    renderPage('zh-CN', {
      ...project,
      documents: [document],
      testCases: [generatedCase],
      prdCoverageTriage: [{
        documentId: document.id,
        pathId: path.id,
        target: 'case',
        status: 'deferred',
        note: '原先等待接口联调',
        updatedAt: '2026-08-04T00:00:00.000Z',
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: '覆盖矩阵' }));
    expect(screen.getByText('已解决')).toBeInTheDocument();
    expect(screen.getByText('待处理')).toBeInTheDocument();
  });

  it('shows the model provenance and does not enable source editing while review is running', () => {
    const document = {
      ...createPrdDocumentAsset({
        name: 'member-management.md',
        kind: 'markdown' as const,
        size: 120,
        sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
      }),
      analysisMetadata: {
        source: 'model' as const,
        modelName: 'planner-large',
        analyzedAt: new Date().toISOString(),
      },
    };

    renderPage(
      'zh-CN',
      { ...project, documents: [document] },
      { semanticAnalyzingDocumentId: document.id },
    );

    expect(screen.getByText('模型语义分析')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析中' })).toBeDisabled();
    expect(screen.getByLabelText('member-management.md source')).toBeDisabled();
  });

  it('uses the persistent PRD path link for coverage after generated assets are renamed', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const path = document.generatedPaths[0]!;
    const generatedCase = createTestCaseFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      url: project.defaultUrl,
      seed: 1,
    });
    const generatedRecording = createRecordingFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      startUrl: project.defaultUrl,
      seed: 1,
    });

    renderPage('zh-CN', {
      ...project,
      documents: [document],
      testCases: [{ ...generatedCase, name: '成员新增回归' }],
      recordings: [{ ...generatedRecording, name: '成员新增录制' }],
    });

    expect(screen.getByText('已覆盖')).toBeInTheDocument();
    expect(screen.getByText('已有录制')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '写入用例' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '写入录制' })).not.toBeInTheDocument();
  });

  it('guides users to projects instead of exposing an unsaveable intake form', () => {
    const onOpenProjects = vi.fn();

    render(
      <I18nProvider locale="zh-CN">
        <DocumentAnalysisPage
          onCreateAllCasesFromDocument={vi.fn()}
          onCreateAllCasesFromMatrix={vi.fn()}
          onCreateAllRecordingsFromMatrix={vi.fn()}
          onAnalyzeDocument={vi.fn()}
          onCreateCaseFromPath={vi.fn()}
          onCreateDocument={vi.fn()}
          onCreateRecordingFromPath={vi.fn()}
          onOpenProjects={onOpenProjects}
          onSelectDocument={vi.fn()}
          onUpdateDocument={vi.fn()}
          semanticAnalysisError={null}
          semanticAnalyzingDocumentId={null}
          selectedDocumentId=""
        />
      </I18nProvider>,
    );

    expect(screen.getByText('选择一个项目')).toBeInTheDocument();
    expect(screen.queryByText('上传新文档')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });
});
