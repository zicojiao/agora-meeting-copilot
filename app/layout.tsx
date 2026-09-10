import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { productName } from "@/lib/product";
import "./globals.css";

const manrope = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-manrope"
});

const ibmPlexMono = IBM_Plex_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["500", "600"]
});

export const metadata: Metadata = {
  title: productName,
  description: "Invite a realtime AI Copilot into an Agora meeting room.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { sizes: "16x16", type: "image/png", url: "/favicon-16x16.png" },
      { sizes: "32x32", type: "image/png", url: "/favicon-32x32.png" }
    ],
    apple: "/apple-touch-icon.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={`${manrope.variable} ${ibmPlexMono.variable} dark`} lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
