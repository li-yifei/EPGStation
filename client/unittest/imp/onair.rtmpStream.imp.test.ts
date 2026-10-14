import { describe, expect, it, vi } from 'vitest'
import {
  RTMP_CUSTOM_ENDPOINT_VALUE,
  adaptRtmpEndpoints,
  adaptRtmpStatus,
  buildRtmpStartPayload,
  formatRtmpStartTime,
  formatRtmpStatusLabel,
  isRtmpActive,
  isValidRtmpUrl,
  readRtmpStreamKey,
  writeRtmpStreamKey,
} from '@/features/onair/lib/rtmpStream'
import { createFetchRtmpApiRepository } from '@/features/onair/rtmpApi'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

describe('RTMP stream helpers', () => {
  it('adapts endpoint lists and rejects malformed payloads', () => {
    expect(
      adaptRtmpEndpoints({
        endpoints: [
          { name: 'YouTube', url: 'rtmp://a/live2', description: 'yt' },
          { name: 'X', url: 'rtmp://x' },
        ],
      }),
    ).toEqual([
      { name: 'YouTube', url: 'rtmp://a/live2', description: 'yt' },
      { name: 'X', url: 'rtmp://x', description: '' },
    ])
    expect(adaptRtmpEndpoints(null)).toBeNull()
    expect(adaptRtmpEndpoints({ endpoints: 'x' })).toBeNull()
    expect(adaptRtmpEndpoints({ endpoints: [{ name: 1, url: 'rtmp://x' }] })).toBeNull()
  })

  it('adapts status payloads with optional fields', () => {
    expect(
      adaptRtmpStatus({
        isStreaming: true,
        status: 'streaming',
        channelId: 1,
        endpointName: 'YouTube',
        startTime: 100,
        errorMessage: 'e',
      }),
    ).toEqual({
      isStreaming: true,
      status: 'streaming',
      channelId: 1,
      endpointName: 'YouTube',
      startTime: 100,
      errorMessage: 'e',
    })
    expect(adaptRtmpStatus({ isStreaming: false, status: 'idle' })).toEqual({
      isStreaming: false,
      status: 'idle',
    })
    expect(adaptRtmpStatus({ isStreaming: false, status: 'unknown' })).toBeNull()
    expect(adaptRtmpStatus({ status: 'idle' })).toBeNull()
    expect(adaptRtmpStatus('x')).toBeNull()
  })

  it('validates rtmp urls', () => {
    expect(isValidRtmpUrl('rtmp://example.com/live')).toBe(true)
    expect(isValidRtmpUrl(' rtmps://example.com ')).toBe(true)
    expect(isValidRtmpUrl('http://example.com')).toBe(false)
    expect(isValidRtmpUrl('rtmp://')).toBe(false)
  })

  it('builds start payloads for configured endpoints and custom urls', () => {
    const base = { channelId: 5, customUrl: '', streamKey: ' key ' }
    expect(buildRtmpStartPayload({ ...base, endpointValue: 'YouTube' })).toEqual({
      channelId: 5,
      endpointName: 'YouTube',
      streamKey: 'key',
    })
    expect(
      buildRtmpStartPayload({
        ...base,
        endpointValue: RTMP_CUSTOM_ENDPOINT_VALUE,
        customUrl: ' rtmp://h/app ',
      }),
    ).toEqual({ channelId: 5, url: 'rtmp://h/app', streamKey: 'key' })
    expect(
      buildRtmpStartPayload({ ...base, endpointValue: RTMP_CUSTOM_ENDPOINT_VALUE, customUrl: 'x' }),
    ).toBeNull()
    expect(buildRtmpStartPayload({ ...base, endpointValue: '' })).toBeNull()
    expect(buildRtmpStartPayload({ ...base, endpointValue: 'Y', streamKey: '  ' })).toBeNull()
    expect(buildRtmpStartPayload({ ...base, endpointValue: 'Y', channelId: null })).toBeNull()
  })

  it('derives active state and labels', () => {
    expect(isRtmpActive(null)).toBe(false)
    expect(isRtmpActive(undefined)).toBe(false)
    expect(isRtmpActive({ isStreaming: false, status: 'idle' })).toBe(false)
    expect(isRtmpActive({ isStreaming: false, status: 'error' })).toBe(false)
    expect(isRtmpActive({ isStreaming: false, status: 'starting' })).toBe(true)
    expect(isRtmpActive({ isStreaming: false, status: 'stopping' })).toBe(true)
    expect(isRtmpActive({ isStreaming: true, status: 'streaming' })).toBe(true)
    expect(formatRtmpStatusLabel(undefined)).toBe('停止')
    expect(formatRtmpStatusLabel({ isStreaming: false, status: 'starting' })).toBe('開始中')
    expect(formatRtmpStatusLabel({ isStreaming: true, status: 'streaming' })).toBe('配信中')
    expect(formatRtmpStatusLabel({ isStreaming: false, status: 'stopping' })).toBe('停止中')
    expect(formatRtmpStatusLabel({ isStreaming: false, status: 'error' })).toBe('エラー')
    expect(formatRtmpStartTime(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026/01/02 03:04:05')
  })

  it('remembers stream keys per endpoint and tolerates storage failures', () => {
    localStorage.clear()
    writeRtmpStreamKey(localStorage, 'YouTube', 'abc')
    expect(readRtmpStreamKey(localStorage, 'YouTube')).toBe('abc')
    expect(readRtmpStreamKey(localStorage, 'Other')).toBe('')
    expect(readRtmpStreamKey(null, 'YouTube')).toBe('')
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(readRtmpStreamKey(broken, 'YouTube')).toBe('')
    expect(() => writeRtmpStreamKey(broken, 'YouTube', 'x')).not.toThrow()
  })
})

describe('RTMP API repository', () => {
  it('fetches endpoints and status from ./api/rtmp', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ endpoints: [{ name: 'A', url: 'rtmp://a' }] }))
      .mockResolvedValueOnce(jsonResponse({ isStreaming: false, status: 'idle' }))
    const repository = createFetchRtmpApiRepository({ fetcher })

    await expect(repository.fetchEndpoints()).resolves.toEqual({
      ok: true,
      value: [{ name: 'A', url: 'rtmp://a', description: '' }],
    })
    await expect(repository.fetchStatus()).resolves.toEqual({
      ok: true,
      value: { isStreaming: false, status: 'idle' },
    })
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      './api/rtmp/endpoints',
      './api/rtmp',
    ])
  })

  it('reports fetch failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, false))
    const repository = createFetchRtmpApiRepository({ fetcher, basePath: '/x/api/' })

    await expect(repository.fetchEndpoints()).resolves.toMatchObject({
      ok: false,
      error: 'rtmp-endpoints-fetch-failed',
    })
    await expect(repository.fetchStatus()).resolves.toMatchObject({
      ok: false,
      error: 'rtmp-status-fetch-failed',
    })
    expect(fetcher).toHaveBeenCalledWith('/x/api/rtmp/endpoints')
  })

  it('posts start payloads and deletes to stop', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}))
    const repository = createFetchRtmpApiRepository({ fetcher })
    const payload = { channelId: 1, endpointName: 'A', streamKey: 'k' }

    await expect(repository.startStream(payload)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.stopStream()).resolves.toEqual({ ok: true, value: undefined })
    expect(fetcher).toHaveBeenNthCalledWith(1, './api/rtmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, './api/rtmp', { method: 'DELETE' })
  })

  it('surfaces server error messages and falls back to default messages', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'already streaming' }, false))
      .mockResolvedValueOnce(jsonResponse({ message: '' }, false))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('not json')
        },
      } as unknown as Response)
      .mockRejectedValueOnce(new Error('network'))
    const repository = createFetchRtmpApiRepository({ fetcher })
    const payload = { channelId: 1, url: 'rtmp://h', streamKey: 'k' }

    await expect(repository.startStream(payload)).resolves.toMatchObject({
      ok: false,
      message: 'already streaming',
    })
    await expect(repository.startStream(payload)).resolves.toMatchObject({
      ok: false,
      message: '配信開始に失敗',
    })
    await expect(repository.stopStream()).resolves.toMatchObject({
      ok: false,
      error: 'rtmp-stop-failed',
      message: '配信停止に失敗',
    })
    await expect(repository.stopStream()).resolves.toMatchObject({ message: '配信停止に失敗' })
  })
})
