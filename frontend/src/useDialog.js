import { useEffect, useRef } from 'react';

// Keep keyboard focus inside the active dialog and return it to its trigger.
const openDialogs = [];
let originalOverflow = '';
export function useDialog(open, onClose, busy = false) {
  const ref = useRef(null);
  const close = useRef(onClose);
  const blocked = useRef(busy);

  useEffect(() => {
    close.current = onClose;
    blocked.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement;
    if (openDialogs.length === 0) originalOverflow = document.body.style.overflow;
    openDialogs.push(dialog);
    document.body.style.overflow = 'hidden';
    const focusable = () => [...dialog.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )].filter((element) => element.getClientRects().length > 0);
    if (!dialog.contains(document.activeElement)) (focusable()[0] || dialog).focus();

    const onKey = (event) => {
      if (openDialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!blocked.current) close.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0] || dialog;
      const last = items.at(-1) || dialog;
      if (!dialog.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last) || !items.length) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const index = openDialogs.indexOf(dialog);
      if (index !== -1) openDialogs.splice(index, 1);
      if (openDialogs.length === 0) document.body.style.overflow = originalOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  return ref;
}
