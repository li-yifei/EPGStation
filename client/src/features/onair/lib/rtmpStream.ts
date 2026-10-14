export type RtmpStreamState = 'idle' | 'starting' | 'streaming' | 'stopping' | 'error'

export interface RtmpEndpoint {
  name: string
  url: string
  description: string
}

export interface RtmpStatus {
  isStreaming: boolean
  status: RtmpStreamState
  channelId?: number
  endpointName?: string
  startTime?: number
  errorMessage?: string
}

/** Sentinel select value meaning "enter an RTMP URL manually". */
export const RTMP_CUSTOM_ENDPOINT_VALUE = '__custom__'

export type RtmpStartPayload =
  | { channelId: number; endpointName: string; streamKey: string }
  | { channelId: number; url: string; streamKey: string }

const RTMP_STATES: readonly RtmpStreamState[] = [
  'idle',
  'starting',
  'streaming',
  'stopping',
  'error',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function adaptRtmpEndpoints(value: unknown): RtmpEndpoint[] | null {
  if (!isRecord(value) || !Array.isArray(value.endpoints)) {
    return null
  }

  const endpoints: RtmpEndpoint[] = []
  for (const item of value.endpoints) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.url !== 'string') {
      return null
    }
    endpoints.push({
      name: item.name,
      url: item.url,
      description: typeof item.description === 'string' ? item.description : '',
    })
  }

  return endpoints
}

export function adaptRtmpStatus(value: unknown): RtmpStatus | null {
  if (
    !isRecord(value) ||
    typeof value.isStreaming !== 'boolean' ||
    typeof value.status !== 'string' ||
    !RTMP_STATES.includes(value.status as RtmpStreamState)
  ) {
    return null
  }

  const status: RtmpStatus = {
    isStreaming: value.isStreaming,
    status: value.status as RtmpStreamState,
  }
  if (typeof value.channelId === 'number') status.channelId = value.channelId
  if (typeof value.endpointName === 'string') status.endpointName = value.endpointName
  if (typeof value.startTime === 'number') status.startTime = value.startTime
  if (typeof value.errorMessage === 'string') status.errorMessage = value.errorMessage

  return status
}

/** Same rule as the server: rtmp:// or rtmps://, a host, and no whitespace (it would split the ffmpeg command). */
export function isValidRtmpUrl(value: string): boolean {
  return /^rtmps?:\/\/[^\s/]+\S*$/i.test(value.trim())
}

/** Same rule as the server: at least one character and no whitespace after trimming. */
export function isValidRtmpStreamKey(value: string): boolean {
  return /^\S+$/.test(value.trim())
}

export function buildRtmpStartPayload({
  channelId,
  endpointValue,
  customUrl,
  streamKey,
}: {
  channelId: number | null
  endpointValue: string
  customUrl: string
  streamKey: string
}): RtmpStartPayload | null {
  const key = streamKey.trim()
  if (channelId === null || !isValidRtmpStreamKey(key)) {
    return null
  }

  if (endpointValue === RTMP_CUSTOM_ENDPOINT_VALUE) {
    return isValidRtmpUrl(customUrl) ? { channelId, url: customUrl.trim(), streamKey: key } : null
  }

  return endpointValue === '' ? null : { channelId, endpointName: endpointValue, streamKey: key }
}

/** Status is considered "active" (start disabled / stop available) while not idle or error. */
export function isRtmpActive(status: RtmpStatus | null | undefined): boolean {
  return (
    status !== null &&
    status !== undefined &&
    (status.isStreaming || status.status === 'starting' || status.status === 'stopping')
  )
}

export function formatRtmpStatusLabel(status: RtmpStatus | null | undefined): string {
  switch (status?.status) {
    case 'starting':
      return '開始中'
    case 'streaming':
      return '配信中'
    case 'stopping':
      return '停止中'
    case 'error':
      return 'エラー'
    default:
      return '停止'
  }
}

export function formatRtmpStartTime(startTime: number): string {
  const date = new Date(startTime)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const STREAM_KEY_STORAGE_PREFIX = 'rtmp_stream_key_'

export function rtmpStreamKeyStorageKey(endpointValue: string): string {
  return `${STREAM_KEY_STORAGE_PREFIX}${endpointValue}`
}

export function readRtmpStreamKey(
  storage: Storage | null | undefined,
  endpointValue: string,
): string {
  try {
    return storage?.getItem(rtmpStreamKeyStorageKey(endpointValue)) ?? ''
  } catch {
    return ''
  }
}

export function writeRtmpStreamKey(
  storage: Storage | null | undefined,
  endpointValue: string,
  streamKey: string,
): void {
  try {
    storage?.setItem(rtmpStreamKeyStorageKey(endpointValue), streamKey)
  } catch {
    // storage may be unavailable (private mode / quota); remembering the key is best-effort
  }
}
