import type { Metadata } from "next";
import "./globals.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "delivery_app Merchant Portal",
  description: "Fulfil orders, manage your menu, inventory, and reconcile settlements."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

