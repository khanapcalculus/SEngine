import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Global Educational ERP & LMS",
  description: "Multi-tenant Educational ERP and Learning Management System",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#0b1020",
          color: "#e6e9f2",
        }}
      >
        {children}
      </body>
    </html>
  );
}
