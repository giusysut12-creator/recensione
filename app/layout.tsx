import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voce dei Clienti",
  description: "Trasforma ciò che i clienti scrivono nelle recensioni in decisioni concrete.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
