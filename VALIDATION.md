# 検証記録

確認日: 2026-11-06（JST）

## GHCRへの公開

- 公開リポジトリ: https://github.com/NCCGr/kener-pterodactyl
- 公開イメージ: `ghcr.io/nccgr/kener-pterodactyl:4.2.0-egg.3`
- 公開ダイジェスト: `sha256:725ccdc0a32be91389627ff3c649c3a91f68861402f8476d54b7186acddb75a5`
- Linux/amd64用イメージを手動ビルド・pushし、パッケージのPublic表示とバージョンタグを確認。
- 空のDockerクライアント設定を使って、GitHub/GHCRの認証なしでpull成功を確認。取得したダイジェストも一致。
- Eggの参照先をGHCRへ更新し、ノードごとの事前ビルドを不要に変更。
- パッケージ更新用Actionsの定義を追加。CI経由でのビルド・公開の実行成功は未確認で、初回公開は手動で実施。
- イメージのソースはコミット`c66152ef5916fafa7d7e648517e76db74fcedb0e`。実トンネルトークンやインスタンスのデータ・秘密鍵は含めていません。

既存サーバーのDockerイメージ指定は、Eggファイルの更新だけでは切り替わらない場合があります。既存サーバーでは起動設定のDockerイメージをGHCRの参照先へ変更してください。

## egg.3 Panel互換修正

- ユーザー環境でEggの保存時に`The docker images format is invalid.`が発生。
- 公式Panel v1.11.11の`EggFormRequest`とEggモデルでイメージの検証正規表現を確認。日本語・全角記号を含むイメージ表示名と、イメージ参照の先頭`~`が編集フォームの規則に合わないことを確認。
- イメージ表示名を`Kener 4.2.0 - Valkey - Cloudflare Tunnel`、参照を`local/kener-pterodactyl:4.2.0-egg.3`に修正。アプリ・イメージ本体は変更なし。
- 公式の規則に相当する互換性テストを追加し、修正後のモデル値・編集フォームの行が通ること、および旧日本語表示名と`~`参照が拒否されることを確認。
- 実Panelでの再保存確認は未実施。過去の`~`指定・日本語イメージ表示名を推奨する記録は、この修正で置き換えます。

検証元: https://github.com/pterodactyl/panel/blob/v1.11.11/app/Http/Requests/Admin/Egg/EggFormRequest.php

テスト実行:

```sh
node --experimental-vm-modules --test tests/supervisor.test.mjs tests/egg-compatibility.test.mjs
```

## egg.3: 設定説明と独自ログの日本語化

- Egg名、イメージ選択名、設定項目名・説明文、インストール完了メッセージ、.envの説明を日本語化。
- 独自の起動・停止・トンネル接続・入力エラーのログを日本語化。Kener本体・Valkey・cloudflaredの原文ログとライセンス本文は維持。
- 起動検出を`[kener-egg] 起動完了: ポート`へ変更し、Egg・監視プロセス・テスト・導入手順の一致を確認。
- 日本語説明、変数名、操作手順の整合をサブエージェントが確認。阻害する指摘なし。
- 既存のライフサイクルテスト14件すべて成功。監視プロセスの構文チェック、Eggと埋め込み設定のJSON解析も成功。
- Linux/amd64イメージ`local/kener-pterodactyl:4.2.0-egg.3`のビルド成功。
- イメージID: `sha256:f8696e54431835c770b97b1191b6526524c674ba9bf61717fef8c0841c9583d9`。
- 実コンテナで日本語の起動完了ログ、`/healthcheck?strict=1`のHTTP 200、停止ログと終了コード0を確認。UID/GID 4242、読み取り専用rootfs、cap-drop ALL、no-new-privilegesを使用。
- 実Panelでの日本語表示・画面幅・ライト/ダークテーマの表示確認は未実施。Kener本体の画面は今回の翻訳対象に含めていません。

以下のegg.2・egg.1は各版の過去の検証記録です。

## egg.2: Cloudflare Tunnel追加

サブエージェントに独立レビューと追加テストの実装を依頼しました。

- Linux/amd64イメージ`local/kener-pterodactyl:4.2.0-egg.2`のビルド成功。
- イメージID: `sha256:3593a828e634e714aaf9544e9908ec11975599c0ec9202b9c675ff3f2edfbf0b`。
- cloudflared 2026.10.7の公式バイナリをSHA-256確認のうえ同梱。Alpine上で`cloudflared version`実行成功。
- トークンなし・Allocation 31000で起動し、`0.0.0.0:31000`待受、health/public/signinのHTTP 200、初期管理者登録、ログイン済み管理画面、正常終了を確認。
- 実cloudflaredへダミーの無効トークンを渡すと、`Provided Tunnel token is not valid`で終了コード255。EggのReady表示なしでKener・Valkeyも停止。ログにトークン値が出ていないことを確認。
- コネクターだけを待機用テストダブルへ置き換えた実コンテナで、実Kenerが`127.0.0.1:3000`にだけ待ち受け、Allocation 31000や`0.0.0.0:3000`で待ち受けないことを`/proc/net/tcp`で確認。実Kenerの環境にトンネルトークンが含まれず、healthが200であることも確認。
- 非root UID/GID 4242、読み取り専用rootfs、cap-drop ALL、no-new-privilegesで上記実コンテナ検証を実施。
- 模擬ライフサイクルテスト14件すべて成功。従来6件に、トークン環境分離、loopback固定、空欄無効化、HTTPS要求、接続待機・タイムアウト、コネクター異常終了、停止順、分割ログ・未改行末尾の伏字、`.env`のトークン拒否を追加。
- EggのJSONと埋め込み設定JSONを解析し、任意トークン変数・イメージタグの整合を確認。

**有効な実トークンは使用していないため、実Cloudflare Edgeへの接続成功、公開ホスト名、外部HTTPS経由の表示は未確認です。** 接続成功・待機・異常終了の制御は模擬テストで確認しています。実Panelへのインポートも未実施です。

以下は初版egg.1の検証記録です。イメージID・初版テスト数は当時の値です。

## 実施済み

- 上流Kenerコミット`a03b0c308b3b54ae4e59793ae51e81c17ea407ec`のpackage.json、Dockerfile、起動処理、Redis接続、DB・マイグレーション・seed・画像保存箇所を確認。
- Wings v1.11.13のソースで、`~`によるローカルイメージ指定、非root UID/GID、読み取り専用ルートファイルシステムを確認。
- EggのJSONと埋め込み設定JSONを解析し、必須項目、変数名、起動検出文字列、タグの整合を静的確認。
- Node.js 24.18.0で監視プロセスの構文チェック。
- Linux/amd64用Dockerイメージを実際にビルド。Kenerの本番ビルド、ネイティブ依存関係のインストールに成功。
- 実コンテナを`--user 4242:4242 --read-only --cap-drop ALL --security-opt no-new-privileges`、`/tmp`をtmpfs、メモリ1 GiB・CPU 2で起動。
- 実Kenerのマイグレーション・seed、Valkeyへの接続、`[kener-egg] Ready on port 3000`を確認。
- コンテナ内部から`/healthcheck?strict=1`が`{"status":"ok","db":true,"redis":true}`を返すこと、公開ページとログインページのHTTP 200を確認。
- テスト用の初期管理者を登録し、ログインでセッションCookieが発行され、認証付き管理画面がHTTP 200を返すことを確認。
- SIGINTで監視プロセスを停止し、Kenerのスケジューラー・キュー・DB終了→Valkey終了のログとコンテナ終了コード0を確認。
- 再起動後の再ログイン、DB内ユーザー数の維持、Valkeyに入れたテスト値の維持、秘密鍵のSHA-256一致を確認。
- データディレクトリ内にroot所有ファイルがないことを確認。
- Node.js 24.18.0で子プロセス・ストレージ・ヘルス応答を模擬した6件のライフサイクルテストに成功。
  - 正常起動・非公開Redis設定・Kener→Redisの停止順。
  - 再起動時の秘密鍵維持。
  - Kener異常終了時のRedis停止と終了コード。
  - マイグレーション失敗時の起動中断。
  - 不正なORIGINの拒否。
  - Webポート6379の拒否。

再実行コマンド（Node.js 24）:

```sh
node --check supervisor.mjs
node --experimental-vm-modules --test tests/supervisor.test.mjs
```

## 実ビルドの情報

- イメージ: `local/kener-pterodactyl:4.2.0-egg.1`
- ローカルイメージID: `sha256:5ea799a74d9aeaef43aee7d4b915773b3c0b7b697d99798a19b49359d2d85b4e`
- プラットフォーム: Linux/amd64
- 実行時Node.js: 24.22.2 / Valkey: 9.0.4
- ベースイメージ: `node:24-alpine3.23@sha256:0efee1e068d21f6edcab7fa8c962fc4ecd50d4e28727bc23963379b63ee318ab`
- 本番依存関係をpruneした時点のnpm audit出力: low 8件。脆弱性の個別検証・修正はこのEgg作成の範囲では未実施。上流lockfileを変更せず使用しています。

## 未実施・確認範囲

- 実Panelへのインポート、Wingsでの起動・停止・再起動。
- 実際の監視対象に対する各監視方式、通知の送信、バックアップからの復元。
- 公開ドメイン・HTTPS・リバースプロキシを経由した動作、ブラウザーでの画面操作。
- WindowsホストからDocker公開ポートへの接続は、この環境では接続できませんでした。上記HTTP確認はコンテナ内部から実施し、公開URLに合わせたHost/Originヘッダーを使用しています。
- 実ネットワークでのICMP監視。
- ARM64でのビルド・実行。

Docker環境での確認は、実Panel・本番ネットワークでの受け入れ確認を代替しません。販売前にはREADMEの残りの確認項目を実行してください。
