import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "delivery_app Operations",
  description: "delivery_app operations foundation"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
