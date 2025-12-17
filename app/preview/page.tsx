"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { loadPreviewPayload, PREVIEW_STORAGE_KEY, PreviewPayload } from "../../lib/previewStorage";

const formatDate = (timestamp?: string) => {
  if (!timestamp) return "未保存";
  try {
    return new Date(timestamp).toLocaleString("ja-JP", {
      hour12: false,
      dateStyle: "medium",
      timeStyle: "medium"
    });
  } catch {
    return timestamp;
  }
};

export default function PreviewPage() {
  const [note, setNote] = useState<PreviewPayload | null>(null);

  const syncFromStorage = useCallback(() => {
    setNote(loadPreviewPayload());
  }, []);

  useEffect(() => {
    syncFromStorage();
    const handler = (event: StorageEvent) => {
      if (event.key === PREVIEW_STORAGE_KEY) {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [syncFromStorage]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #111827, #020617 70%)",
        color: "var(--fg)",
        padding: "2.5rem 1.5rem",
        display: "flex",
        justifyContent: "center"
      }}
    >
      <div style={{ width: "100%", maxWidth: 960, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid var(--border)`,
            paddingBottom: "1rem"
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>Markdown Preview</p>
            <h1 style={{ margin: "0.2rem 0 0", fontSize: "clamp(1.8rem, 3vw, 2.6rem)" }}>{note?.title ?? "ノート未選択"}</h1>
            {note && (
              <p style={{ margin: "0.4rem 0 0", opacity: 0.8 }}>
                {note.labelName ? `${note.labelName} / ` : ""}最終同期: {formatDate(note.savedAt)}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => window.open("/", "_blank", "noopener")}
              style={{
                border: `1px solid var(--border)`,
                borderRadius: 999,
                background: "transparent",
                color: "inherit",
                padding: "0.45rem 1rem",
                cursor: "pointer"
              }}
            >
              エディタへ戻る
            </button>
            <button
              type="button"
              onClick={syncFromStorage}
              style={{
                border: "none",
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--accent-contrast)",
                padding: "0.45rem 1rem",
                cursor: "pointer",
                fontWeight: 600
              }}
            >
              再読み込み
            </button>
          </div>
        </header>

        <section
          style={{
            flex: 1,
            borderRadius: 24,
            border: `1px solid var(--border)`,
            padding: "1.5rem",
            background: "var(--panel-overlay)",
            minHeight: 520,
            overflow: "auto"
          }}
        >
          {note ? (
            <ReactMarkdown
              components={{
                h1: (props) => (
                  <h1 style={{ borderBottom: `1px solid var(--border)`, paddingBottom: 8, marginTop: 32 }} {...props} />
                ),
                code: (props) => (
                  <code
                    style={{
                      background: "var(--accent-surface)",
                      padding: "0.15rem 0.35rem",
                      borderRadius: 6
                    }}
                    {...props}
                  />
                ),
                li: (props) => <li style={{ marginBottom: 6 }} {...props} />
              }}
            >
              {note.content}
            </ReactMarkdown>
          ) : (
            <div style={{ opacity: 0.8, lineHeight: 1.6 }}>
              <p>まだプレビュー用データがありません。</p>
              <ol style={{ paddingLeft: "1.5rem" }}>
                <li>エディタ画面でノートを選択します。</li>
                <li>「プレビュータブを開く」を押してこのタブを更新します。</li>
                <li>必要に応じて「再読み込み」ボタンで最新内容に同期してください。</li>
              </ol>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
