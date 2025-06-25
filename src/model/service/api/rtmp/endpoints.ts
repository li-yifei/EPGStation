import { Operation } from 'express-openapi';
import IRTMPStreamModel from '../../../api/rtmp/IRTMPStreamModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const rtmpStreamModel = container.get<IRTMPStreamModel>('IRTMPStreamModel');

    try {
        const endpoints = rtmpStreamModel.getEndpoints();
        api.responseJSON(res, 200, { endpoints });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'RTMPエンドポイント一覧取得',
    tags: ['rtmp'],
    description: '設定されているRTMPエンドポイントの一覧を取得する',
    responses: {
        200: {
            description: 'RTMPエンドポイント一覧',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            endpoints: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: {
                                            type: 'string',
                                            description: 'エンドポイント名',
                                        },
                                        url: {
                                            type: 'string',
                                            description: 'RTMP URL',
                                        },
                                        description: {
                                            type: 'string',
                                            description: 'エンドポイントの説明',
                                        },
                                    },
                                    required: ['name', 'url', 'description'],
                                },
                            },
                        },
                        required: ['endpoints'],
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
