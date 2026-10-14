import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const RTMPStreamModel = compiled<any>('model', 'api', 'rtmp', 'RTMPStreamModel.js').default;

describe('RTMPStreamModel implementation details (unittest/imp)', () => {
    let mockLogger: ReturnType<typeof logger>;
    let mockConfig: Record<string, any>;
    let mockEncodeProcessManageModel: { create: ReturnType<typeof vi.fn> };
    let child: any;

    beforeEach(() => {
        mockLogger = logger();
        mockConfig = baseConfig({
            ffmpeg: '/usr/local/bin/ffmpeg',
            mirakurunPath: 'http://mirakurun.invalid:40772/',
            rtmp: {
                endpoints: [
                    {
                        description: 'YouTube Live',
                        name: 'YouTube',
                        url: 'rtmp://youtube.invalid/live2/',
                    },
                ],
                cmd: '%FFMPEG% -i %INPUT% -c copy -f flv %RTMP_URL%',
            },
        });
        child = fakeChild();
        child.killed = false;
        mockEncodeProcessManageModel = {
            create: vi.fn().mockResolvedValue(child),
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const createModel = (configOverrides?: Record<string, any>) =>
        new RTMPStreamModel(
            { getLogger: () => mockLogger },
            { getConfig: () => (configOverrides ? { ...mockConfig, ...configOverrides } : mockConfig) },
            mockEncodeProcessManageModel,
        );

    describe('start validation and errors', () => {
        it('throws when channelId is missing or 0', async () => {
            const model = createModel();
            await expect(model.start({ channelId: 0 as any, endpointName: 'YouTube', streamKey: 'key' })).rejects.toThrow(
                'channelIdとstreamKeyは必須です',
            );
        });

        it('throws when streamKey is empty', async () => {
            const model = createModel();
            await expect(model.start({ channelId: 101, endpointName: 'YouTube', streamKey: '' })).rejects.toThrow(
                'channelIdとstreamKeyは必須です',
            );
        });

        it('throws when rtmp config section is missing', async () => {
            const model = createModel({ rtmp: undefined });
            await expect(model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' })).rejects.toThrow(
                'RTMP設定が見つかりません',
            );
        });

        it('throws when endpointName is not in configured endpoints', async () => {
            const model = createModel();
            await expect(model.start({ channelId: 101, endpointName: 'Unknown', streamKey: 'key' })).rejects.toThrow(
                "RTMPエンドポイント 'Unknown' が見つかりません",
            );
        });

        it('throws when custom url is not an rtmp/rtmps url', async () => {
            const model = createModel();
            await expect(model.start({ channelId: 101, url: 'http://non-rtmp.invalid', streamKey: 'key' })).rejects.toThrow(
                '無効なRTMP URLです: http://non-rtmp.invalid',
            );
            await expect(model.start({ channelId: 101, url: 'ftp://non-rtmp.invalid', streamKey: 'key' })).rejects.toThrow(
                '無効なRTMP URLです: ftp://non-rtmp.invalid',
            );
        });

        it('throws when neither endpointName nor url is provided', async () => {
            const model = createModel();
            await expect(model.start({ channelId: 101, streamKey: 'key' } as any)).rejects.toThrow(
                'endpointNameまたはurlを指定してください',
            );
        });

        it('throws and records error status when process creation fails (null process)', async () => {
            mockEncodeProcessManageModel.create.mockResolvedValueOnce(null);
            const model = createModel();

            await expect(model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' })).rejects.toThrow(
                'RTMPライブ配信プロセスの作成に失敗しました',
            );

            const status = model.getStatus();
            expect(status.status).toBe('error');
            expect(status.errorMessage).toBe('RTMPライブ配信プロセスの作成に失敗しました');
        });

        it('throws and records error status when process creation throws', async () => {
            mockEncodeProcessManageModel.create.mockRejectedValueOnce(new Error('Spawn failed'));
            const model = createModel();

            await expect(model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' })).rejects.toThrow(
                'Spawn failed',
            );

            const status = model.getStatus();
            expect(status.status).toBe('error');
            expect(status.errorMessage).toBe('Spawn failed');
        });
    });

    describe('custom URL options', () => {
        it('uses custom endpointName if provided with custom URL', async () => {
            const model = createModel();
            await model.start({
                channelId: 101,
                endpointName: 'MyCustomServer',
                url: 'rtmps://custom.server.invalid:443/live/',
                streamKey: 'key',
            });

            expect(model.getStatus().endpointName).toBe('MyCustomServer');
            expect(mockEncodeProcessManageModel.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    cmd: expect.stringContaining('rtmps://custom.server.invalid:443/live/key'),
                }),
            );
        });
    });

    describe('child process event handling', () => {
        it('sets error status on unexpected process exit during streaming', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.emit('exit', 1, null);

            const status = model.getStatus();
            expect(status.isStreaming).toBe(false);
            expect(status.status).toBe('error');
            expect(status.errorMessage).toContain('プロセスが予期せず終了しました (code: 1, signal: null)');
        });

        it('sets error status on process exit with signal during streaming', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.emit('exit', null, 'SIGABRT');

            const status = model.getStatus();
            expect(status.status).toBe('error');
            expect(status.errorMessage).toContain('code: null, signal: SIGABRT');
        });

        it('sets error status on process error event', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.emit('error', new Error('Child crashed'));

            const status = model.getStatus();
            expect(status.status).toBe('error');
            expect(status.errorMessage).toBe('Child crashed');
        });

        it('logs warning when stderr data contains error keyword', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.stderr.emit('data', Buffer.from('[ffmpeg] Connection error: connection refused'));
            expect(mockLogger.stream.warn).toHaveBeenCalledWith(
                expect.stringContaining('Connection error: connection refused'),
            );
        });

        it('does not log warning when stderr data contains normal progress', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.stderr.emit('data', Buffer.from('frame= 120 fps=30 q=-1.0 size= 512kB time=00:00:04.00 bitrate=1048.5kbits/s'));
            expect(mockLogger.stream.warn).not.toHaveBeenCalled();
        });

        it('handles process without stderr gracefully', async () => {
            child.stderr = null;
            const model = createModel();
            await expect(model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' })).resolves.not.toThrow();
        });

        it('ignores exit event from a superseded process', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key-1' });

            const oldChild = child;
            const newChild = fakeChild();
            newChild.killed = false;
            mockEncodeProcessManageModel.create.mockResolvedValueOnce(newChild);

            await model.start({ channelId: 102, endpointName: 'YouTube', streamKey: 'key-2' });

            // Old child exits - should NOT affect new child's streaming status
            oldChild.emit('exit', 0, null);
            expect(model.getStatus().status).toBe('streaming');
            expect(model.getStatus().channelId).toBe(102);

            // Old child emits error - should NOT affect new child
            oldChild.emit('error', new Error('Late error'));
            expect(model.getStatus().status).toBe('streaming');
        });
    });

    describe('stop lifecycle and force kill', () => {
        it('returns immediately when stop is called on idle model', async () => {
            const model = createModel();
            await model.stop();
            expect(model.getStatus().status).toBe('idle');
            expect(mockLogger.stream.info).not.toHaveBeenCalled();
        });

        it('schedules SIGKILL if process does not exit within timeout', async () => {
            vi.useFakeTimers();
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.kill = vi.fn((sig: string) => {
                if (sig === 'SIGKILL') {
                    child.killed = true;
                }
                return true;
            });

            await model.stop();
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
            expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

            // Advance past 5000ms
            vi.advanceTimersByTime(5000);

            expect(child.kill).toHaveBeenCalledWith('SIGKILL');
            expect(mockLogger.stream.warn).toHaveBeenCalledWith('RTMPライブ配信プロセスを強制終了します');
        });

        it('clears force kill timer if process exits before timeout', async () => {
            vi.useFakeTimers();
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            await model.stop();
            // Process exits at 2000ms
            vi.advanceTimersByTime(2000);
            child.emit('exit', 0, null);

            // Advance to 6000ms
            vi.advanceTimersByTime(4000);

            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
            expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
        });

        it('handles exception thrown by kill gracefully', async () => {
            const model = createModel();
            await model.start({ channelId: 101, endpointName: 'YouTube', streamKey: 'key' });

            child.kill = vi.fn(() => {
                throw new Error('Kill permission denied');
            });

            await model.stop();
            const status = model.getStatus();
            expect(status.status).toBe('error');
            expect(status.errorMessage).toBe('Kill permission denied');
        });
    });

    describe('getEndpoints empty states', () => {
        it('returns empty array when rtmp config is undefined', () => {
            const model = createModel({ rtmp: undefined });
            expect(model.getEndpoints()).toEqual([]);
        });

        it('returns empty array when endpoints is undefined in rtmp config', () => {
            const model = createModel({ rtmp: { cmd: '...' } });
            expect(model.getEndpoints()).toEqual([]);
        });
    });
});
