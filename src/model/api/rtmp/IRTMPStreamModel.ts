import * as apid from '../../../../api';

/**
 * RTMPライブ配信状態
 */
export const enum RTMPStreamStatus {
    Idle = 'idle',
    Starting = 'starting',
    Streaming = 'streaming',
    Stopping = 'stopping',
    Error = 'error',
}

/**
 * RTMPライブ配信オプション
 */
export interface RTMPStreamOption {
    channelId: apid.ChannelId;
    endpointName: string;
    streamKey: string;
}

/**
 * RTMPライブ配信レスポンス
 */
export interface RTMPStreamResponse {
    isStreaming: boolean;
    status: RTMPStreamStatus;
    channelId?: apid.ChannelId;
    endpointName?: string;
    startTime?: number;
    errorMessage?: string;
}

/**
 * RTMPライブ配信モデルインターフェース
 */
export default interface IRTMPStreamModel {
    /**
     * RTMPライブ配信を開始
     * @param option RTMPStreamOption
     * @return Promise<void>
     */
    start(option: RTMPStreamOption): Promise<void>;

    /**
     * RTMPライブ配信を停止
     * @return Promise<void>
     */
    stop(): Promise<void>;

    /**
     * RTMPライブ配信状態を取得
     * @return RTMPStreamResponse
     */
    getStatus(): RTMPStreamResponse;

    /**
     * 設定されているRTMPエンドポイントを取得
     * @return RTMPEndpoint[]
     */
    getEndpoints(): apid.RTMPEndpoint[];
}
