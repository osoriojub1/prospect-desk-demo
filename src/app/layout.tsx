import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/instrument-sans";
import { ResearchSessionProvider } from "../components/research-session";
import { WorkspaceNavigationProvider } from "../components/workspace-navigation";
import { WorkspaceShell } from "../components/workspace-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospect Desk",
  description: "Find, review, and track company prospects.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <ResearchSessionProvider>
          <WorkspaceNavigationProvider><WorkspaceShell>{children}</WorkspaceShell></WorkspaceNavigationProvider>
        </ResearchSessionProvider>
      </body>
    </html>
  );
}
