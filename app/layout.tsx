import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "bertclips",
  description: "Free local clipping engine, cash-truth earnings ledger, campaigns, and game promos.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
