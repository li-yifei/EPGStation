import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from './_harness';

const rtmpRoute = require(compiled('model', 'service', 'api', 'rtmp.js')) as {
    get: (req: any, res: any) => Promise<void>;
    post: (req: any, res: any) => Promise<void>;
    del: (req: any, res: any) => Promise<void>;
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

describe('RTMP API route implementation details (unittest/imp)', () => {
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

    it.each([
        [
            'an undefined body',
            undefined,
            { channelId: Number.NaN, endpointName: undefined, url: undefined, streamKey: '' },
        ],
        [
            'a non-decimal string channelId',
            { channelId: '12abc', streamKey: 'k', url: 'rtmp://x.invalid/a' },
            { channelId: Number.NaN, endpointName: undefined, url: 'rtmp://x.invalid/a', streamKey: 'k' },
        ],
        [
            'a non-string channelId',
            { channelId: [1], streamKey: 'k', endpointName: 'a' },
            { channelId: Number.NaN, endpointName: 'a', url: undefined, streamKey: 'k' },
        ],
        [
            'blank optional strings',
            { channelId: 1, streamKey: 'k', endpointName: '  ', url: '  ' },
            { channelId: 1, endpointName: undefined, url: undefined, streamKey: 'k' },
        ],
        [
            'non-string optional fields',
            { channelId: 1, streamKey: 1, endpointName: 1, url: 1 },
            { channelId: 1, endpointName: undefined, url: undefined, streamKey: '' },
        ],
    ])('normalizes %s and leaves validation to the model', async (_label, body, expected) => {
        model.start.mockResolvedValue(undefined);

        await rtmpRoute.post(makeRequest({ body }), makeResponse());

        expect(model.start).toHaveBeenCalledWith(expected);
    });

    it('answers 500 when getStatus throws', async () => {
        model.getStatus.mockImplementation(() => {
            throw new Error('synthetic status failure');
        });
        const res = makeResponse();

        await rtmpRoute.get(makeRequest(), res);

        expect(res.statusCode).toBe(500);
    });

    it('answers 500 when stop rejects', async () => {
        model.stop.mockRejectedValue(new Error('synthetic stop failure'));
        const res = makeResponse();

        await rtmpRoute.del(makeRequest(), res);

        expect(res.statusCode).toBe(500);
    });

    it('answers 500 when getEndpoints throws', async () => {
        model.getEndpoints.mockImplementation(() => {
            throw new Error('synthetic endpoints failure');
        });
        const res = makeResponse();

        await endpointsRoute.get(makeRequest(), res);

        expect(res.statusCode).toBe(500);
    });

    it('documents every operation, including the 400 answer of POST', () => {
        expect((rtmpRoute.get as any).apiDoc.responses[200]).toBeDefined();
        expect((rtmpRoute.post as any).apiDoc.responses[400]).toBeDefined();
        expect((rtmpRoute.del as any).apiDoc.responses[200]).toBeDefined();
        expect((endpointsRoute.get as any).apiDoc.responses[200]).toBeDefined();
    });
});
