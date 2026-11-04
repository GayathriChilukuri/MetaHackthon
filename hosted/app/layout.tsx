import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stockwise — Demand & Inventory Planner",
  description: "Demand forecasts, ingredient planning and a Meta-powered copilot for small businesses.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
