import { EventEmitter } from 'node:events';
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

describe('RTMP API routes (unittest/spec)', () => {
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

    describe('GET /api/rtmp', () => {
        it('returns 200 with the current stream status', async () => {
            const statusData = {
                isStreaming: true,
                status: 'streaming',
                channelId: 101,
                endpointName: 'YouTube',
                startTime: 1700000000000,
            };
            mockRTMPStreamModel.getStatus.mockReturnValue(statusData);

            const req = makeRequest();
            const res = makeResponse();

            await rtmpRoute.get(req, res);

            expect(mockRTMPStreamModel.getStatus).toHaveBeenCalledOnce();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.body).toEqual(statusData);
            expect(res.headers['Cache-Control']).toContain('no-cache');
        });
    });

    describe('POST /api/rtmp', () => {
        it('starts stream with preset endpointName and returns 200 message', async () => {
            mockRTMPStreamModel.start.mockResolvedValue(undefined);

            const req = makeRequest({
                body: {
                    channelId: 101,
                    endpointName: 'YouTube',
                    streamKey: 'secret-key-123',
                },
            });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(mockRTMPStreamModel.start).toHaveBeenCalledWith({
                channelId: 101,
                endpointName: 'YouTube',
                url: undefined,
                streamKey: 'secret-key-123',
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.body).toEqual({ message: 'RTMPライブ配信を開始しました' });
        });

        it('starts stream with custom url and returns 200 message', async () => {
            mockRTMPStreamModel.start.mockResolvedValue(undefined);

            const req = makeRequest({
                body: {
                    channelId: 202,
                    url: 'rtmp://custom.invalid/app/',
                    streamKey: 'custom-key-456',
                },
            });
            const res = makeResponse();

            await rtmpRoute.post(req, res);

            expect(mockRTMPStreamModel.start).toHaveBeenCalledWith({
                channelId: 202,
                endpointName: undefined,
                url: 'rtmp://custom.invalid/app/',
                streamKey: 'custom-key-456',
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.body).toEqual({ message: 'RTMPライブ配信を開始しました' });
        });
    });

    describe('DELETE /api/rtmp', () => {
        it('stops stream and returns 200 message', async () => {
            mockRTMPStreamModel.stop.mockResolvedValue(undefined);

            const req = makeRequest();
            const res = makeResponse();

            await rtmpRoute.del(req, res);

            expect(mockRTMPStreamModel.stop).toHaveBeenCalledOnce();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.body).toEqual({ message: 'RTMPライブ配信を停止しました' });
        });
    });

    describe('GET /api/rtmp/endpoints', () => {
        it('returns 200 with list of endpoints', async () => {
            const endpoints = [
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
            ];
            mockRTMPStreamModel.getEndpoints.mockReturnValue(endpoints);

            const req = makeRequest();
            const res = makeResponse();

            await endpointsRoute.get(req, res);

            expect(mockRTMPStreamModel.getEndpoints).toHaveBeenCalledOnce();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.body).toEqual({ endpoints });
        });
    });
});
