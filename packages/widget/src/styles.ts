export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }

.fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #111827;
  color: #fff;
  border: 0;
  cursor: pointer;
  font-size: 22px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms ease, background 120ms ease;
}
.fab:hover { transform: scale(1.06); background: #1f2937; }
.fab.active { background: #2563eb; }

.outline {
  position: fixed;
  pointer-events: none;
  border: 2px solid #2563eb;
  background: rgba(37, 99, 235, 0.08);
  z-index: 2147483646;
  transition: all 60ms ease;
  border-radius: 2px;
}

.hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #111827;
  color: #fff;
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 6px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.25);
}

.composer {
  position: fixed;
  width: 320px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.composer .meta {
  font-size: 11px;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}
.composer textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  padding: 8px;
  font-size: 13px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}
.composer textarea:focus { border-color: #2563eb; }

.row { display: flex; justify-content: flex-end; gap: 8px; }
.btn {
  border: 0;
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
}
.btn.primary { background: #2563eb; color: #fff; }
.btn.primary:disabled { background: #93c5fd; cursor: not-allowed; }
.btn.ghost { background: transparent; color: #374151; }

.toast {
  position: fixed;
  bottom: 80px;
  right: 20px;
  background: #111827;
  color: #fff;
  padding: 10px 14px;
  font-size: 13px;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.25);
}
.toast.error { background: #b91c1c; }
`;
