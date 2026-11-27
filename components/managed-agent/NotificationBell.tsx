"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Notification } from "@/lib/platform/agent-preferences";
import { MANAGED_REFRESH_EVENT, apiJson, dispatchManagedRefresh, formatDateTime } from "./shared";

type NotificationsResponse = {
  notifications: Notification[];
  unread: number;
};

type NotificationBellProps = {
  onOpenRequest: (requestId: string) => void;
  onOpenMessage?: (messageId: string) => void;
  onOpenWhatsApp?: (conversationId: string) => void;
};

export function NotificationBell({ onOpenRequest, onOpenMessage, onOpenWhatsApp }: NotificationBellProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const body = await apiJson<NotificationsResponse>("/api/platform/notifications");
      setItems(Array.isArray(body.notifications) ? body.notifications : []);
      setUnread(typeof body.unread === "number" ? body.unread : 0);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入通知");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15_000);
    const onRefresh = () => {
      void load();
    };
    window.addEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markRead(id: string) {
    setBusy(id);
    setError("");
    try {
      await apiJson("/api/platform/notifications", {
        method: "PATCH",
        body: JSON.stringify({ id }),
      });
      dispatchManagedRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法標記已讀");
    } finally {
      setBusy("");
    }
  }

  async function markAll() {
    setBusy("all");
    setError("");
    try {
      await apiJson("/api/platform/notifications", {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      });
      dispatchManagedRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法全部標記已讀");
    } finally {
      setBusy("");
    }
  }

  async function handleClickNotification(item: Notification) {
    if (!item.read_at) {
      try {
        await apiJson("/api/platform/notifications", {
          method: "PATCH",
          body: JSON.stringify({ id: item.id }),
        });
        dispatchManagedRefresh();
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "無法標記已讀");
        return;
      }
    }
    setOpen(false);
    if (item.kind === "whatsapp_handoff" && item.whatsapp_conversation_id && onOpenWhatsApp) {
      onOpenWhatsApp(item.whatsapp_conversation_id);
      return;
    }
    if (item.kind === "message" && item.message_id && onOpenMessage) {
      onOpenMessage(item.message_id);
      return;
    }
    if (item.request_id) {
      onOpenRequest(item.request_id);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `通知，${unread} 則未讀` : "通知"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E4E4E7] bg-white text-[#09090B] hover:bg-[#F4F4F5]"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-[#09090B] px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="通知列表"
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#E4E4E7] bg-white shadow-stripe-md"
        >
          <div className="flex items-center justify-between border-b border-[#E4E4E7] px-4 py-3">
            <div className="text-sm font-extrabold">通知</div>
            <button
              type="button"
              disabled={busy === "all" || unread === 0}
              onClick={() => void markAll()}
              className="text-[11px] font-bold text-[#52525B] hover:text-[#09090B] disabled:opacity-40"
            >
              全部已讀
            </button>
          </div>

          {error && (
            <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-[11px] font-semibold text-rose-700" role="alert">
              {error}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto">
            {loading && <div className="px-4 py-8 text-center text-xs text-[#71717A]">載入通知中…</div>}
            {!loading && items.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-[#71717A]">暫時沒有通知</div>
            )}
            {!loading &&
              items.map((item) => (
                <div key={item.id} className={`border-b border-[#F4F4F5] px-4 py-3 ${item.read_at ? "bg-white" : "bg-[#FAFAFA]"}`}>
                  <button
                    type="button"
                    onClick={() => void handleClickNotification(item)}
                    className="w-full text-left"
                  >
                    <div className="text-xs font-bold text-[#09090B]">{item.title || "調整要求更新"}</div>
                    <div className="mt-1 text-[11px] text-[#71717A]">{formatDateTime(item.created_at)}</div>
                  </button>
                  {!item.read_at && (
                    <button
                      type="button"
                      disabled={busy === item.id}
                      onClick={() => void markRead(item.id)}
                      className="mt-2 text-[11px] font-semibold text-[#52525B] hover:text-[#09090B] disabled:opacity-50"
                    >
                      標記已讀
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
