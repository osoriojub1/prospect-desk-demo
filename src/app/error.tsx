"use client";

import { useState } from "react";
import { PreviewDialog } from "../components/preview-dialog";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <div className="outreach-page action-card empty-list">
        <p>This view couldn’t load</p>
        <button type="button" className="button button-secondary" onClick={reset}>Try again</button>
      </div>
      <PreviewDialog title="This view couldn’t load" open={open} onClose={() => setOpen(false)}>
        <div className="action-footer error-actions">
          <button type="button" className="button button-primary" onClick={reset}>Try again</button>
        </div>
      </PreviewDialog>
    </>
  );
}
