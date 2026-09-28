import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MittBo – boendet samlat",
  description: "MittBo prototyp för boende, förvaltare och arbetare",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sv"><body>{children}</body></html>;
}
