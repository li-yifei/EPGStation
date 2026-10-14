# RTMP ライブ配信（fork 独自機能）

放送中のチャンネルを RTMP サーバー（YouTube Live、Twitch など）へ配信する。upstream へは提出しない自用機能で、upstream との
merge を楽にするため、upstream の file（`.kiro/specs/`、`src/model/Configuration.ts`、`config/config.yml.template`、
`docs/conf-manual.md`）は変更しない。仕様の正本はこの文書とする。

## 設定（`config.yml`）

```yaml
rtmp:
    endpoints:
        - name: YouTube
          url: rtmp://a.rtmp.youtube.com/live2/
          description: YouTube Live
    cmd: '%FFMPEG% -dual_mono_mode main -i %INPUT% -sn -threads 0 -c:v libx264 -vf yadif -b:v 3000k -preset veryfast -g 60 -c:a aac -ar 48000 -b:a 192k -ac 2 -f flv %RTMP_URL%'
```

| 項目                     | 必須 | 内容                                                                                   |
| ------------------------ | ---- | -------------------------------------------------------------------------------------- |
| `rtmp.cmd`               | yes  | 配信コマンド。`%RTMP_URL%` を含むこと                                                  |
| `rtmp.endpoints`         | no   | 配信先の一覧。省略時は空                                                               |
| `rtmp.endpoints[].name`  | yes  | 配信先名（Web UI と API で使う）                                                       |
| `rtmp.endpoints[].url`   | yes  | `rtmp://`・`rtmps://` で始まり、空白を含まない URL                                     |
| `rtmp.endpoints[].description` | no | 説明                                                                              |

-   `%FFMPEG%` は `ffmpeg` の設定値、`%INPUT%` は放送データを受け取る標準入力 `pipe:0`（v2 の設定をそのまま使えるように残している。
    `pipe:0` と直接書いてもよい）、`%RTMP_URL%` は配信先 URL（末尾に `/` を補う）にストリームキーを連結した値に置き換わる。
-   コマンドは他の配信と同じく半角空白で分割し、引用符や shell 構文は解釈しない。
-   `rtmp` の設定は起動時には検証しない。`rtmp` が無いと配信要求は 400、`cmd` に `%RTMP_URL%` が無いか配信先の `url` が不正だと
    配信開始は 500（`config error: ...`）になる。
-   ffmpeg の入力は放送データの pipe なので、`-re` は付けない（upstream のライブ配信の既定コマンドと同じ理由）。

## 振る舞い（test ID `MD-11.x` と対応）

1. 配信は同時に 1 件まで。状態（`idle`・`starting`・`streaming`・`stopping`・`error`）、チャンネル、配信先名、開始時刻、エラー
   内容をメモリー内に持つ。
2. 放送データは `TunerServerAccess.openServiceStream({ serviceId: channelId, priority: streamingPriority })` で受け取り、
   `IEncodeProcessManageModel.createManaged`（`input: 'pipe:0'`、`priority: 1`、`report: { kind: 'stream' }`）で起動した配信
   コマンドの標準入力へ pipe する。`mirakurunPath` が `http+unix://` でも動く。
3. 資源に触れる前に要求を検証し、不正なら 400 を返して配信中の配信は止めない。チャンネルは 1 以上の安全な整数、ストリーム
   キーは空白を含まない 1 文字以上、URL は `rtmp://`・`rtmps://` で始まり空白を含まないこと（空白を拒否するのは、利用者の入力が
   ffmpeg の別の引数になるのを防ぐため）。
4. 開始・停止の要求は届いた順に 1 つずつ処理する。配信中に開始すると、前の配信の停止を終えてから開始する（encode の実行枠が
   1 つでも入れ替えられる）。
5. 放送受信・配信コマンドの開始に失敗したら、開始済みの資源を片付けて `error` にし、開始を失敗とする。
6. 配信中に配信コマンドが終了したか放送データが終わったら `error` にし、残った資源を片付ける。
7. 停止は `stopping` にして、配信コマンドへ `SIGINT`（`requestStop`）を送り、5 秒で終わらなければ `SIGKILL` を送り、放送受信を
   閉じてから `idle` に戻す。`error` で資源が無いときも `idle` に戻す。`idle` のときは何もしない。
8. 配信コマンドの置き換えは上記「設定」のとおり。`%RTMP_URL%` は最後に置き換える。
9. 配信コマンドは `stream` 種別として管理側へ知らせるので、Web・API 側処理が異常終了しても管理側が `SIGINT` で止める。
10. ストリームキーはログ・状態・応答に出さない。ログに出すコマンドと ffmpeg の出力ではストリームキーを `***` に伏せる。
11. 設定済みの配信先一覧を返す（未設定なら空）。
12. 再起動前の配信状態は復元しない。

## API

| Method   | Path                  | 内容                                                                                       |
| -------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/api/rtmp`           | 状態（`RTMPStreamInfo`）                                                                    |
| `POST`   | `/api/rtmp`           | 開始。開始完了まで待って 200。不正な要求は 400（`Bad Request: <理由>`）、開始の失敗は 500   |
| `DELETE` | `/api/rtmp`           | 停止。停止完了まで待って 200                                                                |
| `GET`    | `/api/rtmp/endpoints` | 配信先一覧（`RTMPEndpoints`）                                                               |

`POST /api/rtmp` の body（`StartRTMPStreamOption`）:

```text
{ "channelId": 3239123608, "endpointName": "YouTube", "streamKey": "xxxx-xxxx" }
{ "channelId": 3239123608, "url": "rtmp://live.example.invalid/app/", "streamKey": "xxxx-xxxx" }
```

-   `url` があれば `url` を使う。そのときの配信先名は `endpointName`、無ければ `custom`。
-   `channelId` は数値か 10 進の数字だけの文字列。文字列項目は前後の空白を除いて扱う。

型は `api.d.ts` 末尾、OpenAPI schema は `api.yml` の `RTMP*`・`StartRTMPStreamOption` にある。

## Web UI

放送中画面のチャンネル選択ダイアログの「RTMP配信」から開く（`client/src/features/onair/RtmpStreamDialog.tsx`）。ストリーム
キーは配信先ごとにブラウザの `localStorage`（`rtmp_stream_key_<配信先>`）へ平文で保存する。

## upstream との境界

fork が upstream の file に加えている変更は次だけにとどめる（merge で衝突しやすい場所を増やさない）。

-   `src/model/IConfigFile.ts`: `rtmp?: RTMPConfig` と型
-   `src/model/ModelContainerSetter.ts`: `IRTMPStreamModel` の bind
-   `api.d.ts`・`api.yml`: 末尾への型と schema の追加
-   `client/src/features/onair/LiveStreamSelectDialog.tsx`・`OnAirPage.module.css`: 「RTMP配信」ボタン

それ以外は RTMP 専用の file（`src/model/api/rtmp/`、`src/model/service/api/rtmp*`、`test/server/**/rtmp*`、
`client/src/features/onair/*Rtmp*`・`rtmp*`、`client/unittest/**/onair.rtmp*`）に置く。

## test

```bash
npm run test:server:spec -- test/server/media-delivery/rtmp-stream.spec.test.ts test/server/service-interface/rtmp-api.spec.test.ts
npm run test:server:imp -- test/server/media-delivery/rtmp-stream.imp.test.ts test/server/service-interface/rtmp-api.imp.test.ts
npm run test:server:integration -- test/server/media-delivery/rtmp-stream.integration.test.ts
cd client && npx vitest run unittest/imp/onair.rtmpStream.imp.test.ts unittest/spec/onair.rtmpStreamDialog.spec.test.tsx
```
