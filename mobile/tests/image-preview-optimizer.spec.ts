import { expect, test } from '@playwright/test'
import { imagePreviewSrc, isSignedObjectUrl, withImagePreviewParams } from '../src/imagePreviewOptimizer'

test.describe('image preview optimizer', () => {
  test('does not mutate signed storage image URLs', () => {
    const signedUrl = 'https://storage.example.com/app/__chat_uploads/Urahara_Kisuke.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=demo&X-Amz-Signature=abc123'

    expect(isSignedObjectUrl(signedUrl)).toBe(true)
    expect(imagePreviewSrc(signedUrl, 'chat')).toBe(signedUrl)
  })

  test('adds image process params only to unsigned image URLs', () => {
    const unsignedUrl = 'https://cdn.example.com/app/__chat_uploads/Urahara_Kisuke.jpg?version=1'

    expect(isSignedObjectUrl(unsignedUrl)).toBe(false)
    expect(withImagePreviewParams(unsignedUrl, 'chat')).toContain('x-tos-process=image%2Fresize%2Cm_lfit%2Cw_640%2Ch_640')
  })
})
