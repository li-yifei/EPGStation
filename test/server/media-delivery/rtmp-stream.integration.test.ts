import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { compiled, logger, prepareEncodeProcessManageModel, spawnStub } from './_media-harness';

const RTMPStreamModel = compiled<any>('model', 'api', 'rtmp', 'RTMPStreamModel.js').default;
let EncodeProcessManageModel: new (...args: any[]) => any;

/**
 * Synthetic stand-in for ffmpeg. It records its arguments and the number of bytes read from stdin, exits on
 * SIGINT (like ffmpeg) unless started in `ignore-sigint` mode, and otherwise keeps running.
 */
const FAKE_FFMPEG = `
const fs = require('node:fs');
const [mode, ...rest] = process.argv.slice(2);
const out = rest[rest.length - 1];
let bytes = 0;
const record = () => fs.writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), bytes }));
record();
process.stdin.on('data', chunk => { bytes += chunk.length; record(); });
process.on('SIGINT', () => { if (mode !== 'ignore-sigint') process.exit(0); });
setInterval(() => {}, 1000);
`;

describe('RTMP live streaming across the tuner stream, process manager, and a real child process', () => {
    let dir: string;
    let scriptPath: string;
    let outputPath: string;
    let reporter: { started: ReturnType<typeof vi.fn>; ended: ReturnType<typeof vi.fn> };
    let processManager: any;
    let tunerStream: PassThrough;
    let tunerClose: ReturnType<typeof vi.fn>;
    let model: any;

    const createModel = (mode: 'graceful' | 'ignore-sigint') => {
        const log = logger();
        const config = {
            ffmpeg: process.argv[0],
            streamingPriority: 2,
            rtmp: {
                endpoints: [{ name: 'synthetic-a', url: 'rtmp://rtmp-a.invalid/live', description: '' }],
                cmd: `%FFMPEG% ${scriptPath} ${mode} %INPUT% %RTMP_URL% ${outputPath}`,
            },
        };
        processManager = new EncodeProcessManageModel(
            { getLogger: () => log },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
            reporter,
        );
        const tuner = {
            openServiceStream: vi.fn(async () => {
                tunerStream = new PassThrough();
                tunerClose = vi.fn(() => tunerStream.destroy());
                return { stream: tunerStream, close: tunerClose };
            }),
        };
        model = new RTMPStreamModel({ getLogger: () => log }, { getConfig: () => config }, processManager, tuner);
        return { log, tuner };
    };

    const recorded = (): { argv: string[]; bytes: number } => JSON.parse(readFileSync(outputPath, 'utf8'));

    beforeAll(async () => {
        EncodeProcessManageModel = await prepareEncodeProcessManageModel();
    });

    beforeEach(() => {
        spawnStub.mockReset();
        dir = mkdtempSync(join(tmpdir(), 'epg-rtmp-'));
        scriptPath = join(dir, 'fake-ffmpeg.cjs');
        outputPath = join(dir, 'fake-ffmpeg.json');
        writeFileSync(scriptPath, FAKE_FFMPEG);
        reporter = { started: vi.fn(), ended: vi.fn() };
    });

    afterEach(async () => {
        await model?.stop().catch(() => undefined);
        rmSync(dir, { force: true, recursive: true });
        vi.resetAllMocks();
    });

    it('[MD-11.2][MD-11.8][MD-11.9] feeds tuner bytes to the real child, passes the RTMP url as one argument, and reports the process', async () => {
        createModel('graceful');

        await model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: 'synthetic-key' });
        tunerStream.write(Buffer.alloc(188 * 10));

        await vi.waitFor(() => expect(recorded().bytes).toBe(188 * 10));
        expect(recorded().argv).toEqual(['graceful', 'pipe:0', 'rtmp://rtmp-a.invalid/live/synthetic-key', outputPath]);
        expect(reporter.started).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stream' }));
        expect(model.getStatus().status).toBe('streaming');
    });

    it('[MD-11.7][MD-11.9] stops the real child with SIGINT, releases the slot and the tuner, and returns to idle', async () => {
        createModel('graceful');
        await model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: 'synthetic-key' });
        const [{ pid }] = reporter.started.mock.calls[0];

        await model.stop();

        expect(reporter.ended).toHaveBeenCalledWith(pid);
        expect(processManager.childs).toHaveLength(0);
        expect(tunerClose).toHaveBeenCalledTimes(1);
        expect(model.getStatus().status).toBe('idle');
    });

    it('[MD-11.4] replaces a running stream within a single encode slot', async () => {
        createModel('graceful');
        await model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: 'synthetic-key' });

        await model.start({ channelId: 2, url: 'rtmp://rtmp-b.invalid/app', streamKey: 'synthetic-key-2' });

        await vi.waitFor(() =>
            expect(recorded().argv).toEqual([
                'graceful',
                'pipe:0',
                'rtmp://rtmp-b.invalid/app/synthetic-key-2',
                outputPath,
            ]),
        );
        expect(reporter.started).toHaveBeenCalledTimes(2);
        expect(reporter.ended).toHaveBeenCalledTimes(1);
        expect(model.getStatus()).toMatchObject({ status: 'streaming', channelId: 2, endpointName: 'custom' });
    });

    it('[MD-11.7] kills a child that ignores SIGINT after the stop timeout', async () => {
        createModel('ignore-sigint');
        await model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: 'synthetic-key' });
        const [{ pid }] = reporter.started.mock.calls[0];

        await model.stop();

        expect(reporter.ended).toHaveBeenCalledWith(pid);
        expect(() => process.kill(pid, 0)).toThrow();
        expect(model.getStatus().status).toBe('idle');
    }, 20_000);

    it('[MD-11.6] records error when the real child exits on its own while streaming', async () => {
        createModel('graceful');
        await model.start({ channelId: 1, endpointName: 'synthetic-a', streamKey: 'synthetic-key' });
        const [{ pid }] = reporter.started.mock.calls[0];

        process.kill(pid, 'SIGTERM');

        await vi.waitFor(() => expect(model.getStatus().status).toBe('error'));
        await vi.waitFor(() => expect(tunerClose).toHaveBeenCalledTimes(1));
        expect(model.getStatus().errorMessage).toContain('SIGTERM');
    });
});
