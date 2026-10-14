import type * as apid from '../../../../api.js';

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
 * RTMPライブ配信モデルインターフェース
 */
export default interface IRTMPStreamModel {
    /**
     * RTMPライブ配信を開始する。
     * @param option 配信開始オプション
     * @returns 配信開始処理のPromise
     */
    start(option: RTMPStreamOption): Promise<void>;

    /**
     * 実行中のRTMPライブ配信を停止する。
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
