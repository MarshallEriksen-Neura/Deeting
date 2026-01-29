'use client'

import { memo, useState } from 'react'
import {
  FileCode,
  FileJson,
  FileText,
  Eye,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  Code2,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'

interface FileChange {
  id: string
  name: string
  path: string
  type: 'added' | 'modified' | 'deleted'
  extension: string
}

// 模拟数据 - 后续从 store 或 API 获取
const mockFiles: FileChange[] = [
  { id: '1', name: 'create_thejiang_university_intro.js', path: '/create_thejiang_university_intro.js', type: 'added', extension: 'js' },
  { id: '2', name: 'package-lock.json', path: '/package-lock.json', type: 'modified', extension: 'json' },
  { id: '3', name: 'package.json', path: '/package.json', type: 'modified', extension: 'json' },
  { id: '4', name: 'zhejiang_university_intro.docx', path: '/zhejiang_university_intro.docx', type: 'added', extension: 'docx' },
]

const getFileIcon = (extension: string) => {
  switch (extension) {
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
      return FileCode
    case 'json':
      return FileJson
    default:
      return FileText
  }
}

const getTypeIcon = (type: FileChange['type']) => {
  switch (type) {
    case 'added':
      return Plus
    case 'modified':
      return Pencil
    case 'deleted':
      return Trash2
  }
}

const getTypeStyles = (type: FileChange['type']) => {
  switch (type) {
    case 'added':
      return 'text-emerald-500 bg-emerald-500/10'
    case 'modified':
      return 'text-amber-500 bg-amber-500/10'
    case 'deleted':
      return 'text-red-500 bg-red-500/10'
  }
}

function FileChangesPanelInner() {
  const t = useI18n('spec-agent')
  const nodes = useSpecAgentStore((state) => state.nodes)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // 从 nodes 中提取文件信息（如果有的话），否则使用模拟数据
  // TODO: 后续从 API 获取真实文件变更数据
  const files = mockFiles

  const addedCount = files.filter(f => f.type === 'added').length
  const modifiedCount = files.filter(f => f.type === 'modified').length
  const totalCount = files.length

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-card to-card/95">
      {/* Header - 精致毛玻璃效果 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border/30 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-lg',
              'bg-gradient-to-br from-violet-500/20 to-violet-500/10',
              'flex items-center justify-center',
              'ring-1 ring-violet-500/20'
            )}>
              <FolderOpen className="h-3.5 w-3.5 text-violet-500" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('fileChanges.title')}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md',
              'text-[10px] font-medium',
              'bg-muted/50 text-muted-foreground'
            )}>
              {t('fileChanges.files', { count: totalCount })}
            </span>
            {addedCount > 0 && (
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md',
                'text-[10px] font-medium',
                'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              )}>
                <Plus className="h-3 w-3" />
                {addedCount}
              </span>
            )}
            {modifiedCount > 0 && (
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md',
                'text-[10px] font-medium',
                'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              )}>
                <Pencil className="h-3 w-3" />
                {modifiedCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 两列子标题 - 更精致 */}
      <div className="flex-shrink-0 grid grid-cols-2 border-b border-border/20 bg-muted/10">
        <div className="px-4 py-2 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider border-r border-border/20">
          {t('fileChanges.fileList')}
        </div>
        <div className="px-4 py-2 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
          {t('fileChanges.fileContent')}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 grid grid-cols-2 overflow-hidden">
        {/* 文件列表 - 卡片化 */}
        <ScrollArea className="border-r border-border/20">
          <div className="p-3 space-y-1.5">
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
                  <FolderOpen className="h-6 w-6 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground/60">
                  {t('fileChanges.empty')}
                </p>
              </div>
            ) : (
              files.map((file) => {
                const FileIcon = getFileIcon(file.extension)
                const TypeIcon = getTypeIcon(file.type)
                const typeStyles = getTypeStyles(file.type)
                const isSelected = selectedFile === file.id
                return (
                  <button
                    key={file.id}
                    onClick={() => setSelectedFile(file.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left',
                      'transition-all duration-200',
                      'hover:bg-muted/40',
                      'cursor-pointer group',
                      isSelected && 'bg-primary/5 ring-1 ring-primary/20 shadow-sm'
                    )}
                  >
                    {/* 文件图标 */}
                    <div className={cn(
                      'flex-shrink-0 w-8 h-8 rounded-lg',
                      'bg-muted/50 group-hover:bg-muted/70',
                      'flex items-center justify-center',
                      'transition-colors'
                    )}>
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                    </div>

                    {/* 文件名 */}
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground truncate">
                        {file.name}
                      </span>
                      <span className="block text-[10px] text-muted-foreground/60 truncate">
                        {file.path}
                      </span>
                    </div>

                    {/* 类型标记 */}
                    <div className={cn(
                      'flex-shrink-0 w-5 h-5 rounded-md',
                      'flex items-center justify-center',
                      typeStyles
                    )}>
                      <TypeIcon className="h-3 w-3" />
                    </div>

                    {/* 预览图标 */}
                    <Eye className={cn(
                      'h-4 w-4 flex-shrink-0',
                      'text-muted-foreground/40 group-hover:text-muted-foreground/70',
                      'transition-colors'
                    )} />
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>

        {/* 文件预览 - 代码风格 */}
        <ScrollArea className="bg-gradient-to-br from-muted/10 to-muted/5">
          <div className="p-4">
            {selectedFile ? (
              <div className="space-y-3">
                {/* 文件路径 */}
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg',
                  'bg-muted/30 border border-border/20'
                )}>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                  <span className="text-xs text-muted-foreground font-mono">
                    {files.find(f => f.id === selectedFile)?.path}
                  </span>
                </div>

                {/* 代码预览区域 */}
                <div className={cn(
                  'rounded-xl overflow-hidden',
                  'bg-[#1e1e2e] dark:bg-[#0d0d14]',
                  'border border-border/20',
                  'shadow-inner'
                )}>
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                    <Code2 className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                      Preview
                    </span>
                  </div>
                  <pre className="p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                    {/* TODO: 显示文件内容 */}
                    <span className="text-purple-400">const</span> <span className="text-blue-400">greeting</span> = <span className="text-green-400">"Hello World"</span>;
                    {'\n\n'}
                    <span className="text-gray-500">// 文件内容预览...</span>
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <div className="w-14 h-14 rounded-2xl bg-muted/20 flex items-center justify-center mb-4">
                  <Eye className="h-6 w-6 text-muted-foreground/30" />
                </div>
                <p className="text-sm text-muted-foreground/50">
                  选择文件查看内容
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export const FileChangesPanel = memo(FileChangesPanelInner)
