export type ImagePreviewScene = 'input' | 'chat' | 'dialog' | 'storageList'

interface ImagePreviewSpec {
  maxLongEdge: number
  process: string
}

export const IMAGE_PREVIEW_SPECS: Record<ImagePreviewScene, ImagePreviewSpec> = {
  input: {
    maxLongEdge: 320,
    process: 'image/resize,m_lfit,w_320,h_320',
  },
  chat: {
    maxLongEdge: 640,
    process: 'image/resize,m_lfit,w_640,h_640',
  },
  dialog: {
    maxLongEdge: 1800,
    process: 'image/resize,m_lfit,w_1800,h_1800',
  },
  storageList: {
    maxLongEdge: 320,
    process: 'image/resize,m_lfit,w_320,h_320',
  },
}

const PROCESSABLE_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'])
const SIGNATURE_QUERY_KEYS = new Set([
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'x-tos-signature',
  'x-tos-credential',
  'signature',
  'credential',
])

export function installImagePreviewOptimizer(): () => void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  const optimizeAll = () => {
    document.querySelectorAll('img').forEach((img) => optimizeImage(img))
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
        optimizeImage(record.target)
        continue
      }

      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          optimizeImage(node)
        } else if (node instanceof Element) {
          node.querySelectorAll('img').forEach((img) => optimizeImage(img))
        }
      })
    }
  })

  optimizeAll()
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  })

  return () => observer.disconnect()
}

function optimizeImage(img: HTMLImageElement) {
  const original = img.dataset.beeseedOriginalSrc || img.currentSrc || img.src
  if (!original || img.dataset.beeseedOptimizing === '1') return
  if (!isPreviewCandidate(img, original)) return

  const scene = sceneForImage(img)
  const nextSrc = imagePreviewSrc(original, scene)
  if (nextSrc === img.src) return

  img.dataset.beeseedOptimizing = '1'
  img.dataset.beeseedOriginalSrc = original
  img.dataset.beeseedPreviewScene = scene
  img.dataset.beeseedPreviewMaxLongEdge = String(IMAGE_PREVIEW_SPECS[scene].maxLongEdge)
  if (scene === 'chat' || scene === 'input' || scene === 'storageList') {
    img.loading = 'lazy'
    img.decoding = 'async'
  }
  img.src = nextSrc
  window.setTimeout(() => {
    delete img.dataset.beeseedOptimizing
  }, 0)
}

function sceneForImage(img: HTMLImageElement): ImagePreviewScene {
  if (img.alt === 'preview' || img.closest('.fixed.inset-0.z-50')) return 'dialog'
  if (img.closest('[data-beeseed-composer-preview]')) return 'input'
  if (img.closest('[data-beeseed-storage-list]')) return 'storageList'
  return 'chat'
}

function isPreviewCandidate(img: HTMLImageElement, value: string): boolean {
  if (!isProcessableImagePath(value)) return false
  if (img.closest('[data-beeseed-skip-preview-optimization]')) return false

  const alt = img.getAttribute('alt') ?? ''
  if (alt === 'image' || alt === 'preview') return true
  if (img.closest('button[title^="__chat_uploads/"]')) return true
  if (value.includes('/__chat_uploads/') || value.includes('__chat_uploads%2F')) return true
  if (img.closest('[data-beeseed-composer-preview], [data-beeseed-storage-list]')) return true

  return false
}

export function isProcessableImagePath(value: string): boolean {
  if (value.startsWith('blob:') || value.startsWith('data:')) return false

  const pathname = safePathname(value).toLowerCase()
  const ext = pathname.includes('.') ? pathname.slice(pathname.lastIndexOf('.') + 1) : ''
  return PROCESSABLE_IMAGE_EXTS.has(ext)
}

export function isSignedObjectUrl(value: string): boolean {
  try {
    const url = new URL(value, browserOrigin())
    for (const key of url.searchParams.keys()) {
      if (SIGNATURE_QUERY_KEYS.has(key.toLowerCase())) return true
    }
    return false
  } catch {
    return /(?:[?&](?:X-Amz-Signature|X-Tos-Signature|Signature|signature|credential|Credential)=)/.test(value)
  }
}

export function imagePreviewSrc(value: string, scene: ImagePreviewScene): string {
  if (isSignedObjectUrl(value)) return value
  return withImagePreviewParams(value, scene)
}

export function withImagePreviewParams(value: string, scene: ImagePreviewScene): string {
  try {
    const url = new URL(value, browserOrigin())
    url.searchParams.set('x-tos-process', IMAGE_PREVIEW_SPECS[scene].process)
    return url.toString()
  } catch {
    const joiner = value.includes('?') ? '&' : '?'
    return `${value}${joiner}x-tos-process=${encodeURIComponent(IMAGE_PREVIEW_SPECS[scene].process)}`
  }
}

function browserOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
}

function safePathname(value: string): string {
  try {
    return new URL(value, window.location.origin).pathname
  } catch {
    return value
  }
}
