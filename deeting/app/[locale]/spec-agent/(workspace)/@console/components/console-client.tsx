'use client'

import { memo } from 'react'
import { useI18n } from '@/hooks/use-i18n'
import { ConsoleHeader } from './console-header'
import { ConsoleMessageList } from './console-message-list'
import { ConsoleInput } from './console-input'
import { useConsoleState } from '../hooks/use-console-state'

function ConsoleClient() {
  const t = useI18n('spec-agent')
  const state = useConsoleState(t)

  return (
    <div className="h-full flex flex-col">
      <ConsoleHeader
        title={t('console.title')}
        historyLabel={t('history.title')}
        historyOpen={state.historyOpen}
        onHistoryOpenChange={state.setHistoryOpen}
        items={state.historyItems}
        isLoading={state.historyLoading}
        isLoadingMore={state.historyLoadingMore}
        hasMore={state.historyHasMore}
        loadingPlanId={state.loadingPlanId}
        historyError={state.historyError}
        onLoadMore={state.loadMoreHistory}
        onSelectPlan={state.handleSelectPlan}
        resolvePlanStatus={state.resolvePlanStatus}
      />

      <ConsoleMessageList
        t={t}
        messages={state.messages}
        hasMessages={state.hasMessages}
        activeNode={state.activeNode}
      />

      <ConsoleInput
        value={state.input}
        placeholder={t('console.input.placeholder')}
        onChange={state.setInput}
        onKeyDown={state.handleKeyPress}
        onSend={state.handleSend}
      />
    </div>
  )
}

export default memo(ConsoleClient)
