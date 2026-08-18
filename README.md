# Roule Notte

スマートフォン向けのルーレット記録アプリです。ゲーム履歴、回転方向、予測計算はすべてブラウザ内で処理され、サーバーへ送信されません。

## ローカル起動

Node.js 22以降を使用します。

```bash
npm install
npm run dev
```

## 確認

```bash
npm run lint
npm test
```

## Netlify

リポジトリをNetlifyへ接続すると、`netlify.toml`の設定が自動的に使用されます。

- Build command: `npm run build`
- Publish directory: `dist`
- Node.js: `22`

環境変数、データベース、Netlify Functionsは不要です。

## データ保存

履歴はブラウザのLocalStorageに保存されます。ブラウザのサイトデータ削除、別端末・別ブラウザへの変更、公開ドメインの変更では履歴を引き継げません。
