import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from './_harness';

const rtmpRoute = require(compiled('model', 'service', 'api', 'rtmp.js')) as {
    get: (req: any, res: any) => Promise<void>;
    post: (req: any, res: any) => Promise<void>;
    del: (req: any, res: any) => Promise<void>;
};

const { RTMPStreamRequestError } = require(compiled('model', 'api', 'rtmp', 'IRTMPStreamModel.js')) as {
    RTMPStreamRequestError: new (message: string) => Error;
};

const endpointsRoute = require(compiled('model', 'service', 'api', 'rtmp', 'endpoints.js')) as {
    get: (req: any, res: any) => Promise<void>;
};

const makeResponse = () => {
    const res: Record<string, any> = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        status: vi.fn((code: number) => {
            res.statusCode = code;
            return res;
        }),
        header: vi.fn((name: string, value: string) => {
            res.headers[name] = value;
            return res;
        }),
        json: vi.fn((body: any) => {
            res.body = body;
            return res;
        }),
    };
    return res;
};

const makeRequest = (overrides: Record<string, any> = {}) => ({
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
});

describe('RTMP API routes (unittest/spec)', () => {
    let model: {
        getStatus: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        getEndpoints: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        model = { getStatus: vi.fn(), start: vi.fn(), stop: vi.fn(), getEndpoints: vi.fn() };
        vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IRTMPStreamModel') return model;
            throw new Error(`Unexpected DI token: ${token}`);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[MD-11.1] GET /api/rtmp returns the current status without caching', async () => {
        const status = {
            isStreaming: true,
            status: 'streaming',
            channelId: 101,
            endpointName: 'synthetic-a',
            startTime: 1,
        };
        model.getStatus.mockReturnValue(status);
        const res = makeResponse();

        await rtmpRoute.get(makeRequest(), res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(status);
        expect(res.headers['Cache-Control']).toContain('no-cache');
    });

    it('[MD-11.2] POST /api/rtmp waits for the start and passes a trimmed preset request', async () => {
        model.start.mockResolvedValue(undefined);
        const res = makeResponse();

        await rtmpRoute.post(
            makeRequest({ body: { channelId: 101, endpointName: ' synthetic-a ', streamKey: ' synthetic-key ' } }),
            res,
        );

        expect(model.start).toHaveBeenCalledWith({
            channelId: 101,
            endpointName: 'synthetic-a',
            url: undefined,
            streamKey: 'synthetic-key',
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'RTMPライブ配信を開始しました' });
    });

    it('[MD-11.2] POST /api/rtmp accepts a decimal string channelId and a direct url', async () => {
        model.start.mockResolvedValue(undefined);
        const res = makeResponse();

        await rtmpRoute.post(
            makeRequest({ body: { channelId: '101', url: 'rtmp://rtmp-c.invalid/app', streamKey: 'synthetic-key' } }),
            res,
        );

        expect(model.start).toHaveBeenCalledWith({
            channelId: 101,
            endpointName: undefined,
            url: 'rtmp://rtmp-c.invalid/app',
            streamKey: 'synthetic-key',
        });
        expect(res.statusCode).toBe(200);
    });

    it('[MD-11.3] POST /api/rtmp answers 400 with the reason when the model rejects the request', async () => {
        model.start.mockRejectedValue(new RTMPStreamRequestError('streamKey must not be empty or contain whitespace'));
        const res = makeResponse();

        await rtmpRoute.post(
            makeRequest({ body: { channelId: 101, endpointName: 'synthetic-a', streamKey: '' } }),
            res,
        );

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
            code: 400,
            message: 'Bad Request: streamKey must not be empty or contain whitespace',
        });
    });

    it('[MD-11.5] POST /api/rtmp answers 500 when starting fails', async () => {
        model.start.mockRejectedValue(new Error('synthetic tuner failure'));
        const res = makeResponse();

        await rtmpRoute.post(
            makeRequest({ body: { channelId: 101, endpointName: 'synthetic-a', streamKey: 'k' } }),
            res,
        );

        expect(res.statusCode).toBe(500);
        expect(res.body).toMatchObject({ code: 500, errors: 'synthetic tuner failure' });
    });

    it('[MD-11.7] DELETE /api/rtmp waits for the stop and returns 200', async () => {
        model.stop.mockResolvedValue(undefined);
        const res = makeResponse();

        await rtmpRoute.del(makeRequest(), res);

        expect(model.stop).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'RTMPライブ配信を停止しました' });
    });

    it('[MD-11.11] GET /api/rtmp/endpoints returns the configured endpoints', async () => {
        const endpoints = [{ name: 'synthetic-a', url: 'rtmp://rtmp-a.invalid/live/', description: 'a' }];
        model.getEndpoints.mockReturnValue(endpoints);
        const res = makeResponse();

        await endpointsRoute.get(makeRequest(), res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ endpoints });
    });
});
