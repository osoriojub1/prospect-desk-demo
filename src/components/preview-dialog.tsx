import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function PreviewDialog({ title, open, onClose, descriptionId, showClose = true, onCancel, children }: {
  title: string;
  open: boolean;
  onClose: () => void;
  descriptionId?: string;
  showClose?: boolean;
  onCancel?: () => boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId} className="dialog" onClose={onClose}
      onCancel={(event) => { if (onCancel?.() === false) event.preventDefault(); }}>
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        {showClose && (
          <button className="icon-button" type="button" onClick={() => ref.current?.close()} aria-label="Close dialog">
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
