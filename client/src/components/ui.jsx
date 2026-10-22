import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PALETTE } from '../../../shared/constants.js';
import { initials } from '../lib/format.js';

export function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export function Button({ children, variant = 'primary', type = 'button', className = '', ...props }) {
  return (
    <button type={type} className={classNames('button', `button-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, hint, error, htmlFor, children, className = '' }) {
  return (
    <div className={classNames('field', className)}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Swatches({ value, onChange, name = 'accent', disabledColors = [] }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Team accent color">
      {PALETTE.map((color) => {
        const taken = disabledColors.includes(color.id);
        const selected = value === color.id;
        return (
          <label
            className={classNames('swatch', selected && 'is-selected', taken && 'is-taken')}
            key={color.id}
          >
            <input
              type="radio"
              name={name}
              value={color.id}
              checked={selected}
              onChange={() => onChange(color.id)}
              disabled={taken}
            />
            <span className="swatch-chip" style={{ backgroundColor: color.hex }} aria-hidden="true" />
            <span className="swatch-name">
              {color.name}
              {taken ? <span className="swatch-taken">, taken</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function colorHex(colorId) {
  return PALETTE.find((color) => color.id === colorId)?.hex ?? '#1e5b3f';
}

export function TeamMark({ name, color, size = 'normal' }) {
  return (
    <span
      className={classNames('team-mark', size === 'small' && 'team-mark-small')}
      style={{ '--team-color': colorHex(color) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Toast({ notice, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(onClose, 5200);
    return () => clearTimeout(timer);
  }, [notice, onClose]);

  if (!notice) return null;
  return (
    <div className={classNames('toast', `toast-${notice.tone ?? 'info'}`)} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <p>{notice.text}</p>
      <button type="button" className="toast-close" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}

export function Dialog({ open, title, onClose, children, footer, wide = false }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    panel?.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = panel.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={classNames('dialog', wide && 'dialog-wide')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      <p className="empty-copy">{children}</p>
    </div>
  );
}

export function LoadingState({ children = 'Loading the room.' }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-rule" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy code' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
  }

  return (
    <span className="copy-wrap">
      <Button variant="quiet" onClick={copy}>
        {copied ? 'Copied' : label}
      </Button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </span>
  );
}

export function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  );
}
