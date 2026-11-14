import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MS PDF — Kaam ki cheez. Bina bakwaas.",
  description: "A clean, private, ad-free PDF toolkit. Your files stay on your device.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
