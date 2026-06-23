import { expect, test } from '@playwright/test'
import {
  storagePreviewUsesProxy,
} from '../../../../beeseed-sdk/src/components/chat/StorageAttachmentPreview'
import {
  storageAttachmentDownloadPayload,
  storagePresignDownloadPayload,
  storagePreviewPresignPayload,
} from '../../../../beeseed-sdk/src/lib/storage-presign'

test.describe('storage presign payloads', () => {
  test('uses inline disposition for preview URLs', () => {
    expect(storagePreviewPresignPayload('storage://__chat_uploads/report%202026.pdf')).toEqual({
      key: '__chat_uploads/report 2026.pdf',
      disposition: 'inline',
    })
  })

  test('uses attachment disposition for explicit downloads', () => {
    expect(storageAttachmentDownloadPayload('__chat_uploads/report.pdf')).toEqual({
      key: '__chat_uploads/report.pdf',
      disposition: 'attachment',
    })
  })

  test('preserves image process with the requested disposition', () => {
    expect(storagePresignDownloadPayload('images/a.png', { process: 'image/resize,w_320', disposition: 'inline' })).toEqual({
      key: 'images/a.png',
      process: 'image/resize,w_320',
      disposition: 'inline',
    })
  })

  test('routes PDF previews through the Worker proxy', () => {
    expect(storagePreviewUsesProxy('pdf')).toBe(true)
    expect(storagePreviewUsesProxy('text')).toBe(true)
    expect(storagePreviewUsesProxy('code')).toBe(true)
    expect(storagePreviewUsesProxy('html')).toBe(true)
    expect(storagePreviewUsesProxy('image')).toBe(false)
  })
})
