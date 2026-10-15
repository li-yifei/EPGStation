import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LiveStreamSelectDialog } from '@/features/onair/LiveStreamSelectDialog'
import { RtmpStreamDialog } from '@/features/onair/RtmpStreamDialog'
import type { RtmpStatus } from '@/features/onair/lib/rtmpStream'
import type { RtmpApiRepository } from '@/features/onair/rtmpApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { chooseMuiSelectOption } from './support/onairSpecHarness'

function createRepository(status: RtmpStatus = { isStreaming: false, status: 'idle' }) {
  const repository = {
    fetchEndpoints: vi.fn<RtmpApiRepository['fetchEndpoints']>().mockResolvedValue({
      ok: true,
      value: [
        { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', description: 'YouTube Live' },
        { name: 'Twitch', url: 'rtmp://live.twitch.tv/app', description: '' },
      ],
    }),
    fetchStatus: vi
      .fn<RtmpApiRepository['fetchStatus']>()
      .mockResolvedValue({ ok: true, value: status }),
    startStream: vi
      .fn<RtmpApiRepository['startStream']>()
      .mockResolvedValue({ ok: true, value: undefined }),
    stopStream: vi
      .fn<RtmpApiRepository['stopStream']>()
      .mockResolvedValue({ ok: true, value: undefined }),
  }

  return repository
}

function renderRtmpDialog(repository: RtmpApiRepository) {
  const onClose = vi.fn()
  const onSnackbar = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RtmpStreamDialog
        open
        channel={{ id: 10, name: 'Channel' }}
        apiRepository={repository}
        onClose={onClose}
        onSnackbar={onSnackbar}
      />
    </QueryClientProvider>,
  )

  return { onClose, onSnackbar }
}

describe('RtmpStreamDialog', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts streaming to the first configured endpoint with a masked stream key', async () => {
    const repository = createRepository()
    const { onSnackbar } = renderRtmpDialog(repository)

    expect(await screen.findByText('YouTube Live')).toBeInTheDocument()
    const keyField = screen.getByLabelText('ストリームキー')
    expect(keyField).toHaveAttribute('type', 'password')
    expect(
      screen.getByText('ストリームキーは配信先ごとにこのブラウザに保存されます'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ストリームキーを表示' }))
    expect(keyField).toHaveAttribute('type', 'text')

    const start = screen.getByRole('button', { name: '配信開始' })
    expect(start).toBeDisabled()
    fireEvent.change(keyField, { target: { value: 'secret' } })
    fireEvent.click(start)

    await waitFor(() => {
      expect(repository.startStream).toHaveBeenCalledWith({
        channelId: 10,
        endpointName: 'YouTube',
        streamKey: 'secret',
      })
    })
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: '配信を開始しました', severity: 'success' })
    })
    expect(localStorage.getItem('rtmp_stream_key_YouTube')).toBe('secret')
  })

  it('supports a custom RTMP URL', async () => {
    const repository = createRepository()
    renderRtmpDialog(repository)
    await screen.findByText('YouTube Live')

    await chooseMuiSelectOption('配信先', 'カスタム URL')
    const urlField = screen.getByLabelText('RTMP URL')
    fireEvent.change(urlField, { target: { value: 'http://bad' } })
    expect(screen.getByText(/rtmp:\/\/ または rtmps:\/\//)).toBeInTheDocument()
    fireEvent.change(urlField, { target: { value: 'rtmp://example.com/live' } })
    fireEvent.change(screen.getByLabelText('ストリームキー'), { target: { value: 'k' } })
    fireEvent.click(screen.getByRole('button', { name: '配信開始' }))

    await waitFor(() => {
      expect(repository.startStream).toHaveBeenCalledWith({
        channelId: 10,
        url: 'rtmp://example.com/live',
        streamKey: 'k',
      })
    })
  })

  it('shows running status and stops the stream', async () => {
    const repository = createRepository({
      isStreaming: true,
      status: 'streaming',
      channelId: 10,
      endpointName: 'YouTube',
    })
    const { onSnackbar } = renderRtmpDialog(repository)

    expect(await screen.findByText(/配信中 \(YouTube\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('ストリームキー')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '配信停止' }))

    await waitFor(() => {
      expect(repository.stopStream).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: '配信を停止しました', severity: 'success' })
    })
  })

  it('shows server errors from status and failed start requests', async () => {
    const repository = createRepository({
      isStreaming: false,
      status: 'error',
      errorMessage: 'ffmpeg exited',
    })
    repository.startStream.mockResolvedValue({
      ok: false,
      error: 'rtmp-start-failed',
      message: 'already streaming',
    })
    localStorage.setItem('rtmp_stream_key_YouTube', 'saved')
    const { onSnackbar } = renderRtmpDialog(repository)

    expect(await screen.findByText('ffmpeg exited')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('ストリームキー')).toHaveValue('saved')
    })
    fireEvent.click(screen.getByRole('button', { name: '配信開始' }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: 'already streaming', severity: 'error' })
    })
  })
})

describe('LiveStreamSelectDialog RTMP entry', () => {
  it('opens the RTMP dialog for the selected channel', async () => {
    const onClose = vi.fn()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).endsWith('/endpoints')
          ? ({ ok: true, json: async () => ({ endpoints: [] }) } as Response)
          : ({ ok: true, json: async () => ({ isStreaming: false, status: 'idle' }) } as Response),
      )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <LiveStreamSelectDialog
            open
            channel={{ id: 10, name: 'Channel' }}
            settings={new DefaultSettingsFactory().create()}
            onClose={onClose}
            onSnackbar={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'RTMP配信' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'RTMP配信' })).toBeInTheDocument()
    // No configured endpoints: the dialog falls back to a custom URL.
    expect(await screen.findByLabelText('RTMP URL')).toBeInTheDocument()
    fetchMock.mockRestore()
  })
})
