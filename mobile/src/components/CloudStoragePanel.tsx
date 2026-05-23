import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Download, File, FolderOpen, FolderPlus, MessageSquareQuote, Search, Trash2, Upload, X } from 'lucide-react'
import { useDetailPanel } from '../../../../../beeseed-sdk/src/hooks/use-detail-panel.js'
import { useStorage } from '../../../../../beeseed-sdk/src/hooks/use-storage.js'
import { cn } from '../../../../../beeseed-sdk/src/lib/cn.js'
import { formatBytes } from '../../../../../beeseed-sdk/src/lib/format.js'
import { Button } from '../../../../../beeseed-sdk/src/components/ui/button.js'
import { Input } from '../../../../../beeseed-sdk/src/components/ui/input.js'
import { StorageFileIcon, StoragePreviewDialog, storageFileLabelForRef } from '../../../../../beeseed-sdk/src/components/chat/StorageAttachmentPreview.js'

interface Props {
  channelId: string | null
  className?: string
  onReference?: () => void
}

interface DraftDirectory {
  id: number
  prefix: string
  defaultName: string
  name: string
  creating: boolean
}

function storageDisplayName(obj: { key: string; name?: string; display_name?: string }) {
  return obj.display_name || obj.name || obj.key.split('/').pop() || obj.key
}

function storageRefFromKey(key: string) {
  return `storage://${key.replace(/^\/+/, '')}`
}

function directoryDisplayName(dir: string) {
  return dir.replace(/\/$/, '').split('/').pop() || dir
}

function nextDirectoryName(directories: string[]) {
  const existing = new Set(directories.map(directoryDisplayName))
  const base = '新建文件夹'
  if (!existing.has(base)) return base

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`
    if (!existing.has(candidate)) return candidate
  }

  return `${base} ${Date.now()}`
}

function storageItemTone(refText: string) {
  const label = storageFileLabelForRef(refText)
  if (/图片|图像|image/i.test(label)) return 'from-[#ff7eb3] to-[#ffca3a]'
  if (/表格|excel|csv|sheet/i.test(label)) return 'from-[#7ee8b5] to-[#25d366]'
  if (/pdf|文档|文本|doc|txt/i.test(label)) return 'from-[#7ee7ff] to-[#7c5cff]'
  return 'from-[#fff16a] to-[#ff9f1c]'
}

export function CloudStoragePanel({ channelId, className, onReference }: Props) {
  const { insertIntoComposer, setActiveFeature, setPanel } = useDetailPanel()
  const {
    objects,
    directories,
    currentPrefix,
    loading,
    uploading,
    uploadProgress,
    uploadError,
    policy,
    usage,
    canUpload,
    searchQuery,
    breadcrumbs,
    browse,
    createDirectory,
    uploadFile,
    downloadFile,
    deleteFile,
    clearUploadError,
    setSearchQuery,
  } = useStorage(channelId)
  const fileRef = useRef<HTMLInputElement>(null)
  const draftInputRef = useRef<HTMLInputElement>(null)
  const committingDraftRef = useRef(false)
  const skipNextDraftBlurRef = useRef(false)
  const [draftDirectory, setDraftDirectory] = useState<DraftDirectory | null>(null)
  const [previewRef, setPreviewRef] = useState<string | null>(null)

  useEffect(() => {
    if (!draftDirectory || draftDirectory.creating) return
    const timer = window.setTimeout(() => {
      draftInputRef.current?.focus()
      draftInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [draftDirectory])

  useEffect(() => {
    setDraftDirectory(null)
  }, [channelId, currentPrefix])

  if (!channelId) {
    return (
      <div className="mobile-game-storage-empty flex flex-1 items-center justify-center px-6 text-center text-sm font-black text-[#6a4c93]">
        选择一个对话查看背包
      </div>
    )
  }

  async function handleUpload(file: File | undefined) {
    if (!file || !canUpload) return
    try {
      await uploadFile(file, currentPrefix)
    } catch {
      // The store owns the visible upload error state.
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDownload(key: string) {
    const url = await downloadFile(key)
    if (url) window.open(url, '_blank')
  }

  function startCreateDirectory() {
    if (!canUpload || uploading) return
    if (draftDirectory && !draftDirectory.creating) {
      draftInputRef.current?.focus()
      draftInputRef.current?.select()
      return
    }

    const defaultName = nextDirectoryName(directories)
    setDraftDirectory({
      id: Date.now(),
      prefix: currentPrefix,
      defaultName,
      name: defaultName,
      creating: false,
    })
  }

  async function commitDraftDirectory() {
    if (!draftDirectory || draftDirectory.creating || committingDraftRef.current) return

    committingDraftRef.current = true
    const name = draftDirectory.name.trim() || draftDirectory.defaultName
    setDraftDirectory({ ...draftDirectory, name, creating: true })
    try {
      await createDirectory(name, draftDirectory.prefix)
      setDraftDirectory(null)
    } catch {
      setDraftDirectory({ ...draftDirectory, name, creating: false })
    } finally {
      committingDraftRef.current = false
    }
  }

  function cancelDraftDirectory() {
    if (!draftDirectory?.creating) setDraftDirectory(null)
  }

  function handleReference(key: string) {
    insertIntoComposer(storageRefFromKey(key))
    setActiveFeature('chat')
    setPanel(true)
    onReference?.()
  }

  const hasEntries = !!draftDirectory || directories.length > 0 || objects.length > 0
  const itemCount = directories.length + objects.length
  const currentLocation = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1]!.label : '根目录'

  return (
    <div className={cn('mobile-game-storage flex-1 flex flex-col overflow-hidden', className)} data-testid="cloud-storage-panel">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="mobile-game-storage-hero">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-tight text-[#5f3b93]">冒险背包</div>
            <div className="mt-1 text-xs font-bold text-[#9b6ccf]">
              {policy.visibility === 'shared' ? '队伍共享仓库' : '个人仓库'} · 已用 {formatBytes(usage.bytes)}
            </div>
          </div>
          <div className="mobile-game-storage-count">
            <span className="text-lg font-black">{itemCount}</span>
            <span className="text-[10px] font-black">件道具</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" className="mobile-game-storage-action" disabled={uploading || !canUpload} onClick={startCreateDirectory}>
            <FolderPlus className="h-4 w-4" />
            新建宝箱
          </Button>
          <Button data-testid="storage-upload-button" size="sm" variant="outline" className="mobile-game-storage-action" disabled={uploading || !canUpload} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {uploading ? '上传中' : canUpload ? '上传道具' : '只读'}
          </Button>
        </div>
        <input ref={fileRef} data-testid="storage-upload-input" type="file" className="hidden" onChange={(e) => void handleUpload(e.target.files?.[0])} />

        <div className="mobile-game-storage-search relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7c5cff]" />
          <Input
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 border-0 bg-transparent pl-9 pr-3 text-sm font-bold text-[#5f3b93] placeholder:text-[#b18bdc] focus-visible:ring-0"
          />
        </div>
      </div>

      <div className="mobile-game-storage-breadcrumbs mx-4 flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-2 text-xs font-black text-[#6a4c93]">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span>/</span>}
            <button onClick={() => browse(crumb.prefix)} className="transition-colors hover:text-[#7c5cff]">
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {(uploading || uploadError) && (
        <div className="shrink-0 px-4 py-2">
          {uploading ? (
            <div className="mobile-game-storage-notice space-y-1.5">
              <div className="flex items-center justify-between text-xs font-black text-[#5f3b93]">
                <span>正在把道具放入背包</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-gradient-to-r from-[#ff7eb3] to-[#7c5cff] transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          ) : (
            <div className="mobile-game-storage-notice flex items-center gap-2 text-xs font-bold text-[#aa2d00]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{uploadError}</span>
              <button className="rounded p-0.5 hover:bg-destructive/10" onClick={clearUploadError} aria-label="关闭错误">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {loading ? (
          <div className="mobile-game-storage-empty py-12 text-center text-sm font-bold text-[#6a4c93]">正在翻找背包...</div>
        ) : !hasEntries ? (
          <div className="mobile-game-storage-empty flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center" data-testid="storage-empty-state">
            <div className="mobile-game-storage-empty-icon">
              <File className="h-6 w-6 text-[#5f3b93]" />
            </div>
            <div>
              <div className="text-sm font-black text-[#5f3b93]">{currentLocation} 暂无道具</div>
              <div className="mt-1 text-xs font-bold text-[#9b6ccf]">上传文件或新建宝箱后会出现在这里。</div>
            </div>
            <Button data-testid="storage-empty-upload-button" size="sm" variant="outline" className="mobile-game-storage-action w-full max-w-[12rem]" disabled={uploading || !canUpload} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" />
              {canUpload ? '上传文件' : '只读空间'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {draftDirectory && (
              <div className="mobile-game-storage-card flex items-center gap-3">
                <div className="mobile-game-storage-folder-icon">
                  <FolderOpen className="h-5 w-5 text-[#7a3f38]" />
                </div>
                <Input
                  ref={draftInputRef}
                  value={draftDirectory.name}
                  disabled={draftDirectory.creating}
                  aria-label="文件夹名称"
                  className="mobile-game-storage-inline-input h-9 min-w-0 flex-1 text-sm"
                  onChange={(e) => setDraftDirectory({ ...draftDirectory, name: e.target.value })}
                  onBlur={() => {
                    if (skipNextDraftBlurRef.current) {
                      skipNextDraftBlurRef.current = false
                      return
                    }
                    void commitDraftDirectory()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitDraftDirectory()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      skipNextDraftBlurRef.current = true
                      cancelDraftDirectory()
                    }
                  }}
                />
                {draftDirectory.creating && <span className="text-xs font-bold text-[#9b6ccf]">创建中...</span>}
              </div>
            )}

            {directories.map((dir) => (
              <button
                key={dir}
                onClick={() => browse(dir)}
                className="mobile-game-storage-card flex w-full items-center gap-3 text-left transition-transform active:translate-y-0.5"
              >
                <div className="mobile-game-storage-folder-icon">
                  <FolderOpen className="h-5 w-5 text-[#7a3f38]" />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-[#5f3b93]">{directoryDisplayName(dir)}</span>
                  <span className="block text-[11px] font-bold text-[#9b6ccf]">宝箱 · 点开查看</span>
                </span>
              </button>
            ))}

            {objects.map((obj) => {
              const refText = storageRefFromKey(obj.key)
              const displayName = storageDisplayName(obj)
              const itemTone = storageItemTone(refText)
              return (
                <div
                  key={obj.key}
                  className="mobile-game-storage-card group"
                  data-testid="storage-file-row"
                  data-storage-key={obj.key}
                  data-storage-file-name={displayName}
                >
                  <button
                    data-testid="storage-file-preview"
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
                    onClick={() => setPreviewRef(refText)}
                    title="预览文件"
                  >
                    <div className={cn('mobile-game-storage-file-icon bg-gradient-to-br', itemTone)}>
                      <StorageFileIcon refText={refText} className="h-5 w-5 text-[#5f3b93]" />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-[#5f3b93]">{displayName}</span>
                      <span className="block truncate text-[11px] font-bold text-[#9b6ccf]">
                        {storageFileLabelForRef(refText)} · {formatBytes(obj.size)} · {new Date(obj.last_modified).toLocaleDateString('zh-CN')}
                      </span>
                    </span>
                  </button>
                  <div className="mobile-game-storage-card-actions">
                    <button data-testid="storage-file-reference" title="引用到聊天" onClick={() => handleReference(obj.key)} className="mobile-game-storage-mini-button">
                      <MessageSquareQuote className="h-3.5 w-3.5" />
                    </button>
                    <button data-testid="storage-file-download" title="下载" onClick={() => void handleDownload(obj.key)} className="mobile-game-storage-mini-button">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button data-testid="storage-file-delete" title="删除" onClick={() => deleteFile(obj.key)} className="mobile-game-storage-mini-button mobile-game-storage-mini-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {previewRef && <StoragePreviewDialog channelId={channelId} refText={previewRef} onClose={() => setPreviewRef(null)} />}
    </div>
  )
}
