import { Operation } from 'express-openapi';
import IRTMPStreamModel, { RTMPStreamRequestError } from '../../api/rtmp/IRTMPStreamModel.js';
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
 * body の channelId を数値へ変換する。数値か 10 進の数字だけの文字列以外は NaN とし、検証は model に任せる。
 */
const toChannelId = (value: unknown): number => {
    if (typeof value === 'number') {
        return value;
    }
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
};

/** body の文字列項目の前後の空白を除く。文字列以外と空文字は undefined とする。 */
const toOptionalString = (value: unknown): string | undefined => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed === '' ? undefined : trimmed;
};

/**
 * `POST /rtmp` ハンドラ。指定されたチャンネルと配信先（プリセット名または直接 URL）へ RTMP ライブ配信を開始し、開始を待って応答する。
 * 要求の検証は model が行い、不正な要求は 400 を返す。
 */
export const post: Operation = async (req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');
    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
        await rtmpStreamModel.start({
            channelId: toChannelId(body.channelId),
            endpointName: toOptionalString(body.endpointName),
            url: toOptionalString(body.url),
            streamKey: toOptionalString(body.streamKey) ?? '',
        });

        api.responseJSON(res, 200, { message: 'RTMPライブ配信を開始しました' });
    } catch (err: any) {
        if (err instanceof RTMPStreamRequestError) {
            api.responseError(res, { code: 400, message: `Bad Request: ${err.message}` });
            return;
        }
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
 * `DELETE /rtmp` ハンドラ。実行中の RTMP ライブ配信を停止し、停止を待って応答する。
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
