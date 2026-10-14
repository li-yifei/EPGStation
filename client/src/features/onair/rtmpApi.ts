import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import { fetchJson, resolveDefaultFetch } from './lib/onairApiAdapters'
import {
  adaptRtmpEndpoints,
  adaptRtmpStatus,
  type RtmpEndpoint,
  type RtmpStartPayload,
  type RtmpStatus,
} from './lib/rtmpStream'

export const RTMP_STATUS_QUERY_KEY = ['onair', 'rtmp', 'status'] as const
export const RTMP_ENDPOINTS_QUERY_KEY = ['onair', 'rtmp', 'endpoints'] as const

export interface RtmpApiRepository {
  fetchEndpoints(): Promise<FeatureResult<RtmpEndpoint[], 'rtmp-endpoints-fetch-failed'>>
  fetchStatus(): Promise<FeatureResult<RtmpStatus, 'rtmp-status-fetch-failed'>>
  startStream(payload: RtmpStartPayload): Promise<FeatureResult<void, 'rtmp-start-failed'>>
  stopStream(): Promise<FeatureResult<void, 'rtmp-stop-failed'>>
}

export interface CreateFetchRtmpApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string' &&
      body.message !== ''
      ? body.message
      : null
  } catch {
    return null
  }
}

async function sendAction(
  fetcher: ServerApiFetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: true } | { ok: false; message: string | null }> {
  try {
    const response = await fetcher(url, init)
    return response.ok ? { ok: true } : { ok: false, message: await readErrorMessage(response) }
  } catch {
    return { ok: false, message: null }
  }
}

export function createFetchRtmpApiRepository(
  options: CreateFetchRtmpApiRepositoryOptions = {},
): RtmpApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const base = `${(options.basePath ?? './api').replace(/\/$/, '')}/rtmp`

  return {
    async fetchEndpoints() {
      const value = adaptRtmpEndpoints(await fetchJson(fetcher, `${base}/endpoints`))
      return value === null
        ? { ok: false, error: 'rtmp-endpoints-fetch-failed', message: '配信先一覧の取得に失敗' }
        : { ok: true, value }
    },

    async fetchStatus() {
      const value = adaptRtmpStatus(await fetchJson(fetcher, base))
      return value === null
        ? { ok: false, error: 'rtmp-status-fetch-failed', message: '配信状態の取得に失敗' }
        : { ok: true, value }
    },

    async startStream(payload) {
      const result = await sendAction(fetcher, base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rtmp-start-failed', message: result.message ?? '配信開始に失敗' }
    },

    async stopStream() {
      const result = await sendAction(fetcher, base, { method: 'DELETE' })
      return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rtmp-stop-failed', message: result.message ?? '配信停止に失敗' }
    },
  }
}
