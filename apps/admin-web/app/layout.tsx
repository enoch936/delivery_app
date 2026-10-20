import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Kora Operations",
  description: "Kora delivery platform operations foundation"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
