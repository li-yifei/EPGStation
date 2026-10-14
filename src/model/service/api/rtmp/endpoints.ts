import { Operation } from 'express-openapi';
import IRTMPStreamModel from '../../../api/rtmp/IRTMPStreamModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /rtmp/endpoints` ハンドラ。設定ファイルに登録された RTMP エンドポイント一覧を返す。
 */
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
                        $ref: '#/components/schemas/RTMPEndpoints',
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
