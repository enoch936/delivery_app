import type { Metadata } from "next";
import "./globals.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "delivery_app Operations Console",
  description: "Authorised operations console for merchants, couriers, payments, configuration and audit."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


