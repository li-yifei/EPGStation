import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const RTMPModule = compiled<any>('model', 'api', 'rtmp', 'RTMPStreamModel.js');
const RTMPStreamModel = RTMPModule.default;
const { RTMP_STOP_TIMEOUT_MS } = RTMPModule;

const STREAM_KEY = 'synthetic-stream-key';
const START = { channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY };

const exit = (child: any, code: number | null, signal: string | null = null): void => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
};

/** A child double whose stdin/stderr can be removed, and which exits when the stop request arrives. */
const makeChild = (overrides: Record<string, unknown> = {}): any => {
    const child = fakeChild();
    child.signalCode = null;
    Object.assign(child, overrides);
    return child;
};

const createHarness = (options: { child?: any; stream?: PassThrough } = {}) => {
    const log = logger();
    const config = baseConfig({
        rtmp: {
            endpoints: [{ name: 'synthetic-a', url: 'rtmp://rtmp-a.invalid/live/', description: 'a' }],
            cmd: '%FFMPEG% -i %INPUT% -f flv %RTMP_URL%',
        },
    });
    const stream = options.stream ?? new PassThrough();
    const tunerHandle = { stream, close: vi.fn() };
    const tuner = { openServiceStream: vi.fn(async () => tunerHandle) };
    const child = options.child ?? makeChild();
    const manager = {
        createManaged: vi.fn(async () => ({ child, handle: {} })),
        requestStop: vi.fn(async () => {
            if (child.exitCode === null && child.signalCode === null) exit(child, null, 'SIGINT');
            return { status: 'requested', sentSignals: ['SIGINT'] };
        }),
    };
    const model = new RTMPStreamModel({ getLogger: () => log }, { getConfig: () => config }, manager, tuner);
    return { model, log, config, tuner, tunerHandle, manager, child };
};

describe('RTMPStreamModel (unittest/imp)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns copies of the configured endpoints', () => {
        const h = createHarness();

        h.model.getEndpoints()[0].url = 'rtmp://changed.invalid/';

        expect(h.config.rtmp.endpoints[0].url).toBe('rtmp://rtmp-a.invalid/live/');
    });

    it('records a non-Error rejection from the tuner as the error message', async () => {
        const h = createHarness();
        h.tuner.openServiceStream.mockRejectedValueOnce('synthetic-string-failure');

        await expect(h.model.start(START)).rejects.toBe('synthetic-string-failure');

        expect(h.model.getStatus()).toMatchObject({ status: 'error', errorMessage: 'synthetic-string-failure' });
    });

    it('masks the stream key in a start failure message', async () => {
        const h = createHarness();
        h.manager.createManaged.mockRejectedValueOnce(
            new Error(`cannot open rtmp://rtmp-a.invalid/live/${STREAM_KEY}`),
        );

        await expect(h.model.start(START)).rejects.toThrow();

        expect(h.model.getStatus().errorMessage).toBe('cannot open rtmp://rtmp-a.invalid/live/***');
    });

    it('fails the start, stops the process, and closes the tuner when the process has no stdin', async () => {
        const h = createHarness({ child: makeChild({ stdin: null, stderr: null }) });

        await expect(h.model.start(START)).rejects.toThrow('rtmp process stdin is null');

        expect(h.manager.requestStop).toHaveBeenCalledTimes(1);
        expect(h.tunerHandle.close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus().status).toBe('error');
    });

    it.each([
        ['already destroyed', (stream: PassThrough) => stream.destroy()],
        [
            'already ended',
            (stream: PassThrough) => {
                stream.end();
                stream.resume();
            },
        ],
    ])('fails the start when the tuner stream is %s at attach time', async (_label, finish) => {
        const stream = new PassThrough();
        const h = createHarness({ stream });
        h.tuner.openServiceStream.mockImplementationOnce(async () => {
            finish(stream);
            await new Promise(resolve => setImmediate(resolve));
            return h.tunerHandle;
        });

        await expect(h.model.start(START)).rejects.toThrow('tuner stream ended');

        expect(h.model.getStatus()).toMatchObject({ status: 'error', errorMessage: 'tuner stream ended' });
    });

    it('records a masked process error event and ignores the exit that follows it', async () => {
        const h = createHarness();
        await h.model.start(START);

        h.child.emit('error', new Error(`spawn failed for ${STREAM_KEY}`));
        exit(h.child, 1);

        await vi.waitFor(() => expect(h.tunerHandle.close).toHaveBeenCalledTimes(1));
        expect(h.model.getStatus().errorMessage).toBe('rtmp process error: spawn failed for ***');
        expect(h.log.stream.error).toHaveBeenCalledTimes(1);
    });

    it('logs a stdin error without ending the stream', async () => {
        const h = createHarness();
        await h.model.start(START);

        h.child.stdin.emit('error', new Error('EPIPE'));

        expect(h.log.stream.error).toHaveBeenCalledWith('rtmp process stdin error: EPIPE');
        expect(h.model.getStatus().status).toBe('streaming');
    });

    it('skips the queued cleanup when a stop already released the session', async () => {
        const h = createHarness();
        await h.model.start(START);

        const stopping = h.model.stop();
        exit(h.child, 1);
        await stopping;
        await h.model.stop();

        expect(h.manager.requestStop).toHaveBeenCalledTimes(1);
        expect(h.tunerHandle.close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus().status).toBe('idle');
    });

    it('logs and continues when requestStop, SIGKILL, and tuner close all fail, and the process never exits', async () => {
        const h = createHarness();
        await h.model.start(START);
        h.manager.requestStop.mockRejectedValueOnce(new Error('synthetic request failure'));
        h.child.kill.mockImplementation(() => {
            throw new Error('synthetic kill failure');
        });
        h.tunerHandle.close.mockImplementation(() => {
            throw 'synthetic-close-failure';
        });
        vi.useFakeTimers();

        const stopping = h.model.stop();
        await vi.advanceTimersByTimeAsync(RTMP_STOP_TIMEOUT_MS * 2);
        await stopping;

        expect(h.log.stream.error).toHaveBeenCalledWith('rtmp request stop error: synthetic request failure');
        expect(h.log.stream.error).toHaveBeenCalledWith('rtmp kill error: synthetic kill failure');
        expect(h.log.stream.error).toHaveBeenCalledWith('rtmp process did not exit after SIGKILL');
        expect(h.log.stream.error).toHaveBeenCalledWith('rtmp close tuner stream error: synthetic-close-failure');
        expect(h.model.getStatus().status).toBe('idle');
    });

    it('keeps processing queued operations after one of them fails', async () => {
        const h = createHarness();
        h.tuner.openServiceStream.mockRejectedValueOnce(new Error('synthetic tuner failure'));

        const failed = h.model.start(START);
        const succeeded = h.model.start(START);

        await expect(failed).rejects.toThrow('synthetic tuner failure');
        await succeeded;
        expect(h.model.getStatus().status).toBe('streaming');
    });
});
