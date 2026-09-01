import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, FilePlus2, PencilLine, Plus, Route, X } from 'lucide-react';

import {
  createEmptyReusableFlowAsset,
  createNextReusableFlowVersion,
  analyzeReusableFlowImpact,
  findReusableFlowAsset,
  planReusableFlowCaseUpgrade,
  validateReusableFlow,
  type ProjectDraft,
  type ReusableFlowAsset,
  type VersionedTestAssetReference,
} from '../../../shared/studio.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { EvidenceCard, PageBody, PageHeader, PageShell, ProjectRequiredState, Surface } from '../../components/workbench.js';
import { useI18n } from '../../i18n/index.js';

const referenceKey = (reference: VersionedTestAssetReference): string => {
  return `${reference.id}@${reference.version}`;
};

export const ReusableFlowsPage = ({
  project,
  selectedReference,
  onSelectFlow,
  onPublishFlow,
  onOpenProjects,
  onUpgradeCases,
}: {
  project?: ProjectDraft;
  selectedReference?: VersionedTestAssetReference;
  onSelectFlow: (reference: VersionedTestAssetReference) => void;
  onPublishFlow: (flow: ReusableFlowAsset) => void;
  onOpenProjects?: () => void;
  onUpgradeCases?: (source: VersionedTestAssetReference, target: VersionedTestAssetReference, selected: VersionedTestAssetReference[]) => void;
}) => {
  const { t } = useI18n();
  const selected = project && selectedReference ? findReusableFlowAsset(project, selectedReference) : undefined;
  const [draft, setDraft] = useState<ReusableFlowAsset>();
  const editor = draft ?? selected;
  const issues = useMemo(() => editor ? validateReusableFlow(editor) : [], [editor]);
  const isSavedVersion = Boolean(selected && !draft);
  const [targetVersion, setTargetVersion] = useState<number>();
  const [upgradeSelection, setUpgradeSelection] = useState<VersionedTestAssetReference[]>();

  useEffect(() => {
    setDraft(undefined);
    setUpgradeSelection(undefined);
  }, [project?.id, selectedReference?.id, selectedReference?.version]);
  useEffect(() => {
    if (!selected) {
      setTargetVersion(undefined);
      return;
    }
    const latest = project?.reusableFlows
      .filter((flow) => flow.id === selected.id && flow.version > selected.version)
      .sort((left, right) => right.version - left.version)[0];
    setTargetVersion(latest?.version);
  }, [project?.reusableFlows, selected?.id, selected?.version]);

  if (!project) {
    return <PageShell><PageHeader title={t('flows.header.title')} /><PageBody><ProjectRequiredState actionLabel={t('flows.empty.openProjects')} description={t('flows.empty.description')} onOpenProjects={onOpenProjects} title={t('flows.empty.title')} /></PageBody></PageShell>;
  }
  const currentProject = project;
  const targetFlows = selected
    ? currentProject.reusableFlows
      .filter((flow) => flow.id === selected.id && flow.version > selected.version)
      .sort((left, right) => left.version - right.version)
    : [];
  const targetFlow = targetFlows.find((flow) => flow.version === targetVersion);
  const targetReference = selected && targetFlow ? { id: selected.id, version: targetFlow.version } : undefined;
  const impact = selected && targetReference ? analyzeReusableFlowImpact(currentProject, selected, targetReference) : undefined;
  const upgradePlan = selected && targetReference && upgradeSelection
    ? planReusableFlowCaseUpgrade(currentProject, selected, targetReference, upgradeSelection)
    : undefined;
  const draftVersion = draft && selected
    ? currentProject.reusableFlows
      .filter((flow) => flow.id === selected.id)
      .reduce((highestVersion, flow) => Math.max(highestVersion, flow.version), selected.version) + 1
    : editor?.version;

  const createDraft = () => {
    setDraft(createEmptyReusableFlowAsset(currentProject.reusableFlows.length + 1));
  };

  const editAsNewVersion = () => {
    if (!selected) return;
    setDraft(structuredClone(selected));
  };

  const updateDraft = (updater: (flow: ReusableFlowAsset) => ReusableFlowAsset) => {
    const current = draft ?? selected;
    if (current) setDraft(updater(current));
  };

  const addNavigationStep = () => {
    updateDraft((flow) => ({
      ...flow,
      steps: [...flow.steps, {
        id: `flow-step-${Date.now()}`,
        type: 'ai',
        title: t('flows.step.navigateTitle'),
        body: t('flows.step.navigateBody'),
        execution: {
          schemaVersion: 2,
          intent: t('flows.step.navigateBody'),
          reviewStatus: 'confirmed',
          actionRisk: 'low',
          action: { kind: 'navigate', url: currentProject.defaultUrl },
        },
      }],
    }));
  };

  const publish = () => {
    if (!draft || issues.length) return;
    const published = selected && selected.id === draft.id
      ? createNextReusableFlowVersion(currentProject, selected, {
          name: draft.name,
          description: draft.description,
          tags: draft.tags,
          steps: draft.steps,
        })
      : { ...draft, version: 1, updatedAt: new Date().toISOString() };
    onPublishFlow(published);
    onSelectFlow({ id: published.id, version: published.version });
    setDraft(undefined);
  };

  const openUpgradeConfirmation = () => {
    if (!impact) return;
    const latestCases = new Map<string, VersionedTestAssetReference>();
    impact.directCases.forEach((item) => {
      const previous = latestCases.get(item.reference.id);
      if (!previous || item.reference.version > previous.version) {
        latestCases.set(item.reference.id, item.reference);
      }
    });
    setUpgradeSelection([...latestCases.values()]);
  };

  const toggleUpgradeCase = (reference: VersionedTestAssetReference, checked: boolean) => {
    setUpgradeSelection((current) => {
      const selectedCases = current ?? [];
      if (checked) {
        return selectedCases.some((candidate) => referenceKey(candidate) === referenceKey(reference))
          ? selectedCases
          : [...selectedCases, reference];
      }
      return selectedCases.filter((candidate) => referenceKey(candidate) !== referenceKey(reference));
    });
  };

  const confirmUpgrade = () => {
    if (!selected || !targetReference || !upgradeSelection?.length || !onUpgradeCases || upgradePlan?.issues.length) return;
    onUpgradeCases({ id: selected.id, version: selected.version }, targetReference, upgradeSelection);
    setUpgradeSelection(undefined);
  };

  return (
    <PageShell>
      <PageHeader
        action={<div className="flex items-center gap-2"><Button onClick={createDraft} type="button" variant="outline"><Plus className="size-4" />{t('flows.action.create')}</Button>{isSavedVersion ? <Button onClick={editAsNewVersion} type="button" variant="outline"><PencilLine className="size-4" />{t('flows.action.editVersion')}</Button> : null}{draft ? <Button disabled={Boolean(issues.length)} onClick={publish} type="button"><Check className="size-4" />{t('flows.action.publish')}</Button> : null}</div>}
        meta={editor ? <Badge variant="outline">v{draftVersion}{draft ? t('flows.meta.draft') : ''}</Badge> : undefined}
        title={t('flows.header.title')}
      />
      <PageBody className="min-h-0">
        <div className="grid min-h-[34rem] gap-3 xl:grid-cols-[minmax(13rem,.7fr)_minmax(25rem,1.5fr)_minmax(15rem,.7fr)]">
          <Surface className="flex min-h-0 flex-col p-2" variant="panel">
            <div className="flex items-center justify-between px-2 py-2"><div><h2 className="text-sm font-semibold">{t('flows.inventory.title')}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t('flows.inventory.description')}</p></div><Badge variant="outline">{project.reusableFlows.length}</Badge></div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-1">
              {project.reusableFlows.map((flow) => <button className={`w-full rounded-[4px] border-l-2 px-3 py-2 text-left transition-colors ${referenceKey(flow) === referenceKey(selectedReference ?? { id: '', version: 0 }) && !draft ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-muted/60'}`} key={referenceKey(flow)} onClick={() => onSelectFlow({ id: flow.id, version: flow.version })} type="button"><span className="block truncate text-sm font-semibold">{flow.name}</span><span className="mt-1 flex justify-between text-xs text-muted-foreground"><span>v{flow.version}</span><span>{flow.steps.length} {t('flows.inventory.steps')}</span></span></button>)}
              {!project.reusableFlows.length ? <p className="px-2 py-4 text-sm leading-6 text-muted-foreground">{t('flows.inventory.empty')}</p> : null}
            </div>
          </Surface>
          <Surface className="min-w-0 p-4" variant="panel">
            {editor ? <div className="grid gap-5"><div className="grid gap-2"><Label htmlFor="flow-name">{t('flows.form.name')}</Label><Input disabled={!draft} id="flow-name" onChange={(event) => updateDraft((flow) => ({ ...flow, name: event.target.value }))} value={editor.name} /></div><div className="grid gap-2"><Label htmlFor="flow-description">{t('flows.form.description')}</Label><Textarea disabled={!draft} id="flow-description" onChange={(event) => updateDraft((flow) => ({ ...flow, description: event.target.value }))} value={editor.description} /></div><section className="border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{t('flows.steps.title')}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t('flows.steps.description')}</p></div>{draft ? <Button onClick={addNavigationStep} size="sm" type="button" variant="outline"><Route className="size-3.5" />{t('flows.action.addNavigate')}</Button> : null}</div><div className="mt-3 grid gap-2">{editor.steps.map((step) => <div className="flex items-center justify-between gap-3 rounded-[4px] border border-border px-3 py-2" key={step.id}><span className="min-w-0 truncate text-sm">{step.title}</span>{draft ? <Button aria-label={t('flows.action.removeStep', { title: step.title })} onClick={() => updateDraft((flow) => ({ ...flow, steps: flow.steps.filter((candidate) => candidate.id !== step.id) }))} size="icon" type="button" variant="ghost"><X className="size-4" /></Button> : null}</div>)}{!editor.steps.length ? <p className="rounded-[4px] border border-dashed border-border p-3 text-sm text-muted-foreground">{t('flows.steps.empty')}</p> : null}</div></section></div> : <EvidenceCard description={t('flows.editor.empty.description')} title={t('flows.editor.empty.title')} />}
          </Surface>
          <aside className="grid content-start gap-3"><Surface className="p-4" variant="evidence"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{t('flows.validation.title')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('flows.validation.description')}</p></div>{editor ? <Badge variant="outline">{issues.length ? t('flows.validation.blocked') : t('flows.validation.ready')}</Badge> : null}</div>{issues.length ? <div className="mt-3 grid gap-2">{issues.map((issue, index) => <p className="flex gap-2 text-xs leading-5 text-destructive" key={`${issue.kind}-${index}`}><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{issue.message}</p>)}</div> : editor ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('flows.validation.pinned')}</p> : null}</Surface>{impact && selected && targetReference ? <Surface className="p-4" variant="panel"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">{t('flows.impact.title')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('flows.impact.description')}</p></div><Badge variant="outline">{impact.directCases.length}</Badge></div><div className="mt-3 grid gap-3 border-y border-border py-3"><div><p className="text-xs font-medium text-muted-foreground">{t('flows.impact.source')}</p><p className="mt-1 text-sm font-semibold">{selected.name} v{selected.version}</p></div><div className="grid gap-1.5"><Label id="flow-target-version">{t('flows.impact.target')}</Label><Select onValueChange={(value) => setTargetVersion(Number(value))} value={String(targetReference.version)}><SelectTrigger aria-labelledby="flow-target-version"><SelectValue /></SelectTrigger><SelectContent>{targetFlows.map((flow) => <SelectItem key={referenceKey(flow)} value={String(flow.version)}>{flow.name} v{flow.version}</SelectItem>)}</SelectContent></Select></div></div><div className="mt-3 grid gap-3">{impact.directCases.map((item) => <section className="grid gap-2 border-b border-border pb-3 text-xs last:border-0 last:pb-0" key={referenceKey(item.reference)}><div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate font-semibold">{item.testCase.name}</p><span className="shrink-0 text-muted-foreground">v{item.reference.version}</span></div><div><p className="font-medium text-muted-foreground">{t('flows.impact.flowDiff', { source: referenceKey(selected), target: referenceKey(targetReference) })}</p></div><div><p className="font-medium text-muted-foreground">{t('flows.impact.fixtures')}</p><p className="mt-1 break-all">{item.fixtures.length ? item.fixtures.map(referenceKey).join(', ') : t('flows.impact.noFixtures')}</p></div><div><p className="font-medium text-muted-foreground">{t('flows.impact.baseline')}</p><p className="mt-1 break-all">{item.baseline ? referenceKey(item.baseline) : t('flows.impact.noBaseline')}</p></div><div><p className="font-medium text-muted-foreground">{t('flows.impact.suites')}</p>{item.suites.length ? <div className="mt-1 grid gap-1">{item.suites.map((suite) => <p className="break-all" key={referenceKey(suite)}>{referenceKey(suite)}</p>)}</div> : <p className="mt-1">{t('flows.impact.noSuites')}</p>}</div></section>)}{!impact.directCases.length ? <p className="text-xs text-muted-foreground">{t('flows.impact.none')}</p> : null}</div>{onUpgradeCases && targetReference.version !== selected.version && impact.directCases.length ? <Button className="mt-3 w-full" onClick={openUpgradeConfirmation} type="button"><FilePlus2 className="size-4" />{t('flows.impact.upgrade')}</Button> : null}</Surface> : null}</aside>
        </div>
      </PageBody>
      <Dialog onOpenChange={(open) => !open && setUpgradeSelection(undefined)} open={Boolean(upgradeSelection)}>
        <DialogContent className="max-h-[min(640px,calc(100vh-32px))] w-[min(560px,calc(100vw-32px))] overflow-y-auto p-5 sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-base">{t('flows.upgrade.title')}</DialogTitle>
            {selected && targetReference ? <DialogDescription>{t('flows.upgrade.description', { source: `${selected.name} v${selected.version}`, target: `${targetFlow?.name ?? selected.name} v${targetReference.version}` })}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-3">
            {upgradePlan?.issues.length ? <div className="grid gap-1 rounded-[4px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive" role="alert"><p className="font-semibold">{t('flows.upgrade.selectionBlocked')}</p>{upgradePlan.issues.map((issue, index) => <p key={`${issue.kind}-${referenceKey(issue.reference)}-${index}`}>{issue.message}</p>)}</div> : null}
            <div className="grid gap-2">
              {impact?.directCases.map((item) => {
                const checked = Boolean(upgradeSelection?.some((reference) => referenceKey(reference) === referenceKey(item.reference)));
                const checkboxId = `flow-upgrade-${item.reference.id}-${item.reference.version}`;
                return <label className="flex cursor-pointer items-center gap-3 rounded-[4px] border border-border px-3 py-2 text-sm" htmlFor={checkboxId} key={referenceKey(item.reference)}><Checkbox aria-label={t('flows.upgrade.case', { name: item.testCase.name, version: item.reference.version })} checked={checked} id={checkboxId} onCheckedChange={(nextChecked) => toggleUpgradeCase(item.reference, Boolean(nextChecked))} /><span className="min-w-0 flex-1 truncate">{item.testCase.name} <span className="text-muted-foreground">v{item.reference.version}</span></span></label>;
              })}
            </div>
            <section className="border-t border-border pt-3"><p className="text-sm font-semibold">{t('flows.upgrade.suitesTitle')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('flows.upgrade.suitesImmutable')}</p>{upgradePlan?.suiteProposals.length ? <div className="mt-3 grid gap-2">{upgradePlan.suiteProposals.map((proposal) => { const suite = currentProject.suites.find((item) => referenceKey(item) === referenceKey(proposal.suite)); const testCase = upgradePlan.updatedCases.find((item) => item.id === proposal.caseReference.id && item.version === proposal.caseReference.version); return <div className="flex items-center justify-between gap-3 rounded-[4px] border border-border px-3 py-2 text-xs" key={`${referenceKey(proposal.suite)}-${referenceKey(proposal.caseReference)}`}><span className="min-w-0 truncate font-medium">{suite?.name ?? proposal.suite.id} v{proposal.suite.version}</span><span className="shrink-0 text-muted-foreground">{testCase?.name ?? proposal.caseReference.id} v{proposal.caseReference.version}</span></div>; })}</div> : <p className="mt-3 text-xs text-muted-foreground">{t('flows.upgrade.suitesNone')}</p>}</section>
          </div>
          <DialogFooter>
            <Button onClick={() => setUpgradeSelection(undefined)} type="button" variant="outline">{t('flows.upgrade.cancel')}</Button>
            <Button disabled={!upgradeSelection?.length || Boolean(upgradePlan?.issues.length)} onClick={confirmUpgrade} type="button"><FilePlus2 className="size-4" />{t('flows.upgrade.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};
