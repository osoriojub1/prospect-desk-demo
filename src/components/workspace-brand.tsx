import { ScanSearch } from "lucide-react";

export function WorkspaceBrand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true"><ScanSearch size={19} strokeWidth={1.8} /></span>
      <span className="sidebar-label">Prospect <span className="brand-second">Desk</span></span>
    </div>
  );
}
