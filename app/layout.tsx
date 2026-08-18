import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const previewImage = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: "Roulette Notes｜ヨーロピアンルーレット記録",
    description: "独自のA/B/C・1/2/3・Z/G/O/T表記で出目を記録するヨーロピアンルーレット用ログアプリ。",
    openGraph: {
      title: "Roulette Notes",
      description: "ヨーロピアンルーレットを、独自の記号で記録する。",
      images: [{ url: previewImage, width: 1672, height: 941, alt: "Roulette Notes — 32 / B / 3 / Z" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Roulette Notes",
      description: "ヨーロピアンルーレットを、独自の記号で記録する。",
      images: [previewImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
