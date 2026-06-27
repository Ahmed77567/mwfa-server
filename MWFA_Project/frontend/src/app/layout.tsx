import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "MWFA Dashboard | Security Scanner",
  description: "Mobile Wireless Forensic Auditor - Advanced Cloud Scanning and Monitoring Hub.",
  openGraph: {
    title: "MWFA Security Dashboard",
    description: "Advanced Cloud Scanning and Monitoring Hub. Powered by Kali-MCP.",
    url: "https://mwfa-frontend.vercel.app",
    siteName: "MWFA",
    images: [
      {
        url: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=1200&h=630&auto=format&fit=crop", // صورة هاكر/كود كول تطلع بالرابط
        width: 1200,
        height: 630,
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
