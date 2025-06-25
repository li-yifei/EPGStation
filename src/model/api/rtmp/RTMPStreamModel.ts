import { ChildProcess } from 'child_process';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../../service/encode/IEncodeProcessManageModel';
import IRTMPStreamModel, { RTMPStreamOption, RTMPStreamResponse, RTMPStreamStatus } from './IRTMPStreamModel';

@injectable()
export default class RTMPStreamModel implements IRTMPStreamModel {
    private log: ILogger;
    private configuration: IConfiguration;
    private encodeProcessManageModel: IEncodeProcessManageModel;

    // RTMPライブ配信状態管理
    private currentStatus: RTMPStreamStatus = RTMPStreamStatus.Idle;
    private currentChannelId: apid.ChannelId | null = null;
    private currentEndpointName: string | null = null;
    private startTime: number | null = null;
    private errorMessage: string | null = null;
    private currentProcess: ChildProcess | null = null;

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
     * RTMPライブ配信を開始
     */
    public async start(option: RTMPStreamOption): Promise<void> {
        this.log.rtmp.info(`RTMPライブ配信開始要求: channelId=${option.channelId}, endpoint=${option.endpointName}`);

        // 既存のライブ配信を停止
        if (this.currentStatus !== RTMPStreamStatus.Idle) {
            this.log.rtmp.info('既存のRTMPライブ配信を停止中...');
            await this.stop();
        }

        // 設定チェック
        const rtmpConfig = this.configuration.getConfig().rtmp;
        if (!rtmpConfig) {
            throw new Error('RTMP設定が見つかりません');
        }

        const endpoint = rtmpConfig.endpoints.find(e => e.name === option.endpointName);
        if (!endpoint) {
            throw new Error(`RTMPエンドポイント '${option.endpointName}' が見つかりません`);
        }

        try {
            this.currentStatus = RTMPStreamStatus.Starting;
            this.currentChannelId = option.channelId;
            this.currentEndpointName = option.endpointName;
            this.errorMessage = null;

            // Mirakurunストリーム URL構築
            const streamUrl = `${this.configuration.getConfig().mirakurunPath}api/services/${option.channelId}/stream`;

            // FFmpegコマンド生成
            const rtmpUrl = `${endpoint.url}${option.streamKey}`;
            const cmd = rtmpConfig.cmd
                .replace(/%FFMPEG%/g, this.configuration.getConfig().ffmpeg)
                .replace(/%INPUT%/g, streamUrl)
                .replace(/%RTMP_URL%/g, rtmpUrl);

            this.log.rtmp.info(`RTMPライブ配信コマンド: ${cmd}`);

            // プロセス作成オプション
            const processOption: CreateProcessOption = {
                input: null,
                output: null,
                cmd: cmd,
                priority: 1, // 通常優先度
            };

            // FFmpegプロセス開始
            this.currentProcess = await this.encodeProcessManageModel.create(processOption);

            if (!this.currentProcess) {
                throw new Error('RTMPライブ配信プロセスの作成に失敗しました');
            }

            // プロセスイベント監視
            this.setupProcessHandlers();

            this.currentStatus = RTMPStreamStatus.Streaming;
            this.startTime = Date.now();

            this.log.rtmp.info(`RTMPライブ配信開始完了: ${endpoint.name} -> ${rtmpUrl}`);
        } catch (error: any) {
            this.log.rtmp.error(`RTMPライブ配信開始エラー: ${error.message}`);
            this.currentStatus = RTMPStreamStatus.Error;
            this.errorMessage = error.message;
            throw error;
        }
    }

    /**
     * RTMPライブ配信を停止
     */
    public async stop(): Promise<void> {
        if (this.currentStatus === RTMPStreamStatus.Idle) {
            return;
        }

        this.log.rtmp.info('RTMPライブ配信停止中...');
        this.currentStatus = RTMPStreamStatus.Stopping;

        try {
            if (this.currentProcess) {
                // プロセス終了
                this.currentProcess.kill('SIGTERM');

                // 強制終了のタイムアウト設定
                setTimeout(() => {
                    if (this.currentProcess && !this.currentProcess.killed) {
                        this.log.rtmp.warn('RTMPライブ配信プロセスを強制終了します');
                        this.currentProcess.kill('SIGKILL');
                    }
                }, 5000);

                this.currentProcess = null;
            }

            this.resetState();
            this.log.rtmp.info('RTMPライブ配信停止完了');
        } catch (error: any) {
            this.log.rtmp.error(`RTMPライブ配信停止エラー: ${error.message}`);
            this.currentStatus = RTMPStreamStatus.Error;
            this.errorMessage = error.message;
        }
    }

    /**
     * RTMPライブ配信状態を取得
     */
    public getStatus(): RTMPStreamResponse {
        return {
            isStreaming: this.currentStatus === RTMPStreamStatus.Streaming,
            status: this.currentStatus,
            channelId: this.currentChannelId || undefined,
            endpointName: this.currentEndpointName || undefined,
            startTime: this.startTime || undefined,
            errorMessage: this.errorMessage || undefined,
        };
    }

    /**
     * 設定されているRTMPエンドポイントを取得
     */
    public getEndpoints(): apid.RTMPEndpoint[] {
        const rtmpConfig = this.configuration.getConfig().rtmp;
        return rtmpConfig ? rtmpConfig.endpoints : [];
    }

    /**
     * プロセスイベントハンドラー設定
     */
    private setupProcessHandlers(): void {
        if (!this.currentProcess) {
            return;
        }

        this.currentProcess.on('exit', (code, signal) => {
            this.log.rtmp.info(`RTMPライブ配信プロセス終了: code=${code}, signal=${signal}`);

            if (this.currentStatus === RTMPStreamStatus.Streaming) {
                // 予期しない終了
                this.currentStatus = RTMPStreamStatus.Error;
                this.errorMessage = `プロセスが予期せず終了しました (code: ${code}, signal: ${signal})`;
            } else if (this.currentStatus === RTMPStreamStatus.Stopping) {
                // 正常な停止
                this.resetState();
            }
        });

        this.currentProcess.on('error', error => {
            this.log.rtmp.error(`RTMPライブ配信プロセスエラー: ${error.message}`);
            this.currentStatus = RTMPStreamStatus.Error;
            this.errorMessage = error.message;
        });

        // FFmpegの標準エラー出力をログに記録
        if (this.currentProcess.stderr) {
            this.currentProcess.stderr.on('data', data => {
                const message = data.toString();
                if (message.includes('error') || message.includes('Error')) {
                    this.log.rtmp.warn(`RTMPライブ配信FFmpeg stderr: ${message.trim()}`);
                }
            });
        }
    }

    /**
     * 状態をリセット
     */
    private resetState(): void {
        this.currentStatus = RTMPStreamStatus.Idle;
        this.currentChannelId = null;
        this.currentEndpointName = null;
        this.startTime = null;
        this.errorMessage = null;
        this.currentProcess = null;
    }
}
