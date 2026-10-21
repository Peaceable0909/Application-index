'use client';

/** Opens the chat bubble (public/chat-bubble.js, loaded on this page). If the bubble is not there yet, it opens the chat as its own page. */
export default function OpenChat({ ws, className, label, children }: { ws: string; className?: string; label?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      onClick={() => {
        const bubble = document.querySelector<HTMLButtonElement>('#wr-chat-root button');
        if (!bubble) { window.location.href = `/hello/${encodeURIComponent(ws)}?src=website`; return; }
        if (bubble.getAttribute('aria-expanded') !== 'true') bubble.click();
      }}
    >
      {children}
    </button>
  );
}
