import type {Metadata} from 'next';
import { Luckiest_Guy } from 'next/font/google';
import './globals.css'; // Global styles

const luckiestGuy = Luckiest_Guy({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-luckiest-guy',
});

export const metadata: Metadata = {
  title: 'Learn English Easy',
  description: 'Search any word — get Bengali meaning, pronunciation, examples, tips & more.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${luckiestGuy.variable}`}>
      <body className="font-sans antialiased tracking-wide" suppressHydrationWarning>{children}</body>
    </html>
  );
}
