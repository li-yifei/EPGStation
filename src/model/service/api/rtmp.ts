import { Operation } from 'express-openapi';
import IRTMPStreamModel from '../../api/rtmp/IRTMPStreamModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');

    try {
        const status = rtmpStreamModel.getStatus();
        api.responseJSON(res, 200, status);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'RTMP推流状態取得',
    tags: ['rtmp'],
    description: '現在のRTMP推流状態を取得する',
    responses: {
        200: {
            description: 'RTMP推流状態',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            isStreaming: {
                                type: 'boolean',
                                description: '推流中かどうか',
                            },
                            status: {
                                type: 'string',
                                enum: ['idle', 'starting', 'streaming', 'stopping', 'error'],
                                description: '推流状態',
                            },
                            channelId: {
                                type: 'integer',
                                description: '推流中のチャンネルID',
                            },
                            endpointName: {
                                type: 'string',
                                description: '推流先エンドポイント名',
                            },
                            startTime: {
                                type: 'integer',
                                description: '推流開始時刻（UNIX timestamp）',
                            },
                            errorMessage: {
                                type: 'string',
                                description: 'エラーメッセージ',
                            },
                        },
                        required: ['isStreaming', 'status'],
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};

export const post: Operation = async (req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');

    try {
        const { channelId, endpointName, streamKey } = req.body;

        if (!channelId || !endpointName || !streamKey) {
            api.responseError(res, {
                code: 400,
                message: 'Bad Request: channelId, endpointName, streamKey are required',
            });
            return;
        }

        await rtmpStreamModel.start({
            channelId: parseInt(channelId, 10),
            endpointName: endpointName,
            streamKey: streamKey,
        });

        api.responseJSON(res, 200, { message: 'RTMP推流を開始しました' });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'RTMP推流開始',
    tags: ['rtmp'],
    description: 'RTMP推流を開始する',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        channelId: {
                            type: 'integer',
                            description: '推流するチャンネルID',
                        },
                        endpointName: {
                            type: 'string',
                            description: '推流先エンドポイント名',
                        },
                        streamKey: {
                            type: 'string',
                            description: '推流キー',
                        },
                    },
                    required: ['channelId', 'endpointName', 'streamKey'],
                },
            },
        },
    },
    responses: {
        200: {
            description: 'RTMP推流開始成功',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            message: {
                                type: 'string',
                            },
                        },
                    },
                },
            },
        },
        400: {
            description: 'リクエストパラメータエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};

export const del: Operation = async (_req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');

    try {
        await rtmpStreamModel.stop();
        api.responseJSON(res, 200, { message: 'RTMP推流を停止しました' });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'RTMP推流停止',
    tags: ['rtmp'],
    description: 'RTMP推流を停止する',
    responses: {
        200: {
            description: 'RTMP推流停止成功',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            message: {
                                type: 'string',
                            },
                        },
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
