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
    let mockRTMPStreamModel: {
        getStatus: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        getEndpoints: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        mockRTMPStreamModel = {
            getStatus: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            getEndpoints: vi.fn(),
        };
        vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IRTMPStreamModel') {
                return mockRTMPStreamModel;
            }
            throw new Error(`Unexpected DI token: ${token}`);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('GET /api/rtmp error handling', () => {
        it('responds with 500 when getStatus throws', async () => {
            mockRTMPStreamModel.getStatus.mockImplementation(() => {
                throw new Error('Status failure');
            });

            const req = makeRequest();
            const res = makeResponse();

            await rtmpRoute.get(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.body).toEqual({
                code: 500,
                message: 'Internal Server Error',
                errors: 'Status failure',
            });
        });
    });

    describe('POST /api/rtmp validation and error handling', () => {
        it('rejects with 400 when body is undefined', async () => {
            const req = makeRequest({ body: undefined });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('channelId and streamKey are required');
        });

        it('rejects with 400 when channelId is missing', async () => {
            const req = makeRequest({ body: { endpointName: 'YouTube', streamKey: 'key' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('channelId and streamKey are required');
        });

        it('rejects with 400 when channelId is 0 or negative', async () => {
            const req = makeRequest({ body: { channelId: 0, endpointName: 'YouTube', streamKey: 'key' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('channelId and streamKey are required');
        });

        it('rejects with 400 when channelId is non-numeric string', async () => {
            const req = makeRequest({ body: { channelId: 'abc', endpointName: 'YouTube', streamKey: 'key' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('channelId and streamKey are required');
        });

        it('accepts string channelId and converts it to number', async () => {
            mockRTMPStreamModel.start.mockResolvedValue(undefined);
            const req = makeRequest({ body: { channelId: '101', endpointName: 'YouTube', streamKey: 'key' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(mockRTMPStreamModel.start).toHaveBeenCalledWith(
                expect.objectContaining({ channelId: 101 }),
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('rejects with 400 when streamKey is missing', async () => {
            const req = makeRequest({ body: { channelId: 101, endpointName: 'YouTube' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('channelId and streamKey are required');
        });

        it('rejects with 400 when streamKey is empty or whitespace', async () => {
            const req = makeRequest({ body: { channelId: 101, endpointName: 'YouTube', streamKey: '   ' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('channelId and streamKey are required');
        });

        it('rejects with 400 when url is not an rtmp/rtmps URL', async () => {
            const req = makeRequest({
                body: { channelId: 101, url: 'https://non-rtmp.invalid/stream', streamKey: 'key' },
            });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('invalid rtmp url');
        });

        it('rejects with 400 when neither endpointName nor url is provided', async () => {
            const req = makeRequest({ body: { channelId: 101, streamKey: 'key' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.message).toContain('either endpointName or url must be specified');
        });

        it('responds with 500 when model.start throws', async () => {
            mockRTMPStreamModel.start.mockRejectedValue(new Error('Process start failed'));

            const req = makeRequest({ body: { channelId: 101, endpointName: 'YouTube', streamKey: 'key' } });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.body).toEqual({
                code: 500,
                message: 'Internal Server Error',
                errors: 'Process start failed',
            });
        });
    });

    describe('DELETE /api/rtmp error handling', () => {
        it('responds with 500 when model.stop throws', async () => {
            mockRTMPStreamModel.stop.mockRejectedValue(new Error('Stop failed'));

            const req = makeRequest();
            const res = makeResponse();

            await rtmpRoute.del(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.body).toEqual({
                code: 500,
                message: 'Internal Server Error',
                errors: 'Stop failed',
            });
        });
    });

    describe('GET /api/rtmp/endpoints error handling', () => {
        it('responds with 500 when model.getEndpoints throws', async () => {
            mockRTMPStreamModel.getEndpoints.mockImplementation(() => {
                throw new Error('Config read failed');
            });

            const req = makeRequest();
            const res = makeResponse();

            await endpointsRoute.get(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.body).toEqual({
                code: 500,
                message: 'Internal Server Error',
                errors: 'Config read failed',
            });
        });
    });

    describe('apiDoc definitions', () => {
        it('attaches valid apiDoc metadata to operations', () => {
            expect((rtmpRoute.get as any).apiDoc).toBeDefined();
            expect((rtmpRoute.post as any).apiDoc).toBeDefined();
            expect((rtmpRoute.del as any).apiDoc).toBeDefined();
            expect((endpointsRoute.get as any).apiDoc).toBeDefined();
        });
    });
});
