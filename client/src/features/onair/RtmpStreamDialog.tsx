import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { AppSelect } from '@/shared/AppSelect'
import { getBrowserLocalStorage } from './lib/liveStreamSelection'
import {
  RTMP_CUSTOM_ENDPOINT_VALUE,
  buildRtmpStartPayload,
  formatRtmpStartTime,
  formatRtmpStatusLabel,
  isRtmpActive,
  isValidRtmpStreamKey,
  isValidRtmpUrl,
  readRtmpStreamKey,
  writeRtmpStreamKey,
  type RtmpStartPayload,
} from './lib/rtmpStream'
import {
  RTMP_ENDPOINTS_QUERY_KEY,
  RTMP_STATUS_QUERY_KEY,
  createFetchRtmpApiRepository,
  type RtmpApiRepository,
} from './rtmpApi'
import styles from './OnAirPage.module.css'

export const RTMP_STATUS_POLL_INTERVAL_MS = 3000

export interface RtmpStreamDialogProps {
  open: boolean
  channel: { id: number; name?: string } | null
  apiRepository?: RtmpApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

const defaultRepository = createFetchRtmpApiRepository()

/**
 * RTMP 配信ダイアログ。サーバー設定の配信先 (または任意 URL) とストリームキーを指定して
 * 選択中チャンネルの配信を開始 / 停止する。表示中は配信状態をポーリングする。
 */
export function RtmpStreamDialog({
  open,
  channel,
  apiRepository = defaultRepository,
  onClose,
  onSnackbar,
}: RtmpStreamDialogProps) {
  const queryClient = useQueryClient()
  const [endpointValue, setEndpointValue] = useState<string | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [streamKeyOverride, setStreamKeyOverride] = useState<string | null>(null)
  const [showStreamKey, setShowStreamKey] = useState(false)

  const endpointsQuery = useQuery({
    queryKey: RTMP_ENDPOINTS_QUERY_KEY,
    enabled: open,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await apiRepository.fetchEndpoints()
      if (!result.ok) {
        onSnackbar({ text: result.message, severity: 'error' })
        return []
      }
      return result.value
    },
  })
  const statusQuery = useQuery({
    queryKey: RTMP_STATUS_QUERY_KEY,
    enabled: open,
    refetchInterval: open ? RTMP_STATUS_POLL_INTERVAL_MS : false,
    queryFn: async () => {
      const result = await apiRepository.fetchStatus()
      return result.ok ? result.value : null
    },
  })

  const endpoints = useMemo(() => endpointsQuery.data ?? [], [endpointsQuery.data])
  // Default to the first configured endpoint, or custom URL when none are configured.
  const selectedEndpoint =
    endpointValue ??
    (endpointsQuery.isSuccess ? (endpoints[0]?.name ?? RTMP_CUSTOM_ENDPOINT_VALUE) : '')
  const streamKey =
    streamKeyOverride ??
    (selectedEndpoint === '' ? '' : readRtmpStreamKey(getBrowserLocalStorage(), selectedEndpoint))
  const status = statusQuery.data
  const active = isRtmpActive(status)
  const isCustom = selectedEndpoint === RTMP_CUSTOM_ENDPOINT_VALUE
  const payload = buildRtmpStartPayload({
    channelId: channel?.id ?? null,
    endpointValue: selectedEndpoint,
    customUrl,
    streamKey,
  })
  const selectedDescription = endpoints.find(
    (endpoint) => endpoint.name === selectedEndpoint,
  )?.description

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: RTMP_STATUS_QUERY_KEY })
  const startMutation = useMutation({
    mutationFn: async (startPayload: RtmpStartPayload) => {
      const result = await apiRepository.startStream(startPayload)
      if (!result.ok) throw new Error(result.message)
    },
    onSuccess: () => {
      writeRtmpStreamKey(getBrowserLocalStorage(), selectedEndpoint, streamKey.trim())
      onSnackbar({ text: '配信を開始しました', severity: 'success' })
    },
    onError: (error) => onSnackbar({ text: error.message, severity: 'error' }),
    onSettled: invalidateStatus,
  })
  const stopMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRepository.stopStream()
      if (!result.ok) throw new Error(result.message)
    },
    onSuccess: () => onSnackbar({ text: '配信を停止しました', severity: 'success' }),
    onError: (error) => onSnackbar({ text: error.message, severity: 'error' }),
    onSettled: invalidateStatus,
  })
  const busy = startMutation.isPending || stopMutation.isPending
  const formDisabled = active || busy

  const buttonSx = { color: '#1976d2' }

  return (
    <Dialog
      open={open}
      aria-label="RTMP配信"
      onClose={busy ? undefined : onClose}
      slotProps={{
        paper: {
          'aria-label': 'RTMP配信',
          sx: {
            maxWidth: 440,
            width: '100%',
            '@media (max-width: 600px)': { margin: 0, maxWidth: '100%', width: '100%' },
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 0 }}>RTMP配信</DialogTitle>
      <DialogContent className={styles.streamDialogContent}>
        <div className={styles.rtmpChannelRow}>
          <p>{channel?.name ?? ''}</p>
          <Chip
            size="small"
            label={formatRtmpStatusLabel(status)}
            color={
              status?.status === 'error' ? 'error' : status?.isStreaming ? 'success' : 'default'
            }
            variant={active ? 'filled' : 'outlined'}
          />
        </div>
        {endpointsQuery.isPending ? (
          <CircularProgress size={24} aria-label="読み込み中" sx={{ alignSelf: 'center' }} />
        ) : (
          <>
            <AppSelect
              ariaLabel="配信先"
              label="配信先"
              variant="outlined"
              disabled={formDisabled}
              value={selectedEndpoint}
              options={[
                ...endpoints.map((endpoint) => ({ label: endpoint.name, value: endpoint.name })),
                { label: 'カスタム URL', value: RTMP_CUSTOM_ENDPOINT_VALUE },
              ]}
              onChange={(value) => {
                setEndpointValue(value)
                setStreamKeyOverride(null)
              }}
            />
            {selectedDescription ? (
              <p className={styles.rtmpCaption}>{selectedDescription}</p>
            ) : undefined}
            {isCustom ? (
              <TextField
                label="RTMP URL"
                size="small"
                placeholder="rtmp://example.com/live"
                disabled={formDisabled}
                value={customUrl}
                error={customUrl !== '' && !isValidRtmpUrl(customUrl)}
                helperText={
                  customUrl !== '' && !isValidRtmpUrl(customUrl)
                    ? 'rtmp:// または rtmps:// で始まる URL を入力してください'
                    : undefined
                }
                onChange={(event) => setCustomUrl(event.target.value)}
              />
            ) : undefined}
            <TextField
              label="ストリームキー"
              size="small"
              type={showStreamKey ? 'text' : 'password'}
              autoComplete="off"
              disabled={formDisabled}
              value={streamKey}
              error={streamKey.trim() !== '' && !isValidRtmpStreamKey(streamKey)}
              helperText={
                streamKey.trim() !== '' && !isValidRtmpStreamKey(streamKey)
                  ? 'ストリームキーに空白を含めることはできません'
                  : 'ストリームキーは配信先ごとにこのブラウザに保存されます'
              }
              onChange={(event) => setStreamKeyOverride(event.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button
                        size="small"
                        aria-label={showStreamKey ? 'ストリームキーを隠す' : 'ストリームキーを表示'}
                        sx={{ minWidth: 0, ...buttonSx }}
                        onClick={() => setShowStreamKey((current) => !current)}
                      >
                        {showStreamKey ? '隠す' : '表示'}
                      </Button>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </>
        )}
        {status?.isStreaming ? (
          <Alert severity="success" variant="outlined">
            配信中{status.endpointName ? ` (${status.endpointName})` : ''}
            {status.startTime !== undefined
              ? ` / 開始時刻: ${formatRtmpStartTime(status.startTime)}`
              : ''}
            {status.channelId !== undefined && status.channelId !== channel?.id
              ? ' / 別チャンネルを配信中'
              : ''}
          </Alert>
        ) : undefined}
        {status?.status === 'error' ? (
          <Alert severity="error" variant="outlined">
            {status.errorMessage ?? '配信でエラーが発生しました'}
          </Alert>
        ) : undefined}
      </DialogContent>
      <DialogActions>
        <Button sx={{ ...buttonSx, minWidth: 110 }} disabled={busy} onClick={onClose}>
          閉じる
        </Button>
        {active ? (
          <Button
            color="error"
            disabled={busy || status?.status === 'stopping'}
            onClick={() => stopMutation.mutate()}
          >
            配信停止
          </Button>
        ) : (
          <Button
            sx={buttonSx}
            disabled={busy || payload === null}
            onClick={payload === null ? undefined : () => startMutation.mutate(payload)}
          >
            配信開始
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
