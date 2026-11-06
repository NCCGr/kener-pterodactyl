# Pterodactyl用Kener Egg

Kener 4.2.0をPterodactylの1サーバーとして動かす非公式Eggです。Node.js 24、SQLite、Redis互換のValkey、cloudflaredを専用イメージに含めています。Eggの設定項目・説明文・独自の起動ログは日本語です。Kener本体の画面と、Kener・Valkey・cloudflaredが出力する元のログは変更していません。

同梱するキュー・キャッシュ用サーバーにはBSD-3-ClauseのValkeyを採用しました。以下で「Redis」と記載する接続・データ領域はこのValkeyを指します。Kenerは通常の`redis://`プロトコルで接続します。

GHCRの専用イメージ`ghcr.io/nccgr/kener-pterodactyl:4.2.0-egg.3`を指定します。各ノードでの事前ビルドは不要です。本番Panelへのインポート確認は別途必要です。

## 対象構成

- Pterodactyl 1.xのPTDL_v2形式。Panelでの実インポート・Wings上の動作確認は別途必要です。
- Kenerソース固定先: `a03b0c308b3b54ae4e59793ae51e81c17ea407ec`（package.json: 4.2.0）。`latest`から自動更新しません。
- Node.js 24 / Alpine 3.23。ベースイメージとAlpineパッケージはビルド時点の更新が入ります。完全に同一のイメージを配布する場合は、検証後のイメージをdigestで固定してください。
- cloudflared 2026.10.7を公式リリースから取得し、amd64/arm64それぞれのSHA-256を確認します。
- SQLiteのみ、サブパスなし。Redisは同じコンテナの`127.0.0.1:6379`に限定します。
- メモリは最初の検証用に1 GiB程度を割り当て、監視数・実測に応じて調整してください。容量と性能の保証値ではありません。イメージのビルドにはサーバーの実行時より多くのメモリが必要です。

## 1. 公開イメージを使用

Panelで次のDockerイメージを選択してください。WingsがGHCRから取得します。

```text
ghcr.io/nccgr/kener-pterodactyl:4.2.0-egg.3
```

Linux/amd64向けです。GHCRへの外向き通信が必要です。公開状態であればレジストリ認証は不要です。

### 自分でビルドする場合（任意）

このフォルダー一式をLinuxのWingsノードへコピーし、Dockerfileのある場所で実行します。

```sh
docker build --pull -t local/kener-pterodactyl:4.2.0-egg.3 .
```

Kenerの固定コミットをダウンロードし、依存関係のインストールと本番ビルドを実行します。初回には時間がかかります。必要な通信先はGitHub、npm、Dockerイメージレジストリ、Alpineミラーです。

自分でビルドしたイメージを使用する場合は、PanelのDockerイメージをそのタグへ変更し、配置する全ノードに用意してください。通常は上記GHCRイメージを使用してください。

Panelの入力検証に合わせ、イメージ表示名は英数字・対応する記号を使用し、イメージ名の先頭に`~`を付けないでください。Egg名・設定項目・説明文は日本語のまま利用できます。

プライベートレジストリの場合はWings側にも認証設定が必要です。ARM64で提供する場合は対象アーキテクチャでビルド・検証してください。

## 2. Eggをインポートしてサーバーを作成

1. Panel管理画面のNestsから任意のNestに`egg-kener.json`をインポート。
2. そのEggを選びサーバーを作成。専用イメージを選択。
3. デフォルトAllocationにWeb用TCPポートを1個割り当て。1024〜65535の範囲で、6379以外を使用。
4. `公開URL（必須）`を実際の公開URLに設定。例: `https://status.your-domain.tld`。IPで確認する場合は`http://203.0.113.10:3000`のようにブラウザーで使うポートも指定。
5. インストール完了後に起動。`[kener-egg] 起動完了: ポート ...`が出ればDBとRedisの初回ヘルスチェックが成功。
6. 公開URLの`/account/signin`へアクセスして初期管理者登録を完了。登録後の管理画面は`/manage/app/site-configurations`です。

初期管理者登録は、自分がアクセスできる状態で完了してから一般公開してください。ドメイン・TLS証明書・リバースプロキシはEggでは発行・設定しません。Cloudflare Tunnelを使用する場合は下記の方法でCloudflare側に公開ホスト名を設定します。

Startupコマンドはイメージの固定エントリーポイントを表示しています。任意のコマンドや追加引数へ書き換えて起動する構成にはしていません。停止ボタンの`^C`とSIGTERMを監視プロセスが受け取り、Kener、Redisの順に停止します。トンネル使用時はcloudflared→Kener→Redisの順に停止します。Wings側の強制停止までの猶予は90秒以上を確保してください。

## 3. Cloudflare Tunnel（任意）

起動設定の`Cloudflare Tunnelのトークン（任意）`にトークンを入れると、自動的にcloudflaredを併走させます。空欄の場合は従来のAllocationによる公開です。

1. Cloudflareの管理画面で、リモート管理のCloudflare Tunnelを作成します。既存サービスと混在しない専用トンネルを使用してください。
2. Tunnelの公開アプリケーション（Public hostname）に公開ドメインを登録し、Serviceの種類をHTTP、転送先を`127.0.0.1:3000`に設定します。
3. Tunnelのコネクター起動コマンドに含まれるトークン値だけをコピーし、Panelの起動設定「Cloudflare Tunnelのトークン（任意）」（`CLOUDFLARED_TOKEN`）へ入力します。Cloudflare APIトークンやコマンド全体ではありません。
4. `ORIGIN`をその公開URL（例: `https://status.your-domain.tld`）に設定し、サーバーを起動・再起動します。
5. `Cloudflare Tunnelに接続しました。`と`起動完了: ポート 3000`を確認し、公開URLを開きます。

トークンだけではCloudflare側のドメイン・DNS・転送先の設定を作成しません。Cloudflare側のServiceは常に`http://127.0.0.1:3000`です。トンネルモードではKenerをIPv4ループバックの3000番に固定し、Allocationの外部インターフェースでは待ち受けません。Panelのサーバー作成上、Allocation自体の割り当ては引き続き必要です。通常のWings bridgeネットワークを前提とします。host networkは使用しないでください。

公開HTTPSはCloudflareが処理するため、この方式では別のNginxや証明書設定は不要です。cloudflaredの外向き通信を許可してください。メトリクス・接続状態確認用の`127.0.0.1:20241`もコンテナ内部限定です。

KenerのDB・Redisの健康確認後、cloudflaredの`/ready`が200になるまで接続を待ちます。初回接続ができない場合は起動を失敗させ、KenerとRedisも停止します。接続済み表示はCloudflareへのコネクター接続の確認であり、公開ホスト名・Serviceの正しさや外部からの表示を保証するものではありません。起動後の一時的な通信断はcloudflared自身が再接続し、cloudflaredプロセスが終了した場合はサーバー全体も異常終了します。

トークンはコマンド引数や通常ログへ出さず、cloudflared子プロセスの環境変数にのみ渡します。`.env`への保存は拒否します。Panelの起動設定は秘密保管庫ではなく、権限のあるユーザー・管理者やノード管理者は参照できます。共有するEgg JSONやイメージには実トークンを埋め込まないでください。

トンネルを無効化する場合はトークン欄を空にして再起動し、ORIGINを実際に使う直接URLまたは別プロキシのURLへ合わせてください。

## 4. 通常モードのHTTPS公開

リバースプロキシの転送先を、ノードのAllocationのIP・ポートにします。プロキシが別コンテナなら、転送先の`127.0.0.1`はノードを指しません。プロキシから到達できるノードIPを指定してください。

Nginx設定の例（ドメイン・転送先・証明書は自分の環境に合わせて設定）:

```nginx
location / {
    proxy_pass http://NODE_IP:ALLOCATION_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 3m;
}
```

`ORIGIN`は外部のHTTPS URLに合わせます。Redis用のAllocationやポート公開は不要です。ICMP監視はホスト側のping権限・ネットワーク設定に左右されるため、販売前に実環境で確認してください。監視先へTCP/HTTP接続するサービスなので、顧客へ提供する場合は管理ネットワークへの通信をホストのファイアウォール等で制御してください。

## 永続データと設定

| パス（Panelのファイル管理画面からの相対位置） | 内容 |
| --- | --- |
| `database/` | SQLite DB、監視履歴、設定、画像等 |
| `redis/` | RedisのAOFデータ、キュー等 |
| `.kener-secret` | 初回に生成する秘密鍵。再起動でも同じ鍵を使用 |
| `.env` | 任意のSMTP等の追加設定 |
| `build`等のシンボリックリンク | イメージ内アプリへの参照。バックアップ時にリンク先を辿る必要なし |

`.env.example`をPanel上の`.env`へコピーするとメール設定等を追加できます。Panelの環境変数が優先され、ポート・待受アドレス・SQLite・Redisの接続先・サブパスはEgg側で管理します。トンネルのトークンは`.env`に書かず、Panelの起動設定に入力してください。Kenerは内部時刻にUTCを使用します。

秘密鍵はログに出しません。`.kener-secret`を削除・変更すると既存セッション等に影響するため、DBとセットで保管してください。手動で`KENER_SECRET_KEY`を`.env`に指定する場合は32文字以上の十分にランダムな値を使い、そのファイルもバックアップに含めます。

## バックアップ・更新・復旧

1. Panelからサーバーを停止し、停止完了を確認。
2. `database/`、`redis/`、`.kener-secret`、使用していれば`.env`を一緒にバックアップ。起動中のSQLiteファイルの単純コピーは避ける。
3. 更新する場合は対象コミットの互換性・マイグレーションを確認し、別タグのイメージをビルドして検証してから切り替える。
4. 復旧は同じバージョンのイメージを選び、停止中にデータと鍵を復元。新バージョンがDBを更新した後に旧イメージへ戻す場合は、更新前のDBとRedisのバックアップも戻す。

Panelの「再インストール」は保存ディレクトリを用意するだけです。アプリの更新・初期化・データ削除は実行しません。OS管理操作とアプリ操作は分け、アプリをroot実行しないでください。WingsはノードごとのUID/GIDで実行するため、特定UIDを前提にせず、復元先の実行ユーザーが書き込める所有権を保ちます。

## 販売前の確認

- 実Panelへのインポート、サーバー作成、起動・停止・再起動。
- `/healthcheck?strict=1`、公開ページ、`/account/signin`の初期登録・再ログイン。
- 監視対象への疎通と履歴、使用する通知方式の実送信。
- 再起動後の設定・履歴・秘密鍵の維持、停止中バックアップからの復元。
- リバースプロキシ経由でのHTTPS、画像アップロード、顧客ごとのネットワーク制御。

検証の実施状況は`VALIDATION.md`を参照してください。

## ライセンス・出典

KenerのリスナーにHOST設定を反映する小変更をビルド時に適用します（`patch-kener.mjs`）。上流の一致箇所が変わった場合はビルドを失敗させます。

KenerはRaj Nandan Sharma氏によるMITライセンスのソフトウェアです。`LICENSE.kener`は取得した原文です。イメージ内にも`/opt/kener/LICENSE`を保持します。含まれる依存ソフトウェアにはそれぞれのライセンスが適用されます。

cloudflaredはApache-2.0ライセンスです。原文を`LICENSE.cloudflared`とイメージ内`/opt/kener/LICENSE.cloudflared`へ同梱しています。

Valkeyの著作権表示・ライセンスは`LICENSE.valkey`とイメージ内`/opt/kener/LICENSE.valkey`に同梱しています。

このEgg、監視プロセス、Dockerfileの追加部分は同梱の`LICENSE`（MIT）です。商用利用できます。Eggの`author`は連絡先未設定のプレースホルダーです。販売時は自分の連絡先へ置き換え、非公式であることを明示してください。

- Kener: https://github.com/rajnandan1/kener
- 固定ソース: https://github.com/rajnandan1/kener/tree/a03b0c308b3b54ae4e59793ae51e81c17ea407ec
- Pterodactylカスタムイメージ仕様: https://docs.pterodactyl.io/v1/guides/egg-creation/creating-custom-image

- Cloudflare Tunnel実行パラメーター: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
- cloudflared固定リリース: https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7

## イメージの公開・保守

GitHubリポジトリはhttps://github.com/NCCGr/kener-pterodactylです。GitHub Actionsの`Build and publish container`を手動実行し、公開するタグを指定します。バージョンタグ`v4.2.0-egg.3`のようなGitタグをpushした場合も公開します。Actionsの`GITHUB_TOKEN`を使用し、個人アクセストークンをソースへ保存しません。

GHCRの新規パッケージは初回に非公開で作成されます。初回公開後、パッケージ設定で可視性をPublicに変更し、認証なしの取得を確認してください。
