'use client'

import { memo } from 'react'
import { useI18n } from '@/hooks/use-i18n'
import { useStatusbarState } from '../hooks/use-statusbar-state'
import { StatusProjectInfo } from './statusbar-project'
import { StatusProgress } from './statusbar-progress'
import { StatusControls } from './statusbar-controls'

function StatusbarClient() {
  const t = useI18n('spec-agent')
  const state = useStatusbarState()

  return (
    <div className="h-12 px-4 flex items-center justify-between bg-card border-b border-border">
      <StatusProjectInfo
        label={t('statusbar.project')}
        projectName={state.projectName ?? t('statusbar.projectPlaceholder')}
      />
      <StatusProgress
        statusLabel={
          state.execution?.status
            ? t(`statusbar.status.${state.execution.status}`)
            : t('statusbar.status.drafting')
        }
        costLabel={t('statusbar.costPlaceholder')}
        progress={state.stats.progress}
        nodesLabel={t('statusbar.nodes', {
          completed: state.stats.completed,
          total: state.stats.total,
        })}
      />
      <StatusControls
        t={t}
        pickerOpen={state.pickerOpen}
        setPickerOpen={state.setPickerOpen}
        isLoadingModels={state.isLoadingModels}
        modelGroups={state.modelGroups}
        plannerModel={state.plannerModel}
        selectedModel={state.selectedModel}
        modelVisual={state.modelVisual}
        onModelChange={state.handleModelChange}
        showLaunch={state.showLaunch}
        running={state.running}
        start={state.start}
        startLoading={state.startState.isMutating}
      />
    </div>
  )
}

export default memo(StatusbarClient)
