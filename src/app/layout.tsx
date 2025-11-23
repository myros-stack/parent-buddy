import './globals.css';
import { Inter } from 'next/font/google';

// Define the Inter font using next/font/google
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans', // Assigns the font to a CSS variable for Tailwind
});

// Define Metadata (Optional, but good practice for Next.js 13/14)
export const metadata = {
  title: 'Parent Buddy',
  description: 'AI tool to find dates and tasks from filtered emails.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Apply the Inter font variable to the body.
        The 'font-sans' class will link to the '--font-sans' variable defined above.
      */}
      <body className={`font-sans ${inter.variable}`}>
        {children}
      </body>
    </html>
  );
}