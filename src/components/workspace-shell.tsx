"use client";

import { Activity, ChevronRight, ClipboardCheck, FileText, Inbox, ListFilter, LogOut, Megaphone, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { researchClient, researchConfigured } from "../lib/research";
import { routes, signInRoute } from "../lib/routes";
import { AppErrorDialog } from "./app-error-dialog";
import { useResearchSession, useWorkspaceEvents } from "./research-session";
import { WorkspaceBrand } from "./workspace-brand";
import { WorkspaceLink, useWorkspaceNavigation } from "./workspace-navigation";

const screens = {
  search: { label: "Search setup", title: "Search setup", icon: SlidersHorizontal },
  runStatus: { label: "Lead searches", title: "Lead searches", icon: Activity },
  prospects: { label: "Prospect review", title: "Prospect review", icon: ListFilter },
  campaigns: { label: "Campaigns", title: "Outreach campaigns", icon: Megaphone },
  review: { label: "Draft review", title: "Draft review", icon: ClipboardCheck },
  delivery: { label: "Email activity", title: "Email activity", icon: Inbox },
  logs: { label: "System logs", title: "System logs", icon: FileText },
};

type Screen = keyof typeof screens;

const groups: { label: string; screens: Screen[] }[] = [
  { label: "Lead generation", screens: ["search", "runStatus", "prospects"] },
  { label: "Outreach", screens: ["campaigns", "review", "delivery"] },
  { label: "System", screens: ["logs"] },
];

const steps = [
  { screen: "campaigns", label: "Audience" },
  { screen: "review", label: "Review" },
  { screen: "delivery", label: "Activity" },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState("");
  const { session, loading } = useResearchSession();
  const { unreadEvents, unreadReplies } = useWorkspaceEvents();
  const { navigate } = useWorkspaceNavigation();
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const signInPage = pathname.replace(/\/$/, "") === signInRoute.slice(0, -1);
  const needsSignIn = researchConfigured && (!session || session.user.is_anonymous);
  const screen = (Object.keys(routes) as Screen[])
    .find((key) => routes[key].replace(/\/$/, "") === pathname.replace(/\/$/, ""));
  const outreach = steps.some((step) => step.screen === screen);

  async function signOut() {
    try {
      const { error } = await researchClient().auth.signOut({ scope: "local" });
      if (error) setError("Could not sign out. Try again.");
    } catch {
      setError("Could not sign out. Try again.");
    }
  }

  useEffect(() => {
    if (signInPage || loading || !needsSignIn) return;
    const { pathname, search, hash } = window.location;
    const destination = pathname + search + hash;
    router.replace(destination === routes.search ? signInRoute : `${signInRoute}?next=${encodeURIComponent(destination)}`);
  }, [loading, needsSignIn, pathname, router, signInPage]);

  useEffect(() => {
    // Keep links to the earlier hash-based preview working.
    if (pathname !== "/" || needsSignIn) return;
    if (window.location.hash === "#prospect-review") router.replace(routes.prospects);
    if (window.location.hash === "#personalized-outreach") router.replace(routes.review);
  }, [needsSignIn, pathname, router]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    headingRef.current?.focus();
  }, [pathname]);

  if (signInPage) return children;
  if (needsSignIn) return <main className="sign-in-page"><p role="status">Opening workspace…</p></main>;

  return (
    <div className="app-shell" data-sidebar-collapsed={collapsed}>
      <aside className="workflow-sidebar">
        <div className="sidebar-header">
          <WorkspaceBrand />
          <button className="icon-button sidebar-toggle" type="button" aria-label={toggleLabel} title={toggleLabel} aria-controls="workspace-navigation" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
        </div>
        <nav className="workflow-nav" id="workspace-navigation" aria-label="Lead workflow">
          {groups.map((group, index) => (
            <div className="workflow-group" key={group.label}>
              <p className="workflow-label sidebar-label" id={`workflow-group-${index}`}>{group.label}</p>
              <ul aria-labelledby={`workflow-group-${index}`}>
                {group.screens.map((key) => {
                  const { icon: Icon, label } = screens[key];
                  const count = key === "delivery" ? unreadReplies : key === "logs" ? unreadEvents : 0;
                  const announcement = key === "delivery"
                    ? `unread ${count === 1 ? "reply" : "replies"}`
                    : `new ${count === 1 ? "event" : "events"}`;
                  return (
                    <li key={key}>
                      <WorkspaceLink className="workflow-link" href={routes[key]} title={collapsed ? label : undefined}
                        aria-current={screen === key ? "page" : undefined} aria-describedby={count ? "nav-count-" + key : undefined}>
                        <Icon size={17} aria-hidden="true" />
                        <span className="sidebar-label">{label}</span>
                        {count > 0 && <span className="nav-count" data-alert={key === "logs"} aria-hidden="true">{count}</span>}
                      </WorkspaceLink>
                      {count > 0 && <span className="sr-only" id={"nav-count-" + key}>{count} {announcement}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <span className="sr-only" role="status">
          {unreadReplies} unread {unreadReplies === 1 ? "reply" : "replies"} · {unreadEvents} new system {unreadEvents === 1 ? "event" : "events"}
        </span>
        <div className="workspace-identity">
          <span className="workspace-mark" aria-hidden="true">SW</span>
          <span className="sidebar-label">Sales workspace</span>
          {session && <button className="icon-button workspace-sign-out" type="button" onClick={() => navigate(() => void signOut())} aria-label="Sign out" title="Sign out"><LogOut size={16} aria-hidden="true" /></button>}
        </div>
      </aside>

      <main className="workspace">
        {screen && (
          <div className={outreach || screen === "logs" ? "page-heading outreach-heading" : "page-heading"}>
            <h1 ref={headingRef} tabIndex={-1}>{screens[screen].title}</h1>
            {outreach && (
              <ol className="outreach-steps" role="list" aria-label="Outreach progress">
                {steps.map((step, index) => (
                  <li key={step.screen} aria-current={step.screen === screen ? "step" : undefined}>
                    {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {children}
        <AppErrorDialog title="Couldn’t sign out" message={error} onClose={() => setError("")} onRetry={signOut} />
      </main>
    </div>
  );
}
