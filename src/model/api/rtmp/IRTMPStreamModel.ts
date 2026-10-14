import type * as apid from '../../../../api.js';

/** RTMP URL の書式。`rtmp://`・`rtmps://` で始まり、host を持ち、空白を含まない。設定の検証と配信開始要求の検証で共有する。 */
export const RTMP_URL_PATTERN = /^rtmps?:\/\/[^\s/]+\S*$/i;

/**
 * RTMPライブ配信開始オプション
 */
export interface RTMPStreamOption {
    channelId: apid.ChannelId;
    endpointName?: string;
    url?: string;
    streamKey: string;
}

/**
 * RTMPライブ配信状態レスポンス
 */
export interface RTMPStreamResponse {
    isStreaming: boolean;
    status: apid.RTMPStreamStatus;
    channelId?: apid.ChannelId;
    endpointName?: string;
    startTime?: apid.UnixtimeMS;
    errorMessage?: string;
}

/**
 * 配信開始要求そのものが不正であることを表すエラー（HTTP では 400 として返す）。
 * このエラーを投げた要求は、配信中の配信に触れていない。
 */
export class RTMPStreamRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RTMPStreamRequestError';
    }
}

/**
 * RTMPライブ配信モデルインターフェース
 */
export default interface IRTMPStreamModel {
    /**
     * RTMPライブ配信を開始する。配信中の配信があれば、その停止を終えてから開始する。
     * @param option 配信開始オプション
     * @returns 配信開始処理のPromise
     * @throws RTMPStreamRequestError 要求が不正なとき（配信中の配信は止めない）
     */
    start(option: RTMPStreamOption): Promise<void>;

    /**
     * 実行中のRTMPライブ配信を停止し、配信コマンドの終了と放送受信の解放を待つ。
     * @returns 停止処理のPromise
     */
    stop(): Promise<void>;

    /**
     * 現在のRTMPライブ配信状態を取得する。
     * @returns 配信状態
     */
    getStatus(): RTMPStreamResponse;

    /**
     * 設定されているRTMPエンドポイント一覧を取得する。
     * @returns エンドポイント一覧配列
     */
    getEndpoints(): apid.RTMPEndpoint[];
}
