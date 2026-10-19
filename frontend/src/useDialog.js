import { useEffect, useRef } from 'react';

// Keep keyboard focus inside the active dialog and return it to its trigger.
const openDialogs = [];
export function useDialog(open, onClose, busy = false) {
  const ref = useRef(null);
  const close = useRef(onClose);
  const blocked = useRef(busy);
  close.current = onClose;
  blocked.current = busy;

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
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
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  return ref;
}
