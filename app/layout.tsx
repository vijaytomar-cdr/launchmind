/**
 * @file layout.tsx
 * @description Root layout for the LaunchMind Next.js app.
 *   Loads Google Fonts (DM Sans, Syne, DM Mono), applies global CSS.
 *   PostHog analytics initialised client-side via PostHogProvider.
 * @security No secrets. Font loading via next/font/google (no external network at render time).
 * @dependencies next/font/google, globals.css, PostHogProvider
 */

import type { Metadata } from 'next';
import { Inter, Syne, DM_Mono } from 'next/font/google';
import './globals.css';
import { PostHogProvider } from '@/components/launchmind/PostHogProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LaunchMind — AI Marketing OS for App Founders',
  description: 'Discover your ICP, execute USA + India campaigns, and learn weekly.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${syne.variable} ${dmMono.variable}`}
    >
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
