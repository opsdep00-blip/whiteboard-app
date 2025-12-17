# Whiteboard App

Next.js (App Router) + GCP/Cloud Run で構築する共同編集向け Markdown 企画書エディタです。GitHub Copilot が読み取りやすい `.md` をそのまま出力し、Firestore 無料枠内での運用を目指します。

## 特徴
- React Server Components + クライアントエディタで軽量構成
- Markdown 入力とプレビューを 1 画面で完結
- Firestore Lite を用いた楽観的更新（今後追加）
- Cloud Run の scale-to-zero を利用してインフラコストを抑制

## セットアップ
1. Node.js 20.x を用意
2. 依存関係をインストール
   ```bash
   npm install
   ```
3. ローカル開発サーバーを起動
   ```bash
   npm run dev
   ```
4. ブラウザで http://localhost:3000/ を開く

## 環境変数
`.env.example` をコピーして `.env.local` を作成し、Firebase プロジェクトの値を設定します。

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
```

## Cloud Run デプロイ（サマリ）
1. プロダクションビルドを生成し Docker イメージを作成
   ```bash
   npm run build
   docker build -t gcr.io/PROJECT_ID/whiteboard-app .
   ```
2. イメージを Container Registry / Artifact Registry に push
   ```bash
   docker push gcr.io/PROJECT_ID/whiteboard-app
   ```
3. Cloud Run へデプロイ（最小インスタンス 0）
   ```bash
   gcloud run deploy whiteboard-app \
     --image gcr.io/PROJECT_ID/whiteboard-app \
     --platform managed \
     --region asia-northeast1 \
     --allow-unauthenticated \
     --min-instances 0
   ```

## 今後の TODO
- Firestore セッションの実装と Cloud Storage スナップショット連携
- presence / cursors など複数人編集 UI
- GitHub Actions での Cloud Run CI/CD

## ライセンス
MIT
