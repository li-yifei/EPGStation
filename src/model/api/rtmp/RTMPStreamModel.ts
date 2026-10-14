import { ChildProcess } from 'child_process';
import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IEncodeProcessManageModel, { CreateProcessOption } from '../../service/encode/IEncodeProcessManageModel.js';
import IRTMPStreamModel, { RTMPStreamOption, RTMPStreamResponse } from './IRTMPStreamModel.js';

/** RTMP URL の基本書式（rtmp:// または rtmps:// から始まる）を検証する正規表現。 */
export const RTMP_URL_PATTERN = /^rtmps?:\/\/[^\s/]+/i;

/**
 * RTMP ライブ配信管理モデル。
 * Mirakurun の放送サービスストリームを取得し、FFmpeg を用いて指定された RTMP サーバーへ
 * ライブ配信（プッシュ配信）を行う。
 * 同時に実行可能な RTMP ライブ配信は単一とし、新規配信開始時は既存配信を自動停止する。
 */
@injectable()
export default class RTMPStreamModel implements IRTMPStreamModel {
    private log: ILogger;
    private configuration: IConfiguration;
    private encodeProcessManageModel: IEncodeProcessManageModel;

    // 現在のRTMP配信状態
    private currentStatus: apid.RTMPStreamStatus = 'idle';
    // 配信中のチャンネルID (未配信時は null)
    private currentChannelId: apid.ChannelId | null = null;
    // 配信先エンドポイント名 (未配信時は null)
    private currentEndpointName: string | null = null;
    // 配信開始時刻 (UNIX timestamp ms、未配信時は null)
    private startTime: apid.UnixtimeMS | null = null;
    // エラーメッセージ (正常時は null)
    private errorMessage: string | null = null;
    // 実行中の FFmpeg 子プロセス参照 (未実行時は null)
    private currentProcess: ChildProcess | null = null;
    // 停止タイムアウト (SIGKILL送信) 用タイマー
    private forceKillTimeout: NodeJS.Timeout | null = null;

    constructor(
        @inject('ILoggerModel') loggerModel: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEncodeProcessManageModel') encodeProcessManageModel: IEncodeProcessManageModel,
    ) {
        this.log = loggerModel.getLogger();
        this.configuration = configuration;
        this.encodeProcessManageModel = encodeProcessManageModel;
    }

    /**
     * RTMPライブ配信を開始する。
     * 既存の配信がある場合は停止してから新規配信を開始する。
     * @param option 配信開始オプション（チャンネルID、配信先、ストリームキー）
     * @throws 設定不在、エンドポイント不在、プロセス生成失敗時にエラーを投げる
     */
    public async start(option: RTMPStreamOption): Promise<void> {
        this.log.stream.info(
            `RTMPライブ配信開始要求: channelId=${option.channelId}, endpoint=${option.endpointName ?? option.url}`,
        );

        if (this.currentStatus !== 'idle') {
            this.log.stream.info('既存のRTMPライブ配信を停止中...');
            await this.stop();
        }

        if (!option.channelId || !option.streamKey) {
            throw new Error('channelIdとstreamKeyは必須です');
        }

        const rtmpConfig = this.configuration.getConfig().rtmp;
        if (!rtmpConfig) {
            throw new Error('RTMP設定が見つかりません');
        }

        let targetUrl: string;
        let endpointName: string;
        if (typeof option.url === 'string' && option.url.trim() !== '') {
            const trimmedUrl = option.url.trim();
            if (!RTMP_URL_PATTERN.test(trimmedUrl)) {
                throw new Error(`無効なRTMP URLです: ${trimmedUrl}`);
            }
            targetUrl = trimmedUrl;
            endpointName = option.endpointName ?? 'Custom';
        } else if (typeof option.endpointName === 'string' && option.endpointName.trim() !== '') {
            const endpoint = rtmpConfig.endpoints?.find(e => e.name === option.endpointName);
            if (!endpoint) {
                throw new Error(`RTMPエンドポイント '${option.endpointName}' が見つかりません`);
            }
            targetUrl = endpoint.url;
            endpointName = option.endpointName;
        } else {
            throw new Error('endpointNameまたはurlを指定してください');
        }

        try {
            this.currentStatus = 'starting';
            this.currentChannelId = option.channelId;
            this.currentEndpointName = endpointName;
            this.errorMessage = null;

            const mirakurunPath = this.configuration.getConfig().mirakurunPath;
            const streamUrl = `${mirakurunPath}api/services/${option.channelId}/stream`;

            const cleanTargetUrl = targetUrl.endsWith('/') ? targetUrl : `${targetUrl}/`;
            const rtmpUrl = `${cleanTargetUrl}${option.streamKey}`;

            const cmd = rtmpConfig.cmd
                .replace(/%FFMPEG%/g, this.configuration.getConfig().ffmpeg)
                .replace(/%INPUT%/g, streamUrl)
                .replace(/%RTMP_URL%/g, rtmpUrl);

            this.log.stream.info(`RTMPライブ配信コマンド: ${cmd}`);

            const processOption: CreateProcessOption = {
                input: null,
                output: null,
                cmd,
                priority: 1,
            };

            const process = await this.encodeProcessManageModel.create(processOption);
            if (!process) {
                throw new Error('RTMPライブ配信プロセスの作成に失敗しました');
            }

            this.currentProcess = process;
            this.setupProcessHandlers(process);

            this.currentStatus = 'streaming';
            this.startTime = Date.now();

            this.log.stream.info(`RTMPライブ配信開始完了: ${endpointName} -> ${cleanTargetUrl}`);
        } catch (error: any) {
            this.log.stream.error(`RTMPライブ配信開始エラー: ${error.message}`);
            this.currentStatus = 'error';
            this.errorMessage = error.message;
            throw error;
        }
    }

    /**
     * 実行中のRTMPライブ配信を停止する。
     * プロセスにSIGTERMを送信し、5秒経過しても終了しない場合はSIGKILLで強制終了する。
     */
    public async stop(): Promise<void> {
        if (this.currentStatus === 'idle') {
            return;
        }

        this.log.stream.info('RTMPライブ配信停止中...');
        this.currentStatus = 'stopping';

        try {
            if (this.currentProcess) {
                if (this.forceKillTimeout) {
                    clearTimeout(this.forceKillTimeout);
                    this.forceKillTimeout = null;
                }

                const processToKill = this.currentProcess;
                processToKill.kill('SIGTERM');

                this.forceKillTimeout = setTimeout(() => {
                    if (!processToKill.killed) {
                        this.log.stream.warn('RTMPライブ配信プロセスを強制終了します');
                        processToKill.kill('SIGKILL');
                    }
                    this.forceKillTimeout = null;
                }, 5000);
            }

            this.log.stream.info('RTMPライブ配信停止完了');
        } catch (error: any) {
            this.log.stream.error(`RTMPライブ配信停止エラー: ${error.message}`);
            this.currentStatus = 'error';
            this.errorMessage = error.message;
        }
    }

    /**
     * 現在のRTMPライブ配信状態を取得する。
     * @returns 配信状態オブジェクト
     */
    public getStatus(): RTMPStreamResponse {
        return {
            isStreaming: this.currentStatus === 'streaming',
            status: this.currentStatus,
            channelId: this.currentChannelId ?? undefined,
            endpointName: this.currentEndpointName ?? undefined,
            startTime: this.startTime ?? undefined,
            errorMessage: this.errorMessage ?? undefined,
        };
    }

    /**
     * 設定ファイルに定義されたRTMPエンドポイント一覧を取得する。
     * @returns エンドポイント一覧配列（未設定時は空配列）
     */
    public getEndpoints(): apid.RTMPEndpoint[] {
        const rtmpConfig = this.configuration.getConfig().rtmp;
        return rtmpConfig?.endpoints ? [...rtmpConfig.endpoints] : [];
    }

    /**
     * 子プロセスのライフサイクルイベント（exit, error, stderr）を設定する。
     * @param process 監視対象の子プロセス
     */
    private setupProcessHandlers(process: ChildProcess): void {
        process.on('exit', (code, signal) => {
            this.log.stream.info(`RTMPライブ配信プロセス終了: code=${code}, signal=${signal}`);

            if (this.forceKillTimeout) {
                clearTimeout(this.forceKillTimeout);
                this.forceKillTimeout = null;
            }

            if (this.currentProcess === process) {
                if (this.currentStatus === 'streaming') {
                    this.currentStatus = 'error';
                    this.errorMessage = `プロセスが予期せず終了しました (code: ${code}, signal: ${signal})`;
                    this.log.stream.error(`RTMPライブ配信が予期せず終了: ${this.errorMessage}`);
                } else if (this.currentStatus === 'stopping') {
                    this.resetState();
                    this.log.stream.info('RTMPライブ配信プロセスが正常に終了しました');
                } else if (this.currentStatus === 'starting') {
                    this.currentStatus = 'error';
                    this.errorMessage = `プロセス開始に失敗しました (code: ${code}, signal: ${signal})`;
                    this.log.stream.error(`RTMPライブ配信開始失敗: ${this.errorMessage}`);
                }

                this.currentProcess = null;
            }
        });

        process.on('error', error => {
            this.log.stream.error(`RTMPライブ配信プロセスエラー: ${error.message}`);

            if (this.forceKillTimeout) {
                clearTimeout(this.forceKillTimeout);
                this.forceKillTimeout = null;
            }

            if (this.currentProcess === process) {
                this.currentStatus = 'error';
                this.errorMessage = error.message;
                this.currentProcess = null;
            }
        });

        if (process.stderr) {
            process.stderr.on('data', data => {
                const message = data.toString();
                if (message.includes('error') || message.includes('Error')) {
                    this.log.stream.warn(`RTMPライブ配信FFmpeg stderr: ${message.trim()}`);
                }
            });
        }
    }

    /**
     * 内部状態を初期アイドル状態にリセットする。
     */
    private resetState(): void {
        this.currentStatus = 'idle';
        this.currentChannelId = null;
        this.currentEndpointName = null;
        this.startTime = null;
        this.errorMessage = null;
        this.currentProcess = null;

        if (this.forceKillTimeout) {
            clearTimeout(this.forceKillTimeout);
            this.forceKillTimeout = null;
        }
    }
}
