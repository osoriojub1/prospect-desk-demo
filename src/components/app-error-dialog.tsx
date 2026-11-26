import { useId, type RefObject } from "react";
import { PreviewDialog } from "./preview-dialog";

export function AppErrorDialog({ title = "Something went wrong", message, onClose, onRetry, returnFocus }: {
  title?: string;
  message: string;
  onClose: () => void;
  onRetry?: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const descriptionId = useId();

  function close() {
    onClose();
    if (document.activeElement === document.body) returnFocus?.current?.focus();
  }

  return (
    <PreviewDialog title={title} open={Boolean(message)} onClose={close} descriptionId={descriptionId} showClose={false}>
      <p className="app-error-message" id={descriptionId}>{message}</p>
      <div className="action-footer">
        <button className="button button-secondary" type="button" autoFocus onClick={close}>Close</button>
        {onRetry && <button className="button button-primary" type="button" onClick={() => { close(); onRetry(); }}>Try again</button>}
      </div>
    </PreviewDialog>
  );
}
