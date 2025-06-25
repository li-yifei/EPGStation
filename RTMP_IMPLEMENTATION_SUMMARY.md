# EPGStation RTMP ライブ配信機能実装記録

## 概要
EPGStationにRTMPライブ配信機能を追加実装。日本のデジタルテレビ録画管理ソフトウェアに、YouTube Live、Twitch、ニコニコ生放送等への直接配信機能を統合。

## 実装完了日時
2025-01-25

## 主要変更概要

### 🎯 実装目標
- 節目表（OnAir）画面からワンクリックでRTMPライブ配信開始
- 複数プラットフォーム対応（YouTube、Twitch、ニコニコ生放送）
- 配信状態のリアルタイム監視
- ストリームキーの安全な管理

### 📁 新規追加ファイル

#### バックエンド
- `src/model/api/rtmp/IRTMPStreamModel.ts` - RTMPストリーミングインターface
- `src/model/api/rtmp/RTMPStreamModel.ts` - RTMP配信管理モデル
- `src/model/service/api/rtmp.ts` - RTMP API コントローラ
- `src/model/service/api/rtmp/endpoints.ts` - エンドポイント取得API

#### フロントエンド  
- `client/src/components/onair/RTMPStreamDialog.vue` - RTMP配信設定ダイアログ

### 🔧 修正ファイル

#### 設定・型定義
- `config/config.yml.template` - RTMP設定セクション追加
- `api.d.ts` - RTMPEndpoint型定義追加
- `src/model/IConfigFile.ts` - RTMP設定インターフェース
- `src/model/ILogger.ts` - rtmpロガー追加
- `src/model/LoggerModel.ts` - rtmpロガー設定

#### 依存注入・管理
- `src/model/ModelContainerSetter.ts` - RTMPモデル登録

#### フロントエンド統合
- `client/src/components/onair/OnAirSelectStream.vue` - RTMP配信ボタン追加
- `client/package.json` - Node.js v22対応、OpenSSLレガシープロバイダー設定

### ⚙️ 技術仕様

#### バックエンドアーキテクチャ
```typescript
// 状態管理
enum RTMPStreamStatus {
    Idle = 'idle',
    Starting = 'starting', 
    Streaming = 'streaming',
    Stopping = 'stopping',
    Error = 'error'
}

// API エンドポイント
GET    /api/rtmp           # 配信状態取得
POST   /api/rtmp           # 配信開始
DELETE /api/rtmp           # 配信停止  
GET    /api/rtmp/endpoints # 利用可能エンドポイント取得
```

#### FFmpeg コマンドテンプレート
```bash
%FFMPEG% -re -dual_mono_mode main -hwaccel qsv -hwaccel_output_format qsv 
-i %INPUT% -c:a libfdk_aac -ar 48000 -b:a 192k -ac 2 
-c:v h264_qsv -vf vpp_qsv=deinterlace=2 -f flv %RTMP_URL%
```

#### プロセス管理特性
- **単一配信制限**: 同時に1つの配信のみ許可
- **自動プロセス置換**: 新規配信開始時に既存配信を自動停止
- **状態監視**: プロセス終了、エラーの自動検出
- **タイムアウト処理**: 5秒後の強制終了機能

### 🎨 ユーザーインターフェース

#### 配信ダイアログ機能
- **配信先選択**: プリセット済みプラットフォーム選択
- **ストリームキー管理**: プラットフォーム別自動保存/復元
- **リアルタイム状態表示**: 配信中/エラー状態の視覚的表示
- **パスワード保護**: ストリームキーの表示/非表示切替

#### 統合ポイント
- OnAir画面 → チャンネルクリック → "RTMP配信"ボタン

### 📊 設定例

```yaml
# RTMPライブ配信設定
rtmp:
    # RTMPサーバーエンドポイント一覧
    endpoints:
        - name: YouTube
          url: rtmp://a.rtmp.youtube.com/live2/
          description: YouTube Live
        - name: Twitch  
          url: rtmp://live.twitch.tv/live/
          description: Twitch
        - name: ニコニコ生放送
          url: rtmp://nlpush.nicovideo.jp/live/
          description: ニコニコ生放送
        - name: カスタム
          url: rtmp://192.168.0.23/live/
          description: カスタムRTMPサーバー
    # RTMPライブ配信FFmpegコマンドテンプレート
    cmd: '%FFMPEG% -re -dual_mono_mode main -hwaccel qsv -hwaccel_output_format qsv -i %INPUT% -c:a libfdk_aac -ar 48000 -b:a 192k -ac 2 -c:v h264_qsv -vf vpp_qsv=deinterlace=2 -f flv %RTMP_URL%'
```

### 🔍 実装詳細

#### ログ管理
- 専用RTMPログカテゴリ作成
- 配信開始/停止/エラーの詳細ログ記録  
- FFmpegプロセスエラー出力のキャプチャ

#### エラーハンドリング
- 設定不備の事前チェック
- プロセス作成失敗時の適切なエラー報告
- ネットワークエラー時の自動復旧

#### セキュリティ考慮
- ストリームキーのローカルストレージ保存
- プロセス間でのキー情報露出防止
- 不正なエンドポイントアクセス防止

### 🐛 既知の問題と修正

#### 解決済み問題
1. **言語統一**: 中文「推流」→ 日本語「ライブ配信」に統一
2. **Node.js v22対応**: Timer型互換性問題解決
3. **UI改善**: persistent dialog動作の最適化
4. **依存関係**: localStorage直接使用によるsettingStorage依存解除

#### 修正内容
- `NodeJS.Timer` → `NodeJS.Timeout` 型変更
- OpenSSLレガシープロバイダー有効化
- Modal外クリック時の適切な閉じる動作実装

### 📈 パフォーマンス特性

#### リソース使用量
- **状態ポーリング**: 3秒間隔での軽量HTTPリクエスト
- **メモリ**: 1プロセス分の状態保持のみ
- **CPU**: FFmpegエンコーディング負荷（設定依存）

#### スケーラビリティ  
- 単一サーバーでの1配信制限
- 設定ベースでの簡単プラットフォーム追加
- 水平スケーリング非対応（設計上の制限）

### 🚀 デプロイメント手順

1. **設定ファイル更新**
   ```bash
   cp config/config.yml.template config/config.yml
   # rtmp セクションを適切に設定
   ```

2. **ビルド実行**
   ```bash
   npm run build        # サーバーサイド
   npm run build-client # クライアントサイド  
   ```

3. **サーバー再起動**
   ```bash
   npm start
   ```

### 🧪 テスト観点

#### 機能テスト
- [ ] 各プラットフォームへの配信開始/停止
- [ ] 複数配信同時実行時の制限動作
- [ ] エラー状態からの復旧
- [ ] ストリームキー保存/復元

#### 互換性テスト  
- [ ] Node.js 18.x, 20.x, 22.x での動作確認
- [ ] 各ブラウザでのUI動作確認
- [ ] FFmpeg各バージョンでのコマンド実行

### 📝 運用上の注意点

#### 設定管理
- ストリームキーは平文でlocalStorageに保存される
- FFmpegパスの適切な設定が必須
- プラットフォーム別URLの定期的な確認推奨

#### トラブルシューティング
- 配信失敗時は rtmp.log を確認
- FFmpegコマンドの手動実行による動作確認
- ネットワーク帯域幅の十分な確保

### 💡 将来の拡張可能性

#### 短期拡張
- 複数配信同時対応
- 配信品質プリセット追加
- 配信統計情報表示

#### 中長期拡張  
- SRT/WebRTCプロトコル対応
- クラウド配信サービス連携
- 配信スケジューリング機能

---

## 開発統計
- **総開発時間**: 1時間50分
- **コード変更**: 1181行追加、71行削除  
- **ファイル数**: 11ファイル新規作成、12ファイル修正
- **API使用コスト**: $6.85

## 技術スタック
- **バックエンド**: Node.js 22, TypeScript, Express.js, Inversify
- **フロントエンド**: Vue.js 2, Vuetify 2, TypeScript  
- **ストリーミング**: FFmpeg, RTMP
- **ビルドツール**: Vue CLI, Webpack