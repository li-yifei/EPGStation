import { ChildProcess } from 'child_process';
import { inject, injectable } from 'inversify';
import type { Readable } from 'stream';
import type * as apid from '../../../../api.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IEncodeProcessManageModel, { ManagedProcessHandle } from '../../service/encode/IEncodeProcessManageModel.js';
import { TunerServerAccess, TunerStreamHandle } from '../../tuner/types.js';
import IRTMPStreamModel, {
    RTMP_URL_PATTERN,
    RTMPStreamOption,
    RTMPStreamRequestError,
    RTMPStreamResponse,
} from './IRTMPStreamModel.js';

/** ストリームキーの書式。空白を含まない 1 文字以上。 */
export const RTMP_STREAM_KEY_PATTERN = /^\S+$/;
/** 停止要求（SIGINT）から SIGKILL までと、SIGKILL から諦めるまでの待ち時間（ミリ秒）。 */
export const RTMP_STOP_TIMEOUT_MS = 5000;
/** 配信コマンドの実行枠の優先度。ライブ配信の視聴用変換と同じ値。 */
export const RTMP_PROCESS_PRIORITY = 1;
/** url を直接指定し、配信先名が無いときの配信先名。 */
export const RTMP_CUSTOM_ENDPOINT_NAME = 'custom';

/** 検証済みの配信開始要求。 */
interface RTMPStartTarget {
    channelId: apid.ChannelId;
    endpointName: string;
    url: string;
    streamKey: string;
    cmd: string;
}

/** 1 回の配信が持つ資源。 */
interface RTMPSession {
    readonly streamKey: string;
    tunerHandle: TunerStreamHandle | null;
    process: { child: ChildProcess; handle: ManagedProcessHandle } | null;
    listeners: Array<{ emitter: NodeJS.EventEmitter; event: string; listener: (...args: any[]) => void }>;
    /** 停止前に配信が終わった理由。 */
    endedMessage: string | null;
    /** 資源の解放（一度だけ実行する）。 */
    disposal: Promise<void> | null;
}

/**
 * RTMP ライブ配信管理モデル。
 * チューナーサーバーから受け取った放送データを、設定された配信コマンド（ffmpeg）の標準入力へ流し、RTMP サーバーへ配信する。
 * 配信は同時に 1 件までとし、開始・停止の要求は届いた順に 1 つずつ処理する。
 */
@injectable()
export default class RTMPStreamModel implements IRTMPStreamModel {
    private log: ILogger;
    private configuration: IConfiguration;
    private processManager: IEncodeProcessManageModel;
    private tunerServerAccess: TunerServerAccess;

    private status: apid.RTMPStreamStatus = 'idle';
    private channelId: apid.ChannelId | null = null;
    private endpointName: string | null = null;
    private startTime: apid.UnixtimeMS | null = null;
    private errorMessage: string | null = null;
    private session: RTMPSession | null = null;
    /** 開始・停止の処理を直列にする chain。 */
    private queue: Promise<void> = Promise.resolve();

    constructor(
        @inject('ILoggerModel') loggerModel: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
    ) {
        this.log = loggerModel.getLogger();
        this.configuration = configuration;
        this.processManager = processManager;
        this.tunerServerAccess = tunerServerAccess;
    }

    /**
     * RTMPライブ配信を開始する。要求は資源に触れる前に検証し、配信中の配信があれば停止を終えてから開始する。
     * @param option 配信開始オプション
     * @throws RTMPStreamRequestError 要求が不正なとき
     */
    public async start(option: RTMPStreamOption): Promise<void> {
        const target = this.resolveTarget(option);
        this.log.stream.info(`rtmp start requested: channelId=${target.channelId}, endpoint=${target.endpointName}`);

        return this.enqueue(async () => {
            await this.stopSession();
            await this.startSession(target);
        });
    }

    /**
     * 実行中のRTMPライブ配信を停止し、配信コマンドの終了と放送受信の解放を待つ。
     */
    public stop(): Promise<void> {
        return this.enqueue(() => this.stopSession());
    }

    /**
     * 現在のRTMPライブ配信状態を取得する。ストリームキーは含めない。
     */
    public getStatus(): RTMPStreamResponse {
        return {
            isStreaming: this.status === 'streaming',
            status: this.status,
            channelId: this.channelId ?? undefined,
            endpointName: this.endpointName ?? undefined,
            startTime: this.startTime ?? undefined,
            errorMessage: this.errorMessage ?? undefined,
        };
    }

    /**
     * 設定ファイルに定義されたRTMPエンドポイント一覧を取得する（未設定時は空配列）。
     */
    public getEndpoints(): apid.RTMPEndpoint[] {
        const endpoints = this.configuration.getConfig().rtmp?.endpoints;
        return Array.isArray(endpoints) ? endpoints.map(endpoint => ({ ...endpoint })) : [];
    }

    /**
     * 開始要求を検証し、配信先 URL とコマンドを決める。
     * @throws RTMPStreamRequestError
     */
    private resolveTarget(option: RTMPStreamOption): RTMPStartTarget {
        if (!Number.isSafeInteger(option.channelId) || option.channelId <= 0) {
            throw new RTMPStreamRequestError('channelId must be a positive integer');
        }
        if (typeof option.streamKey !== 'string' || RTMP_STREAM_KEY_PATTERN.test(option.streamKey) === false) {
            throw new RTMPStreamRequestError('streamKey must not be empty or contain whitespace');
        }

        // rtmp の設定は Configuration では検証しない（upstream の設定 module を変えないため）。使う時点でここで確かめる
        const rtmpConfig = this.configuration.getConfig().rtmp;
        if (typeof rtmpConfig !== 'object' || rtmpConfig === null) {
            throw new RTMPStreamRequestError('rtmp is not configured');
        }
        if (typeof rtmpConfig.cmd !== 'string' || rtmpConfig.cmd.includes('%RTMP_URL%') === false) {
            throw new Error('config error: rtmp.cmd must contain %RTMP_URL%');
        }

        const hasUrl = typeof option.url === 'string' && option.url !== '';
        const hasEndpointName = typeof option.endpointName === 'string' && option.endpointName !== '';
        let url: string;
        let endpointName: string;
        if (hasUrl) {
            if (RTMP_URL_PATTERN.test(option.url!) === false) {
                throw new RTMPStreamRequestError(
                    'url must start with rtmp:// or rtmps:// and must not contain whitespace',
                );
            }
            url = option.url!;
            endpointName = hasEndpointName ? option.endpointName! : RTMP_CUSTOM_ENDPOINT_NAME;
        } else if (hasEndpointName) {
            const endpoint = this.getEndpoints().find(e => e.name === option.endpointName);
            if (typeof endpoint === 'undefined') {
                throw new RTMPStreamRequestError(`endpoint is not configured: ${option.endpointName}`);
            }
            if (typeof endpoint.url !== 'string' || RTMP_URL_PATTERN.test(endpoint.url) === false) {
                throw new Error(`config error: rtmp endpoint url is invalid: ${endpoint.name}`);
            }
            url = endpoint.url;
            endpointName = endpoint.name;
        } else {
            throw new RTMPStreamRequestError('either endpointName or url must be specified');
        }

        return { channelId: option.channelId, endpointName, url, streamKey: option.streamKey, cmd: rtmpConfig.cmd };
    }

    /**
     * 処理を chain の末尾へ積む。前の処理の成否にかかわらず実行する。
     */
    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }

    /**
     * 放送受信と配信コマンドを開始する。途中で失敗したら開始済みの資源を解放し、状態を error にして例外を投げる。
     */
    private async startSession(target: RTMPStartTarget): Promise<void> {
        const session: RTMPSession = {
            streamKey: target.streamKey,
            tunerHandle: null,
            process: null,
            listeners: [],
            endedMessage: null,
            disposal: null,
        };
        this.session = session;
        this.status = 'starting';
        this.channelId = target.channelId;
        this.endpointName = target.endpointName;
        this.startTime = null;
        this.errorMessage = null;

        try {
            const config = this.configuration.getConfig();
            const tunerHandle = await this.tunerServerAccess.openServiceStream({
                serviceId: target.channelId,
                priority: config.streamingPriority,
            });
            session.tunerHandle = tunerHandle;

            const rtmpUrl = `${target.url.endsWith('/') ? target.url : `${target.url}/`}${target.streamKey}`;
            // 利用者の入力（rtmpUrl）は最後に置き換え、置き換えた値を再び置き換えない
            const cmd = target.cmd.replace(/%FFMPEG%/g, config.ffmpeg).replace(/%RTMP_URL%/g, () => rtmpUrl);
            this.log.stream.info(`create rtmp process: ${this.mask(session, cmd)}`);

            const result = await this.processManager.createManaged({
                input: 'pipe:0',
                output: null,
                cmd,
                priority: RTMP_PROCESS_PRIORITY,
                report: { kind: 'stream' },
            });
            session.process = { child: result.child, handle: result.handle };

            this.attach(session, tunerHandle.stream, result.child);

            if (session.endedMessage !== null) {
                throw new Error(session.endedMessage);
            }
            this.status = 'streaming';
            this.startTime = Date.now();
            this.log.stream.info(`rtmp streaming started: endpoint=${target.endpointName}`);
        } catch (err: unknown) {
            const message =
                session.endedMessage ?? this.mask(session, err instanceof Error ? err.message : String(err));
            this.log.stream.error(`rtmp start failed: ${message}`);
            await this.disposeSession(session);
            this.session = null;
            this.status = 'error';
            this.errorMessage = message;
            throw err;
        }
    }

    /**
     * 放送データを配信コマンドの標準入力へ流し、どちらかが停止前に終わったことを検知する listener を付ける。
     */
    private attach(session: RTMPSession, stream: NodeJS.ReadableStream, child: ChildProcess): void {
        const listen = (emitter: NodeJS.EventEmitter, event: string, listener: (...args: any[]) => void) => {
            emitter.on(event, listener);
            session.listeners.push({ emitter, event, listener });
        };

        listen(child, 'exit', (code: number | null, signal: NodeJS.Signals | null) => {
            this.onUnexpectedEnd(session, `rtmp process exited: code=${code}, signal=${signal}`);
        });
        listen(child, 'error', (err: Error) => {
            this.onUnexpectedEnd(session, `rtmp process error: ${this.mask(session, err.message)}`);
        });
        if (child.stderr !== null) {
            listen(child.stderr, 'data', (data: unknown) => {
                this.log.stream.debug(this.mask(session, String(data)));
            });
        }
        listen(stream, 'end', () => this.onUnexpectedEnd(session, 'tuner stream ended'));
        listen(stream, 'close', () => this.onUnexpectedEnd(session, 'tuner stream closed'));
        listen(stream, 'error', (err: Error) => this.onUnexpectedEnd(session, `tuner stream error: ${err.message}`));

        if (child.stdin === null) {
            throw new Error('rtmp process stdin is null');
        }
        // 配信コマンドが先に終了した後の書き込みで stdin が error を出しても、記録するだけにする
        listen(child.stdin, 'error', (err: Error) => {
            this.log.stream.error(`rtmp process stdin error: ${err.message}`);
        });
        stream.pipe(child.stdin);

        if (child.exitCode !== null || child.signalCode !== null) {
            this.onUnexpectedEnd(session, `rtmp process exited: code=${child.exitCode}, signal=${child.signalCode}`);
        }
        const readable = stream as Readable;
        if (readable.destroyed === true || readable.readableEnded === true) {
            this.onUnexpectedEnd(session, 'tuner stream ended');
        }
    }

    /**
     * 停止前に配信コマンドか放送データが終わったとき、状態を error にして残った資源の解放を chain へ積む。
     */
    private onUnexpectedEnd(session: RTMPSession, message: string): void {
        if (session.endedMessage !== null) {
            return;
        }
        session.endedMessage = message;
        if (this.status !== 'streaming') {
            // 開始中は startSession が失敗として扱う
            return;
        }

        this.log.stream.error(`rtmp streaming ended unexpectedly: ${message}`);
        this.status = 'error';
        this.errorMessage = message;
        void this.enqueue(async () => {
            if (this.session === session) {
                await this.disposeSession(session);
                this.session = null;
            }
        });
    }

    /**
     * 配信中の資源を解放して idle に戻す。資源が無く error のときも idle に戻す。
     */
    private async stopSession(): Promise<void> {
        const session = this.session;
        if (session === null) {
            if (this.status === 'error') {
                this.resetState();
            }
            return;
        }

        this.log.stream.info('rtmp stopping');
        this.status = 'stopping';
        await this.disposeSession(session);
        this.session = null;
        this.resetState();
        this.log.stream.info('rtmp stopped');
    }

    /**
     * session の資源を一度だけ解放する。
     */
    private disposeSession(session: RTMPSession): Promise<void> {
        if (session.disposal === null) {
            session.disposal = this.releaseResources(session);
        }
        return session.disposal;
    }

    /**
     * pipe を外し、配信コマンドへ停止要求（SIGINT）を送って終了を待ち、終わらなければ SIGKILL を送る。最後に放送受信を閉じる。
     */
    private async releaseResources(session: RTMPSession): Promise<void> {
        for (const { emitter, event, listener } of session.listeners) {
            emitter.off(event, listener);
        }
        session.listeners = [];

        const managed = session.process;
        const tunerHandle = session.tunerHandle;
        if (managed !== null) {
            const { child, handle } = managed;
            // process は放送受信を開けた後にだけ作るので、ここでは tunerHandle がある
            if (child.stdin !== null) {
                tunerHandle!.stream.unpipe(child.stdin);
            }
            await this.tryCleanup('request stop', () => this.processManager.requestStop(handle));
            if ((await this.waitForExit(child)) === false) {
                this.log.stream.warn('rtmp process did not exit after SIGINT, sending SIGKILL');
                await this.tryCleanup('kill', () => child.kill('SIGKILL'));
                if ((await this.waitForExit(child)) === false) {
                    this.log.stream.error('rtmp process did not exit after SIGKILL');
                }
            }
        }

        if (tunerHandle !== null) {
            await this.tryCleanup('close tuner stream', () => tunerHandle.close());
        }
    }

    /**
     * 子 process の終了を `RTMP_STOP_TIMEOUT_MS` まで待つ。
     * @returns 終了したら true
     */
    private waitForExit(child: ChildProcess): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) {
            return Promise.resolve(true);
        }
        return new Promise<boolean>(resolve => {
            const onExit = () => {
                clearTimeout(timer);
                resolve(true);
            };
            const timer = setTimeout(() => {
                child.off('exit', onExit);
                resolve(false);
            }, RTMP_STOP_TIMEOUT_MS);
            child.once('exit', onExit);
        });
    }

    private async tryCleanup(label: string, operation: () => unknown): Promise<void> {
        try {
            await operation();
        } catch (err: unknown) {
            this.log.stream.error(`rtmp ${label} error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** ログへ出す文字列からストリームキーを伏せる。 */
    private mask(session: RTMPSession, text: string): string {
        return text.split(session.streamKey).join('***');
    }

    private resetState(): void {
        this.status = 'idle';
        this.channelId = null;
        this.endpointName = null;
        this.startTime = null;
        this.errorMessage = null;
    }
}
