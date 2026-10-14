import { Operation } from 'express-openapi';
import IRTMPStreamModel from '../../api/rtmp/IRTMPStreamModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/**
 * `GET /rtmp` ハンドラ。現在の RTMP ライブ配信状態を返す。
 */
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
    summary: 'RTMPライブ配信状態取得',
    tags: ['rtmp'],
    description: '現在のRTMPライブ配信状態を取得する',
    responses: {
        200: {
            description: 'RTMPライブ配信状態',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RTMPStreamInfo',
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

/**
 * `POST /rtmp` ハンドラ。指定されたチャンネルと配信先（プリセット名または直接 URL）へ RTMP ライブ配信を開始する。
 */
export const post: Operation = async (req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');

    try {
        const { channelId, endpointName, url, streamKey } = req.body ?? {};

        const numericChannelId = typeof channelId === 'number' ? channelId : parseInt(channelId, 10);
        if (
            isNaN(numericChannelId) ||
            numericChannelId <= 0 ||
            typeof streamKey !== 'string' ||
            streamKey.trim() === ''
        ) {
            api.responseError(res, {
                code: 400,
                message: 'Bad Request: channelId and streamKey are required',
            });
            return;
        }

        const trimmedUrl = typeof url === 'string' ? url.trim() : '';
        const trimmedEndpointName = typeof endpointName === 'string' ? endpointName.trim() : '';

        if (trimmedUrl !== '') {
            if (!/^rtmps?:\/\/[^\s/]+/i.test(trimmedUrl)) {
                api.responseError(res, {
                    code: 400,
                    message: 'Bad Request: invalid rtmp url',
                });
                return;
            }
        } else if (trimmedEndpointName === '') {
            api.responseError(res, {
                code: 400,
                message: 'Bad Request: either endpointName or url must be specified',
            });
            return;
        }

        await rtmpStreamModel.start({
            channelId: numericChannelId,
            endpointName: trimmedEndpointName !== '' ? trimmedEndpointName : undefined,
            url: trimmedUrl !== '' ? trimmedUrl : undefined,
            streamKey: streamKey.trim(),
        });

        api.responseJSON(res, 200, { message: 'RTMPライブ配信を開始しました' });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'RTMPライブ配信開始',
    tags: ['rtmp'],
    description: 'RTMPライブ配信を開始する',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/StartRTMPStreamOption',
                },
            },
        },
    },
    responses: {
        200: {
            description: 'RTMPライブ配信開始成功',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            message: {
                                type: 'string',
                            },
                        },
                        required: ['message'],
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

/**
 * `DELETE /rtmp` ハンドラ。実行中の RTMP ライブ配信を停止する。
 */
export const del: Operation = async (_req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');

    try {
        await rtmpStreamModel.stop();
        api.responseJSON(res, 200, { message: 'RTMPライブ配信を停止しました' });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'RTMPライブ配信停止',
    tags: ['rtmp'],
    description: 'RTMPライブ配信を停止する',
    responses: {
        200: {
            description: 'RTMPライブ配信停止成功',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            message: {
                                type: 'string',
                            },
                        },
                        required: ['message'],
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
