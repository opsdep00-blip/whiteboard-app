import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whiteboard App",
  description: "Collaborative Markdown proposal builder for lean teams",
  metadataBase: new URL("https://example.com"),
  icons: {
    icon: "/WhimsyBoard_LOG.png"
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
