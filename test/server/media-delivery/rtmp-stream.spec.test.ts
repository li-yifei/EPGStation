import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseConfig, compiled, deferred, fakeChild, logger } from './_media-harness';

const RTMPModule = compiled<any>('model', 'api', 'rtmp', 'RTMPStreamModel.js');
const RTMPStreamModel = RTMPModule.default;
const { RTMP_STOP_TIMEOUT_MS } = RTMPModule;
const { RTMPStreamRequestError } = compiled<any>('model', 'api', 'rtmp', 'IRTMPStreamModel.js');

const STREAM_KEY = 'synthetic-stream-key';

const rtmpConfig = () => ({
    endpoints: [
        { name: 'synthetic-a', url: 'rtmp://rtmp-a.invalid/live', description: 'synthetic endpoint a' },
        { name: 'synthetic-b', url: 'rtmps://rtmp-b.invalid/app/', description: 'synthetic endpoint b' },
    ],
    cmd: '%FFMPEG% -i %INPUT% -c copy -f flv %RTMP_URL%',
});

interface Harness {
    model: any;
    log: ReturnType<typeof logger>;
    config: Record<string, any>;
    tuner: { openServiceStream: ReturnType<typeof vi.fn> };
    tunerHandles: Array<{ stream: PassThrough; close: ReturnType<typeof vi.fn> }>;
    manager: { createManaged: ReturnType<typeof vi.fn>; requestStop: ReturnType<typeof vi.fn> };
    children: any[];
}

/** A child double that exits when the manager's stop request arrives, like ffmpeg does on SIGINT. */
const exitingChild = (): any => {
    const child = fakeChild();
    child.signalCode = null;
    return child;
};

const exit = (child: any, code: number | null, signal: string | null = null): void => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
};

const createHarness = (configOverrides: Record<string, unknown> = {}): Harness => {
    const log = logger();
    const config = baseConfig({
        ffmpeg: 'synthetic-ffmpeg',
        rtmp: rtmpConfig(),
        streamingPriority: 7,
        ...configOverrides,
    });
    const tunerHandles: Harness['tunerHandles'] = [];
    const tuner = {
        openServiceStream: vi.fn(async () => {
            const handle = { stream: new PassThrough(), close: vi.fn() };
            tunerHandles.push(handle);
            return handle;
        }),
    };
    const children: any[] = [];
    const handles = new Map<object, any>();
    const manager = {
        createManaged: vi.fn(async () => {
            const child = exitingChild();
            const handle = {};
            handles.set(handle, child);
            children.push(child);
            return { child, handle };
        }),
        requestStop: vi.fn(async (handle: object) => {
            const child = handles.get(handle);
            if (child.exitCode === null && child.signalCode === null) exit(child, null, 'SIGINT');
            return { status: 'requested', sentSignals: ['SIGINT'] };
        }),
    };
    const model = new RTMPStreamModel({ getLogger: () => log }, { getConfig: () => config }, manager, tuner);
    return { model, log, config, tuner, tunerHandles, manager, children };
};

const loggedText = (log: ReturnType<typeof logger>): string =>
    JSON.stringify(Object.values(log).flatMap(category => Object.values(category).flatMap((fn: any) => fn.mock.calls)));

describe('RTMPStreamModel (unittest/spec)', () => {
    let h: Harness;

    beforeEach(() => {
        h = createHarness();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('[MD-11.1] starts idle without channel, endpoint, start time, or error', () => {
        expect(h.model.getStatus()).toEqual({
            isStreaming: false,
            status: 'idle',
            channelId: undefined,
            endpointName: undefined,
            startTime: undefined,
            errorMessage: undefined,
        });
    });

    it('[MD-11.2][MD-11.8][MD-11.9] pipes the tuner service stream into a managed, reported process built from the template', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

        await h.model.start({ channelId: 3_239_123_608, endpointName: 'synthetic-a', streamKey: STREAM_KEY });

        expect(h.tuner.openServiceStream).toHaveBeenCalledWith({ serviceId: 3_239_123_608, priority: 7 });
        expect(h.manager.createManaged).toHaveBeenCalledWith({
            input: 'pipe:0',
            output: null,
            cmd: `synthetic-ffmpeg -i %INPUT% -c copy -f flv rtmp://rtmp-a.invalid/live/${STREAM_KEY}`,
            priority: 1,
            report: { kind: 'stream' },
        });
        const received: Buffer[] = [];
        h.children[0].stdin.on('data', (chunk: Buffer) => received.push(chunk));
        h.tunerHandles[0].stream.write(Buffer.from('synthetic-ts-packet'));
        await new Promise(resolve => setImmediate(resolve));
        expect(Buffer.concat(received).toString()).toBe('synthetic-ts-packet');
        expect(h.model.getStatus()).toEqual({
            isStreaming: true,
            status: 'streaming',
            channelId: 3_239_123_608,
            endpointName: 'synthetic-a',
            startTime: 1_700_000_000_000,
            errorMessage: undefined,
        });
    });

    it('[MD-11.2][MD-11.8] uses a direct rtmps url without doubling its trailing slash and names the endpoint custom', async () => {
        await h.model.start({ channelId: 1, url: 'rtmps://rtmp-c.invalid/app/', streamKey: STREAM_KEY });

        expect(h.manager.createManaged.mock.calls[0][0].cmd).toBe(
            `synthetic-ffmpeg -i %INPUT% -c copy -f flv rtmps://rtmp-c.invalid/app/${STREAM_KEY}`,
        );
        expect(h.model.getStatus().endpointName).toBe('custom');
    });

    it('[MD-11.2] prefers url over endpointName and keeps a caller-supplied endpoint label', async () => {
        await h.model.start({
            channelId: 1,
            endpointName: 'synthetic-label',
            url: 'rtmp://rtmp-c.invalid/app',
            streamKey: STREAM_KEY,
        });

        expect(h.manager.createManaged.mock.calls[0][0].cmd).toContain(`rtmp://rtmp-c.invalid/app/${STREAM_KEY}`);
        expect(h.model.getStatus().endpointName).toBe('synthetic-label');
    });

    it.each([
        ['channelId 0', { channelId: 0, endpointName: 'synthetic-a', streamKey: STREAM_KEY }],
        ['a negative channelId', { channelId: -1, endpointName: 'synthetic-a', streamKey: STREAM_KEY }],
        ['a fractional channelId', { channelId: 1.5, endpointName: 'synthetic-a', streamKey: STREAM_KEY }],
        ['a NaN channelId', { channelId: Number.NaN, endpointName: 'synthetic-a', streamKey: STREAM_KEY }],
        [
            'an unsafe channelId',
            { channelId: Number.MAX_SAFE_INTEGER + 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY },
        ],
        ['an empty stream key', { channelId: 1, endpointName: 'synthetic-a', streamKey: '' }],
        ['a stream key with a space', { channelId: 1, endpointName: 'synthetic-a', streamKey: 'key -y /x' }],
        ['a stream key with a tab', { channelId: 1, endpointName: 'synthetic-a', streamKey: 'key\tx' }],
        ['a non-string stream key', { channelId: 1, endpointName: 'synthetic-a', streamKey: 1 }],
        ['an http url', { channelId: 1, url: 'http://rtmp-c.invalid/app', streamKey: STREAM_KEY }],
        ['a url without host', { channelId: 1, url: 'rtmp://', streamKey: STREAM_KEY }],
        ['a url with a space', { channelId: 1, url: 'rtmp://rtmp-c.invalid/app -y /x', streamKey: STREAM_KEY }],
        ['an unknown endpoint', { channelId: 1, endpointName: 'synthetic-missing', streamKey: STREAM_KEY }],
        ['no destination', { channelId: 1, streamKey: STREAM_KEY }],
        ['an empty destination', { channelId: 1, endpointName: '', url: '', streamKey: STREAM_KEY }],
    ])('[MD-11.3] rejects %s as a bad request without touching the running stream', async (_label, option) => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        const before = h.model.getStatus();

        await expect(h.model.start(option)).rejects.toBeInstanceOf(RTMPStreamRequestError);

        expect(h.model.getStatus()).toEqual(before);
        expect(h.manager.requestStop).not.toHaveBeenCalled();
        expect(h.tuner.openServiceStream).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
    ])('[MD-11.3] rejects every start as a bad request when rtmp is %s', async (_label, rtmp) => {
        h = createHarness({ rtmp });

        await expect(
            h.model.start({ channelId: 1, url: 'rtmp://rtmp-c.invalid/app', streamKey: STREAM_KEY }),
        ).rejects.toBeInstanceOf(RTMPStreamRequestError);
        expect(h.model.getEndpoints()).toEqual([]);
    });

    it.each([
        ['an omitted cmd', { endpoints: [] }],
        ['a cmd without %RTMP_URL%', { endpoints: [], cmd: '%FFMPEG% -i %INPUT% -f flv' }],
    ])('[MD-11.3] fails the start as a configuration error for %s without stopping the running stream', async (_label, rtmp) => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        h.config.rtmp = rtmp;

        const failed = h.model.start({ channelId: 2, url: 'rtmp://rtmp-c.invalid/app', streamKey: STREAM_KEY });

        await expect(failed).rejects.toThrow('config error: rtmp.cmd must contain %RTMP_URL%');
        await expect(failed).rejects.not.toBeInstanceOf(RTMPStreamRequestError);
        expect(h.manager.requestStop).not.toHaveBeenCalled();
        expect(h.model.getStatus().status).toBe('streaming');
    });

    it('[MD-11.3] fails the start as a configuration error for a configured endpoint url that would split the command', async () => {
        h.config.rtmp.endpoints.push({ name: 'synthetic-broken', url: 'rtmp://rtmp-d.invalid/live -y', description: '' });

        await expect(
            h.model.start({ channelId: 1, endpointName: 'synthetic-broken', streamKey: STREAM_KEY }),
        ).rejects.toThrow('config error: rtmp endpoint url is invalid: synthetic-broken');
        expect(h.tuner.openServiceStream).not.toHaveBeenCalled();
    });

    it('[MD-11.11] treats omitted endpoints as an empty list and an endpoint name as unknown', async () => {
        h = createHarness({ rtmp: { cmd: '%FFMPEG% -f flv %RTMP_URL%' } });

        expect(h.model.getEndpoints()).toEqual([]);
        await expect(
            h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY }),
        ).rejects.toBeInstanceOf(RTMPStreamRequestError);
    });

    it('[MD-11.4] finishes stopping the running stream before opening the next one', async () => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        const first = h.children[0];

        await h.model.start({ channelId: 2, endpointName: 'synthetic-b', streamKey: STREAM_KEY });

        expect(first.exitCode !== null || first.signalCode !== null).toBe(true);
        expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1);
        expect(h.manager.requestStop.mock.invocationCallOrder[0]).toBeLessThan(
            h.tuner.openServiceStream.mock.invocationCallOrder[1],
        );
        expect(h.model.getStatus()).toMatchObject({ status: 'streaming', channelId: 2, endpointName: 'synthetic-b' });
    });

    it('[MD-11.4] processes concurrent starts and a stop one at a time in arrival order', async () => {
        const firstTuner = deferred<any>();
        h.tuner.openServiceStream.mockImplementationOnce(() => firstTuner.promise);

        const first = h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        const second = h.model.start({ channelId: 2, endpointName: 'synthetic-b', streamKey: STREAM_KEY });
        const stopped = h.model.stop();
        await new Promise(resolve => setImmediate(resolve));
        expect(h.tuner.openServiceStream).toHaveBeenCalledTimes(1);

        const firstHandle = { stream: new PassThrough(), close: vi.fn() };
        firstTuner.resolve(firstHandle);
        await first;
        await second;
        await stopped;

        expect(h.manager.createManaged).toHaveBeenCalledTimes(2);
        expect(h.children.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true);
        expect(firstHandle.close).toHaveBeenCalledTimes(1);
        expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus().status).toBe('idle');
    });

    it('[MD-11.5] fails the start and records error when the tuner stream cannot be opened', async () => {
        h.tuner.openServiceStream.mockRejectedValueOnce(new Error('synthetic tuner failure'));

        await expect(
            h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY }),
        ).rejects.toThrow('synthetic tuner failure');

        expect(h.manager.createManaged).not.toHaveBeenCalled();
        expect(h.model.getStatus()).toMatchObject({ status: 'error', errorMessage: 'synthetic tuner failure' });
    });

    it('[MD-11.5] closes the opened tuner stream when the process cannot be started', async () => {
        h.manager.createManaged.mockRejectedValueOnce(new Error('CmdBinIsNotFound'));

        await expect(
            h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY }),
        ).rejects.toThrow('CmdBinIsNotFound');

        expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus()).toMatchObject({ status: 'error', errorMessage: 'CmdBinIsNotFound' });
    });

    it('[MD-11.5] fails the start when the process has already exited, and releases the tuner stream', async () => {
        h.manager.createManaged.mockImplementationOnce(async () => {
            const child = exitingChild();
            child.exitCode = 1;
            h.children.push(child);
            return { child, handle: {} };
        });

        await expect(
            h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY }),
        ).rejects.toThrow('code=1');

        expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus().status).toBe('error');
    });

    it('[MD-11.6] records error and releases the tuner stream when the process exits while streaming', async () => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });

        exit(h.children[0], 1);
        await vi.waitFor(() => expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1));

        expect(h.model.getStatus()).toMatchObject({
            isStreaming: false,
            status: 'error',
            channelId: 1,
            errorMessage: expect.stringContaining('code=1'),
        });
    });

    it.each([
        ['end', (stream: PassThrough) => stream.end()],
        ['error', (stream: PassThrough) => stream.destroy(new Error('synthetic tuner reset'))],
    ])(
        '[MD-11.6] records error and stops the process when the tuner stream emits %s while streaming',
        async (_label, finish) => {
            await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });

            finish(h.tunerHandles[0].stream);
            h.tunerHandles[0].stream.resume();

            await vi.waitFor(() => expect(h.manager.requestStop).toHaveBeenCalledTimes(1));
            await vi.waitFor(() => expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1));
            expect(h.model.getStatus().status).toBe('error');
        },
    );

    it('[MD-11.7] stops with SIGINT, closes the tuner stream, and returns to idle only after the process exits', async () => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        const exited = deferred<void>();
        h.manager.requestStop.mockImplementationOnce(async () => {
            exited.promise.then(() => exit(h.children[0], null, 'SIGINT'));
            return { status: 'requested', sentSignals: ['SIGINT'] };
        });

        const stopping = h.model.stop();
        await vi.waitFor(() => expect(h.manager.requestStop).toHaveBeenCalledTimes(1));
        expect(h.model.getStatus().status).toBe('stopping');
        expect(h.tunerHandles[0].close).not.toHaveBeenCalled();

        exited.resolve();
        await stopping;

        expect(h.children[0].kill).not.toHaveBeenCalledWith('SIGKILL');
        expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus()).toEqual({
            isStreaming: false,
            status: 'idle',
            channelId: undefined,
            endpointName: undefined,
            startTime: undefined,
            errorMessage: undefined,
        });
    });

    it('[MD-11.7] sends SIGKILL when the process does not exit within the stop timeout', async () => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        const child = h.children[0];
        h.manager.requestStop.mockResolvedValueOnce({ status: 'requested', sentSignals: ['SIGINT'] });
        child.kill.mockImplementation((signal: string) => {
            if (signal === 'SIGKILL') exit(child, null, 'SIGKILL');
            return true;
        });
        vi.useFakeTimers();

        const stopping = h.model.stop();
        await vi.advanceTimersByTimeAsync(RTMP_STOP_TIMEOUT_MS - 1);
        expect(child.kill).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await stopping;

        expect(RTMP_STOP_TIMEOUT_MS).toBe(5000);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(h.tunerHandles[0].close).toHaveBeenCalledTimes(1);
        expect(h.model.getStatus().status).toBe('idle');
    });

    it('[MD-11.7] returns from error to idle on stop even though no process is left', async () => {
        h.tuner.openServiceStream.mockRejectedValueOnce(new Error('synthetic tuner failure'));
        await h.model
            .start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY })
            .catch(() => undefined);
        expect(h.model.getStatus().status).toBe('error');

        await h.model.stop();

        expect(h.model.getStatus().status).toBe('idle');
    });

    it('[MD-11.7] does nothing when stopped while idle', async () => {
        await h.model.stop();

        expect(h.manager.requestStop).not.toHaveBeenCalled();
        expect(h.model.getStatus().status).toBe('idle');
    });

    it('[MD-11.10] never writes the stream key to the logs, including the command and process output', async () => {
        await h.model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: STREAM_KEY });
        h.children[0].stderr.write(`[flv] rtmp://rtmp-a.invalid/live/${STREAM_KEY}: Error opening output\n`);
        await new Promise(resolve => setImmediate(resolve));
        exit(h.children[0], 1);
        await vi.waitFor(() => expect(h.tunerHandles[0].close).toHaveBeenCalled());

        const logs = loggedText(h.log);
        expect(logs).toContain('rtmp://rtmp-a.invalid/live/***');
        expect(logs).not.toContain(STREAM_KEY);
        expect(JSON.stringify(h.model.getStatus())).not.toContain(STREAM_KEY);
    });

    it('[MD-11.11] lists the configured endpoints and an empty list without rtmp', () => {
        expect(h.model.getEndpoints()).toEqual(rtmpConfig().endpoints);
        expect(createHarness({ rtmp: undefined }).model.getEndpoints()).toEqual([]);
    });
});
