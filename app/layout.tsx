import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Why Now — The GTM Search Engine",
  description:
    "Paste a company URL. Get the position, the signals, and the pitch — live web research curated by AI. No database, no Apollo, no ZoomInfo needed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
