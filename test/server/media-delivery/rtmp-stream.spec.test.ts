import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const RTMPStreamModel = compiled<any>('model', 'api', 'rtmp', 'RTMPStreamModel.js').default;

describe('RTMPStreamModel (unittest/spec)', () => {
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
                    {
                        description: 'Twitch',
                        name: 'Twitch',
                        url: 'rtmp://twitch.invalid/live/',
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

    const createModel = () =>
        new RTMPStreamModel(
            { getLogger: () => mockLogger },
            { getConfig: () => mockConfig },
            mockEncodeProcessManageModel,
        );

    it('initializes in idle state', () => {
        const model = createModel();
        const status = model.getStatus();
        expect(status).toEqual({
            isStreaming: false,
            status: 'idle',
            channelId: undefined,
            endpointName: undefined,
            startTime: undefined,
            errorMessage: undefined,
        });
    });

    it('returns configured RTMP endpoints', () => {
        const model = createModel();
        const endpoints = model.getEndpoints();
        expect(endpoints).toEqual([
            {
                description: 'YouTube Live',
                name: 'YouTube',
                url: 'rtmp://youtube.invalid/live2/',
            },
            {
                description: 'Twitch',
                name: 'Twitch',
                url: 'rtmp://twitch.invalid/live/',
            },
        ]);
    });

    it('starts an RTMP stream using a preset endpoint', async () => {
        const model = createModel();

        await model.start({
            channelId: 101,
            endpointName: 'YouTube',
            streamKey: 'secret-key-123',
        });

        expect(mockEncodeProcessManageModel.create).toHaveBeenCalledWith({
            cmd: '/usr/local/bin/ffmpeg -i http://mirakurun.invalid:40772/api/services/101/stream -c copy -f flv rtmp://youtube.invalid/live2/secret-key-123',
            input: null,
            output: null,
            priority: 1,
        });

        const status = model.getStatus();
        expect(status.isStreaming).toBe(true);
        expect(status.status).toBe('streaming');
        expect(status.channelId).toBe(101);
        expect(status.endpointName).toBe('YouTube');
        expect(status.startTime).toBeTypeOf('number');
        expect(status.errorMessage).toBeUndefined();
    });

    it('starts an RTMP stream using a custom URL directly', async () => {
        const model = createModel();

        await model.start({
            channelId: 202,
            url: 'rtmp://custom.invalid/app',
            streamKey: 'custom-key-456',
        });

        expect(mockEncodeProcessManageModel.create).toHaveBeenCalledWith({
            cmd: '/usr/local/bin/ffmpeg -i http://mirakurun.invalid:40772/api/services/202/stream -c copy -f flv rtmp://custom.invalid/app/custom-key-456',
            input: null,
            output: null,
            priority: 1,
        });

        const status = model.getStatus();
        expect(status.isStreaming).toBe(true);
        expect(status.status).toBe('streaming');
        expect(status.channelId).toBe(202);
        expect(status.endpointName).toBe('Custom');
    });

    it('stops an active RTMP stream and resets state upon process exit', async () => {
        const model = createModel();

        await model.start({
            channelId: 101,
            endpointName: 'YouTube',
            streamKey: 'key',
        });

        expect(model.getStatus().isStreaming).toBe(true);

        const stopPromise = model.stop();
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(model.getStatus().status).toBe('stopping');
        await stopPromise;

        // Simulate child process exit in response to SIGTERM
        child.emit('exit', 0, null);

        const status = model.getStatus();
        expect(status.isStreaming).toBe(false);
        expect(status.status).toBe('idle');
        expect(status.channelId).toBeUndefined();
    });

    it('stops existing stream automatically when starting a new stream', async () => {
        const model = createModel();

        await model.start({
            channelId: 101,
            endpointName: 'YouTube',
            streamKey: 'key-1',
        });

        const firstChild = child;
        const secondChild = fakeChild();
        secondChild.killed = false;
        mockEncodeProcessManageModel.create.mockResolvedValueOnce(secondChild);

        await model.start({
            channelId: 102,
            endpointName: 'Twitch',
            streamKey: 'key-2',
        });

        expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM');
        expect(model.getStatus().channelId).toBe(102);
        expect(model.getStatus().endpointName).toBe('Twitch');
        expect(model.getStatus().isStreaming).toBe(true);
    });
});
