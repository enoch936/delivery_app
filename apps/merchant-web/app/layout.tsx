import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "delivery_app Merchant",
  description: "delivery_app merchant foundation"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
