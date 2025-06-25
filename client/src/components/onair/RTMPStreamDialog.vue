<template>
    <v-dialog v-model="isOpen" max-width="500" :persistent="loading || streaming">
        <v-card>
            <v-card-title class="headline">
                <v-icon left>mdi-broadcast</v-icon>
                RTMPライブ配信
            </v-card-title>

            <v-card-text>
                <div class="mb-4">
                    <div class="subtitle-1 font-weight-bold mb-2">配信先</div>
                    <v-select v-model="selectedEndpoint" :items="endpointItems" item-text="name" item-value="name" outlined :loading="loading" :disabled="streaming">
                        <template v-slot:item="{ item }">
                            <v-list-item-content>
                                <v-list-item-title>{{ item.name }}</v-list-item-title>
                                <v-list-item-subtitle>{{ item.description }}</v-list-item-subtitle>
                            </v-list-item-content>
                        </template>
                    </v-select>
                </div>

                <div class="mb-4">
                    <div class="subtitle-1 font-weight-bold mb-2">ストリームキー</div>
                    <v-text-field
                        v-model="streamKey"
                        outlined
                        :type="showStreamKey ? 'text' : 'password'"
                        :append-icon="showStreamKey ? 'mdi-eye' : 'mdi-eye-off'"
                        @click:append="showStreamKey = !showStreamKey"
                        :disabled="streaming"
                        placeholder="ストリームキーを入力してください"
                    ></v-text-field>
                </div>

                <div v-if="channelName" class="mb-4">
                    <div class="subtitle-1 font-weight-bold mb-2">配信チャンネル</div>
                    <v-chip color="primary" label>{{ channelName }}</v-chip>
                </div>

                <div v-if="status && status.isStreaming" class="mb-4">
                    <v-alert type="success" text>
                        <div class="font-weight-bold">配信中</div>
                        <div v-if="status.startTime" class="caption">開始時刻: {{ formatTime(status.startTime) }}</div>
                    </v-alert>
                </div>

                <div v-if="status && status.status === 'error'" class="mb-4">
                    <v-alert type="error" text>
                        <div class="font-weight-bold">エラー</div>
                        <div v-if="status.errorMessage" class="caption">
                            {{ status.errorMessage }}
                        </div>
                    </v-alert>
                </div>
            </v-card-text>

            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text @click="close" :disabled="loading">キャンセル</v-btn>
                <v-btn v-if="!streaming" color="success" @click="startStream" :loading="loading" :disabled="!canStart">配信開始</v-btn>
                <v-btn v-else color="error" @click="stopStream" :loading="loading">配信停止</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { Component, Vue, Watch } from 'vue-property-decorator';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import * as apid from '../../../../api';

interface RTMPEndpoint {
    name: string;
    url: string;
    description: string;
}

interface RTMPStatus {
    isStreaming: boolean;
    status: string;
    channelId?: number;
    endpointName?: string;
    startTime?: number;
    errorMessage?: string;
}

@Component({})
export default class RTMPStreamDialog extends Vue {
    public isOpen: boolean = false;
    public channelId: number | null = null;
    public channelName: string = '';
    public selectedEndpoint: string = '';
    public streamKey: string = '';
    public showStreamKey: boolean = false;
    public endpoints: RTMPEndpoint[] = [];
    public status: RTMPStatus | null = null;
    public loading: boolean = false;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private statusTimer: number | null = null;

    public get endpointItems(): RTMPEndpoint[] {
        return this.endpoints;
    }

    public get streaming(): boolean {
        return this.status?.isStreaming === true;
    }

    public get canStart(): boolean {
        return !this.loading && !!this.selectedEndpoint && !!this.streamKey && !!this.channelId;
    }

    public async open(channelId: number, channelName: string): Promise<void> {
        this.channelId = channelId;
        this.channelName = channelName;
        this.isOpen = true;

        // エンドポイント一覧取得
        await this.loadEndpoints();

        // 保存されたストリームキーを復元
        this.loadStreamKey();

        // 状態取得開始
        await this.updateStatus();
        this.startStatusPolling();
    }

    public close(): void {
        this.isOpen = false;
        this.stopStatusPolling();
        this.channelId = null;
        this.channelName = '';
        this.status = null;
    }

    public async startStream(): Promise<void> {
        if (!this.canStart) return;

        this.loading = true;
        try {
            const response = await fetch('/api/rtmp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    channelId: this.channelId,
                    endpointName: this.selectedEndpoint,
                    streamKey: this.streamKey,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'ライブ配信の開始に失敗しました');
            }

            // ストリームキーを保存
            this.saveStreamKey();

            this.snackbarState.open({
                color: 'success',
                text: 'ライブ配信を開始しました',
            });
        } catch (error: any) {
            this.snackbarState.open({
                color: 'error',
                text: error.message || 'ライブ配信の開始に失敗しました',
            });
        } finally {
            this.loading = false;
        }
    }

    public async stopStream(): Promise<void> {
        this.loading = true;
        try {
            const response = await fetch('/api/rtmp', {
                method: 'DELETE',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'ライブ配信の停止に失敗しました');
            }

            this.snackbarState.open({
                color: 'success',
                text: 'ライブ配信を停止しました',
            });
        } catch (error: any) {
            this.snackbarState.open({
                color: 'error',
                text: error.message || 'ライブ配信の停止に失敗しました',
            });
        } finally {
            this.loading = false;
        }
    }

    private async loadEndpoints(): Promise<void> {
        try {
            const response = await fetch('/api/rtmp/endpoints');
            if (response.ok) {
                const data = await response.json();
                this.endpoints = data.endpoints || [];

                // デフォルト選択
                if (this.endpoints.length > 0 && !this.selectedEndpoint) {
                    this.selectedEndpoint = this.endpoints[0].name;
                }
            }
        } catch (error) {
            console.error('Failed to load RTMP endpoints:', error);
        }
    }

    private async updateStatus(): Promise<void> {
        try {
            const response = await fetch('/api/rtmp');
            if (response.ok) {
                this.status = await response.json();
            }
        } catch (error) {
            console.error('Failed to get RTMP status:', error);
        }
    }

    private startStatusPolling(): void {
        this.statusTimer = window.setInterval(() => {
            this.updateStatus();
        }, 3000); // 3秒間隔で状態更新
    }

    private stopStatusPolling(): void {
        if (this.statusTimer) {
            window.clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
    }

    private saveStreamKey(): void {
        if (this.selectedEndpoint && this.streamKey) {
            const key = `rtmp_stream_key_${this.selectedEndpoint}`;
            localStorage.setItem(key, this.streamKey);
        }
    }

    private loadStreamKey(): void {
        if (this.selectedEndpoint) {
            const key = `rtmp_stream_key_${this.selectedEndpoint}`;
            const savedKey = localStorage.getItem(key);
            if (savedKey) {
                this.streamKey = savedKey;
            }
        }
    }

    private formatTime(timestamp: number): string {
        return new Date(timestamp).toLocaleString('ja-JP');
    }

    @Watch('selectedEndpoint')
    private onEndpointChanged(): void {
        this.loadStreamKey();
    }

    public beforeDestroy(): void {
        this.stopStatusPolling();
    }
}
</script>
