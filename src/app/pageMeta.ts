export type AppPage =
  | 'home'
  | 'projects'
  | 'documents'
  | 'cases'
  | 'runs'
  | 'nl'
  | 'workflow'
  | 'recording';

export const pageMeta: Record<
  Exclude<AppPage, 'home' | 'projects' | 'documents' | 'cases' | 'runs'>,
  {
    title: string;
    description: string;
    cta: string;
  }
> = {
  nl: {
    title: '自然语言测试',
    description: '直接用自然语言对页面发出动作、断言与提取指令。',
    cta: '进入自然语言测试',
  },
  workflow: {
    title: '流程编排测试',
    description: '把有效指令沉淀成可回归的测试流程并执行。',
    cta: '进入流程编排',
  },
  recording: {
    title: '操作录制回放',
    description: '录制浏览器操作并回放，后续可转译成可维护测试资产。',
    cta: '进入录制回放',
  },
};
