import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'RetailOS · 零售运营分析助手',
  icons: { icon: '/favicon.svg' },
  description: '可追溯的零售运营分析：销售诊断、库存补货、制度检索与工具调用。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
