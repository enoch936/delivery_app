import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Kora Merchant",
  description: "Kora delivery platform merchant foundation"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
