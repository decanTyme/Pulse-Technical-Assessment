import type { Metadata } from "next"
import { DM_Sans, Fraunces } from "next/font/google"
import "./globals.css"

const bodyFont = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
})

const displayFont = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK"],
})

export const metadata: Metadata = {
  title: "Pulse",
  description:
    "A living globe of anonymous strangers. Tap a dot, start talking.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
