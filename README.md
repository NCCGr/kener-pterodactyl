# Pterodactyl用Kener Egg

Kener 4.2.0をPterodactylで動かす非公式Eggです。SQLite・Valkeyを内蔵し、任意でCloudflare Tunnelを利用できます。

```text
ghcr.io/nccgr/kener-pterodactyl:4.2.0-egg.3
```

1. `egg-kener.json`をPanelへインポートします。
2. サーバー作成時に上記イメージを選び、公開URL（ORIGIN）を設定します。
3. Cloudflare Tunnelを使う場合は起動設定にトークンを入力し、Cloudflare側の転送先を`http://127.0.0.1:3000`に設定します。

専用イメージを各ノードでビルドする必要はありません。Linux/amd64向けです。

詳しい設定・バックアップ・更新手順は[日本語の導入手順](README.ja.md)、確認範囲は[検証記録](VALIDATION.md)を参照してください。

このプロジェクトはKener・Pterodactyl・Cloudflareの公式配布物ではありません。
