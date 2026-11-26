"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";
import type { OutreachDraft } from "../lib/prospects";
import { routes } from "../lib/routes";
import { PreviewDialog } from "./preview-dialog";
import { useResearchSession } from "./research-session";

export type DraftEdit = OutreachDraft & { revision: number };

type DraftBuffers = ReadonlyMap<string, ReadonlyMap<string, DraftEdit>>;

const Navigation = createContext<{
  buffers: DraftBuffers;
  setDraftEdit: (campaignId: string, recipientId: string, edit: DraftEdit | null) => void;
  navigate: (next: () => void) => void;
}>({
  buffers: new Map(),
  setDraftEdit: () => {},
  navigate: (next) => next(),
});

export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const { session } = useResearchSession();
  return <WorkspaceNavigation key={session?.user.id ?? "signed-out"}>{children}</WorkspaceNavigation>;
}

function WorkspaceNavigation({ children }: { children: ReactNode }) {
  const [buffers, setBuffers] = useState<DraftBuffers>(() => new Map());
  const [pending, setPending] = useState<{ next: () => void }>();
  const descriptionId = useId();
  const dirty = buffers.size > 0;

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function setDraftEdit(campaignId: string, recipientId: string, edit: DraftEdit | null) {
    setBuffers((current) => {
      const next = new Map(current);
      const campaign = new Map(next.get(campaignId));
      if (edit) campaign.set(recipientId, edit);
      else campaign.delete(recipientId);
      if (campaign.size) next.set(campaignId, campaign);
      else next.delete(campaignId);
      return next;
    });
  }

  function navigate(next: () => void) {
    if (dirty) setPending({ next });
    else next();
  }

  return (
    <Navigation.Provider value={{ buffers, setDraftEdit, navigate }}>
      {children}
      <PreviewDialog title="Discard unsaved changes?" open={Boolean(pending)} onClose={() => setPending(undefined)}
        showClose={false} descriptionId={descriptionId}>
        <p className="app-error-message" id={descriptionId}>Your draft edits will be lost if you leave this page.</p>
        <div className="action-footer">
          <button className="button button-secondary" type="button" autoFocus onClick={() => setPending(undefined)}>Keep editing</button>
          <button className="button button-primary" type="button" onClick={() => {
            if (!pending) return;
            setBuffers(new Map());
            setPending(undefined);
            pending.next();
          }}>Discard changes</button>
        </div>
      </PreviewDialog>
    </Navigation.Provider>
  );
}

export function useWorkspaceNavigation() {
  return useContext(Navigation);
}

export function WorkspaceLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { buffers, navigate } = useWorkspaceNavigation();
  return <Link {...props} href={href} onNavigate={(event) => {
    if (!buffers.size || pathname.replace(/\/$/, "") !== routes.review.slice(0, -1)) return;
    event.preventDefault();
    navigate(() => router.push(href));
  }} />;
}
