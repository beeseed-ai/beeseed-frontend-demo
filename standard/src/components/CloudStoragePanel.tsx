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

const UUID_DIRECTORY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCAL_RUN_DIRECTORY_RE = /^local-run-([A-Za-z0-9]{6,})$/

function storageDisplayName(obj: { key: string; name?: string; display_name?: string }) {
  return obj.display_name || obj.name || obj.key.split('/').pop() || obj.key
}

function storageRefFromKey(key: string) {
  return `storage://${key.replace(/^\/+/, '')}`
}

function directoryDisplayName(dir: string) {
  return dir.replace(/\/$/, '').split('/').pop() || dir
}

function directoryFriendlyName(dir: string) {
  const name = directoryDisplayName(dir)
  if (UUID_DIRECTORY_RE.test(name)) {
    return `平台技能产物 ${name.slice(0, 8)}`
  }
  const localRun = name.match(LOCAL_RUN_DIRECTORY_RE)
  if (localRun?.[1]) {
    return `平台技能产物 ${localRun[1].slice(0, 8)}`
  }
  return name
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
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">选择一个对话查看文件</div>
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

  return (
    <div className={cn('flex-1 flex flex-col overflow-hidden', className)} data-testid="cloud-storage-panel">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold">云存储</h2>
          <div className="text-[11px] text-muted-foreground">
            {policy.visibility === 'shared' ? '共享空间' : '个人空间'} · {directories.length + objects.length > 0 ? `${directories.length} 个文件夹 · ${objects.length} 个文件` : '当前目录'} · 已用 {formatBytes(usage.bytes)}
          </div>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={uploading || !canUpload} onClick={startCreateDirectory}>
          <FolderPlus className="w-3.5 h-3.5 mr-1" />
          新建文件夹
        </Button>
        <Button data-testid="storage-upload-button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={uploading || !canUpload} onClick={() => fileRef.current?.click()}>
          <Upload className="w-3.5 h-3.5 mr-1" />
          {uploading ? '上传中' : canUpload ? '上传' : '只读'}
        </Button>
        <input ref={fileRef} data-testid="storage-upload-input" type="file" className="hidden" onChange={(e) => void handleUpload(e.target.files?.[0])} />
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 py-1.5 text-xs text-muted-foreground border-b border-border">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <button onClick={() => browse(crumb.prefix)} className="hover:text-foreground transition-colors">
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {(uploading || uploadError) && (
        <div className="border-b border-border px-4 py-2">
          {uploading ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">正在上传</span>
                <span className="text-muted-foreground">{uploadProgress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{uploadError}</span>
              <button className="rounded p-0.5 hover:bg-destructive/10" onClick={clearUploadError} aria-label="关闭错误">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-8">加载中...</div>
        ) : !hasEntries ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" data-testid="storage-empty-state">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted/40">
              <File className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">当前目录暂无文件</div>
              <div className="mt-1 text-xs text-muted-foreground">当前目录是空的。</div>
            </div>
            <Button data-testid="storage-empty-upload-button" size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={uploading || !canUpload} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" />
              {canUpload ? '上传文件' : '只读空间'}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {draftDirectory && (
              <div className="flex items-center gap-3 px-4 py-2">
                <FolderOpen className="w-4 h-4 text-amber-500" />
                <Input
                  ref={draftInputRef}
                  value={draftDirectory.name}
                  disabled={draftDirectory.creating}
                  aria-label="文件夹名称"
                  className="h-7 min-w-0 flex-1 text-sm"
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
                {draftDirectory.creating && <span className="text-xs text-muted-foreground">创建中...</span>}
              </div>
            )}
            {directories.map((dir) => {
              const rawName = directoryDisplayName(dir)
              const friendlyName = directoryFriendlyName(dir)
              return (
                <button
                  key={dir}
                  onClick={() => browse(dir)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/50"
                  title={dir}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{friendlyName}</span>
                    {friendlyName !== rawName && (
                      <span className="block truncate text-[10px] text-muted-foreground">{rawName}</span>
                    )}
                  </span>
                </button>
              )
            })}
            {objects.map((obj) => {
              const refText = storageRefFromKey(obj.key)
              const displayName = storageDisplayName(obj)
              return (
                <div
                  key={obj.key}
                  className="group flex items-center gap-3 px-4 py-2"
                  data-testid="storage-file-row"
                  data-storage-key={obj.key}
                  data-storage-file-name={displayName}
                >
                  <button
                    data-testid="storage-file-preview"
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none transition-colors hover:text-[#181d26] focus-visible:ring-2 focus-visible:ring-[#9297a0]"
                    onClick={() => setPreviewRef(refText)}
                    title="预览文件"
                  >
                    <StorageFileIcon refText={refText} className="h-4 w-4 shrink-0 text-[#254fad]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{displayName}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {storageFileLabelForRef(refText)} · {formatBytes(obj.size)} · {new Date(obj.last_modified).toLocaleDateString('zh-CN')}
                      </span>
                    </span>
                  </button>
                  <button
                    data-testid="storage-file-reference"
                    title="引用到聊天"
                    onClick={() => handleReference(obj.key)}
                    className="hidden group-hover:block p-1 rounded hover:bg-muted transition-colors"
                  >
                    <MessageSquareQuote className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    data-testid="storage-file-download"
                    title="下载"
                    onClick={() => void handleDownload(obj.key)}
                    className="hidden group-hover:block p-1 rounded hover:bg-muted transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    data-testid="storage-file-delete"
                    title="删除"
                    onClick={() => deleteFile(obj.key)}
                    className="hidden group-hover:block p-1 rounded hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
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
