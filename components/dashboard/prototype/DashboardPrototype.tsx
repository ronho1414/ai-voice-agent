"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import Image from "next/image";

/**
 * Visual prototype only. Threads are fictional and this module never calls
 * platform APIs. The light shell shows the near-black "or" wordmark. Pixel
 * check: public/prototype/logo-dark-bg.png is near-black "or"; logo-light-bg.png
 * is near-white "or" and is kept for dark surfaces.
 */
const WORDMARK_ON_LIGHT = "/prototype/logo-dark-bg.png";

type ViewId =
  | "overview"
  | "calls"
  | "appointments"
  | "messages"
  | "whatsapp"
  | "knowledge"
  | "profile"
  | "agent";

type IconName =
  | "layout"
  | "phone"
  | "calendar"
  | "messages"
  | "message"
  | "book"
  | "store"
  | "bot"
  | "bell"
  | "search"
  | "send"
  | "plus"
  | "smile"
  | "paperclip";

type Channel = "whatsapp" | "website" | "phone";
type Handler = "ai" | "human";
type StatusFilter = "all" | "unread" | "human" | "ai" | "resolved";
type Author = "customer" | "ai" | "human";

type ChatMessage = {
  id: string;
  from: Author;
  text: string;
};

type Thread = {
  id: string;
  name: string;
  initial: string;
  tint: string;
  preview: string;
  handler: Handler;
  resolved: boolean;
  unread: boolean;
  channel: Channel;
  time: string;
  messages: ChatMessage[];
};

const NAV: { id: ViewId; label: string; hint: string; icon: IconName }[] = [
  { id: "overview", label: "營運總覽", hint: "業務數據及 AI 使用概況", icon: "layout" },
  { id: "calls", label: "通話紀錄", hint: "錄音、逐字稿及摘要", icon: "phone" },
  { id: "appointments", label: "預約管理", hint: "客戶預約及跟進", icon: "calendar" },
  { id: "messages", label: "留言跟進", hint: "AI 收集嘅留言及待辦事項", icon: "messages" },
  { id: "whatsapp", label: "WhatsApp", hint: "即時對話及真人接管", icon: "message" },
  { id: "knowledge", label: "知識庫", hint: "FAQ 及 AI 參考資料", icon: "book" },
  { id: "profile", label: "商戶資料", hint: "公司及營業資訊", icon: "store" },
  { id: "agent", label: "AI 專員", hint: "聲線、語氣及 Agent 偏好", icon: "bot" },
];

const MESSAGE_FOLLOW_UP_COUNT = 4;

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  website: "網站",
  phone: "電話",
};

function threadsFor(markOpenRead: boolean): Thread[] {
  const rows: Thread[] = [
    {
      id: "chen",
      name: "陳小姐",
      initial: "陳",
      tint: "#F6D5E6",
      preview: "可以安排免費 Demo 嗎？",
      handler: "ai",
      resolved: false,
      unread: true,
      channel: "whatsapp",
      time: "14:21",
      messages: [
        { id: "chen-1", from: "customer", text: "你好，想了解吓服務收費。" },
        { id: "chen-2", from: "ai", text: "你好！我哋提供 AI 接待服務，可以自動回覆查詢同安排預約。" },
        { id: "chen-3", from: "customer", text: "可以安排免費 Demo 嗎？" },
        { id: "chen-4", from: "ai", text: "當然可以！請問你幾時方便？" },
      ],
    },
    {
      id: "wong",
      name: "黃先生",
      initial: "黃",
      tint: "#D9F2D9",
      preview: "我想同真人同事確認價錢先。",
      handler: "human",
      resolved: false,
      unread: true,
      channel: "whatsapp",
      time: "13:05",
      messages: [
        { id: "wong-1", from: "customer", text: "你好，想預約今個星期六。" },
        { id: "wong-2", from: "ai", text: "星期六下午有位，我可以幫你留低資料。" },
        { id: "wong-3", from: "customer", text: "我想同真人同事確認價錢先。" },
      ],
    },
    {
      id: "amy",
      name: "Amy Chan",
      initial: "A",
      tint: "#F8E3C4",
      preview: "Thanks for your help",
      handler: "ai",
      resolved: false,
      unread: false,
      channel: "whatsapp",
      time: "11:40",
      messages: [
        { id: "amy-1", from: "customer", text: "Thanks for your help" },
        { id: "amy-2", from: "ai", text: "隨時可以再問。需要我幫你約示範時間嗎？" },
      ],
    },
    {
      id: "lei",
      name: "李小姐",
      initial: "李",
      tint: "#D9E4F8",
      preview: "收到，唔該晒",
      handler: "ai",
      resolved: false,
      unread: false,
      channel: "whatsapp",
      time: "昨天",
      messages: [
        { id: "lei-1", from: "ai", text: "你嘅查詢我已記錄，同事會再覆你細節。" },
        { id: "lei-2", from: "customer", text: "收到，唔該晒" },
      ],
    },
    {
      id: "jason",
      name: "Jason Lee",
      initial: "J",
      tint: "#E6D8F6",
      preview: "可以安排 Demo 嗎？",
      handler: "ai",
      resolved: false,
      unread: true,
      channel: "whatsapp",
      time: "昨天",
      messages: [
        { id: "jason-1", from: "customer", text: "可以安排 Demo 嗎？" },
        { id: "jason-2", from: "ai", text: "可以。平日下午兩點同四點都有空檔。" },
      ],
    },
    {
      id: "cheung",
      name: "張太",
      initial: "張",
      tint: "#F8DDE4",
      preview: "已經改到期四。",
      handler: "ai",
      resolved: true,
      unread: false,
      channel: "whatsapp",
      time: "星期一",
      messages: [
        { id: "cheung-1", from: "customer", text: "可唔可以改期？" },
        { id: "cheung-2", from: "ai", text: "已改到期四下午三點。祝順利。" },
      ],
    },
    {
      id: "chow",
      name: "周先生",
      initial: "周",
      tint: "#D7F0EA",
      preview: "想搵真人同事。",
      handler: "human",
      resolved: false,
      unread: false,
      channel: "website",
      time: "星期一",
      messages: [
        { id: "chow-1", from: "customer", text: "網站個表交咗，想搵真人同事。" },
        { id: "chow-2", from: "ai", text: "已標記待真人跟進。" },
      ],
    },
    {
      id: "chloe",
      name: "Chloe Ng",
      initial: "C",
      tint: "#F7E7C8",
      preview: "What are your opening hours?",
      handler: "ai",
      resolved: false,
      unread: false,
      channel: "whatsapp",
      time: "星期日",
      messages: [
        { id: "chloe-1", from: "customer", text: "What are your opening hours?" },
        { id: "chloe-2", from: "ai", text: "星期一至五 11:00–20:00，星期六 11:00–18:00。星期日休息。" },
      ],
    },
    {
      id: "ng",
      name: "吳小姐",
      initial: "吳",
      tint: "#E4E8F2",
      preview: "多謝，預約已確認",
      handler: "ai",
      resolved: true,
      unread: false,
      channel: "phone",
      time: "星期日",
      messages: [{ id: "ng-1", from: "customer", text: "多謝，預約已確認" }],
    },
    {
      id: "peter",
      name: "Peter Wong",
      initial: "P",
      tint: "#F3E4D4",
      preview: "Can I book a facial?",
      handler: "ai",
      resolved: false,
      unread: false,
      channel: "website",
      time: "星期六",
      messages: [
        { id: "peter-1", from: "customer", text: "Can I book a facial?" },
        { id: "peter-2", from: "ai", text: "可以。請講個方便嘅日子，我幫你睇空檔。" },
      ],
    },
    {
      id: "ho",
      name: "何先生",
      initial: "何",
      tint: "#DCE8F6",
      preview: "已取消星期五",
      handler: "human",
      resolved: true,
      unread: false,
      channel: "phone",
      time: "星期五",
      messages: [{ id: "ho-1", from: "human", text: "已取消星期五嘅預約，有需要再約過。" }],
    },
    {
      id: "lam",
      name: "林小姐",
      initial: "林",
      tint: "#F6E2EE",
      preview: "收到報價",
      handler: "ai",
      resolved: true,
      unread: false,
      channel: "whatsapp",
      time: "星期四",
      messages: [
        { id: "lam-1", from: "ai", text: "示範報價已用訊息送出，呢個對話先標成已解決。" },
        { id: "lam-2", from: "customer", text: "收到報價" },
      ],
    },
  ];
  if (!markOpenRead) return rows;
  return rows.map((row) => (row.id === "chen" ? { ...row, unread: false } : row));
}

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: IconName; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
  const paths: Record<IconName, ReactNode> = {
    layout: (
      <>
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </>
    ),
    phone: (
      <>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        <path d="M14.05 2a9 9 0 0 1 8 7.94" />
        <path d="M14.05 6A5 5 0 0 1 18 10" />
      </>
    ),
    calendar: (
      <>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 14h.01" />
        <path d="M12 14h.01" />
        <path d="M16 14h.01" />
        <path d="M8 18h.01" />
        <path d="M12 18h.01" />
        <path d="M16 18h.01" />
      </>
    ),
    messages: (
      <>
        <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
        <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
      </>
    ),
    message: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
    book: (
      <>
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      </>
    ),
    store: (
      <>
        <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
        <path d="M2 7h20" />
        <path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
      </>
    ),
    bot: (
      <>
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" />
        <path d="M9 13v2" />
      </>
    ),
    bell: (
      <>
        <path d="M10.268 21a2 2 0 0 0 3.464 0" />
        <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    send: (
      <>
        <path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" />
        <path d="M6 12h16" />
      </>
    ),
    plus: (
      <>
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </>
    ),
    smile: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <path d="M9 9h.01" />
        <path d="M15 9h.01" />
      </>
    ),
    paperclip: (
      <>
        <path d="M13.234 20.252 21 12.3" />
        <path d="m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486" />
      </>
    ),
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function statusLabel(thread: Thread) {
  if (thread.resolved) return "已解決";
  if (thread.handler === "human") return "待真人跟進";
  return "AI 自動回覆";
}

export function DashboardPrototype({ initialView = "overview" }: { initialView?: ViewId }) {
  const [view, setView] = useState<ViewId>(initialView);
  const [threads, setThreads] = useState<Thread[]>(() => threadsFor(initialView === "whatsapp"));
  const [selectedId, setSelectedId] = useState("chen");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [stickyId, setStickyId] = useState<string | null>(initialView === "whatsapp" ? "chen" : null);
  const [draft, setDraft] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const current = NAV.find((item) => item.id === view) ?? NAV[0];
  const whatsappUnread = threads.filter((thread) => thread.channel === "whatsapp" && thread.unread).length;

  const inChannel = useMemo(
    () => threads.filter((thread) => channelFilter === "all" || thread.channel === channelFilter),
    [threads, channelFilter],
  );

  const counts = useMemo(
    () => ({
      all: inChannel.length,
      unread: inChannel.filter((thread) => thread.unread).length,
      human: inChannel.filter((thread) => thread.handler === "human" && !thread.resolved).length,
      ai: inChannel.filter((thread) => thread.handler === "ai" && !thread.resolved).length,
      resolved: inChannel.filter((thread) => thread.resolved).length,
    }),
    [inChannel],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inChannel.filter((thread) => {
      const searchOk =
        !needle || thread.name.toLowerCase().includes(needle) || thread.preview.toLowerCase().includes(needle);
      if (!searchOk) return false;
      const statusOk =
        statusFilter === "all" ||
        (statusFilter === "unread" && thread.unread) ||
        (statusFilter === "human" && thread.handler === "human" && !thread.resolved) ||
        (statusFilter === "ai" && thread.handler === "ai" && !thread.resolved) ||
        (statusFilter === "resolved" && thread.resolved);
      return statusOk || thread.id === stickyId;
    });
  }, [inChannel, query, statusFilter, stickyId]);

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const selectedInView = visible.some((thread) => thread.id === selectedId) ? selected : null;

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [selectedId, selected?.messages.length, view]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setBellOpen(false);
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function openThread(id: string) {
    setView("whatsapp");
    setSelectedId(id);
    setStickyId(id);
    setThreads((currentThreads) =>
      currentThreads.map((thread) => (thread.id === id ? { ...thread, unread: false } : thread)),
    );
    setBellOpen(false);
    setAccountOpen(false);
  }

  function toggleHandler() {
    if (!selected) return;
    setThreads((currentThreads) =>
      currentThreads.map((thread) =>
        thread.id === selected.id ? { ...thread, handler: thread.handler === "ai" ? "human" : "ai" } : thread,
      ),
    );
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected) return;
    setDraft("");
    setThreads((currentThreads) =>
      currentThreads.map((thread) =>
        thread.id === selected.id
          ? {
              ...thread,
              handler: "human",
              resolved: false,
              preview: text,
              time: "剛剛",
              unread: false,
              messages: [...thread.messages, { id: `local-${thread.messages.length + 1}`, from: "human", text }],
            }
          : thread,
      ),
    );
  }

  return (
    <div data-prototype="dashboard" className="prototype-shell fixed inset-0 flex overflow-hidden bg-white text-[13px] text-[#20293B]">
      <style>{`
        nextjs-portal{display:none !important}
        .prototype-shell{--rail:88px;--mark-h:40px;--mark-w:calc(var(--mark-h) * 2400 / 1130);--mark-o:calc(var(--mark-h) * 868 / 1130);--mark-cx:calc(var(--mark-h) * 434 / 1130);--logo-clear:calc((var(--rail) / 2) - var(--mark-cx) + var(--mark-w) - var(--rail) + 16px)}
        .orai-logo-reveal{position:absolute;top:0;left:calc(50% - var(--mark-cx));height:var(--mark-h);width:var(--mark-o);overflow:hidden;transition:width 350ms cubic-bezier(0.4, 0, 0.2, 1)}
        .orai-logo-slot:hover .orai-logo-reveal,.orai-logo-slot:focus-within .orai-logo-reveal{width:var(--mark-w)}
        .orai-logo-img{display:block;height:var(--mark-h) !important;width:var(--mark-w) !important;max-width:none !important;max-height:none !important}
        .prototype-header{padding-left:var(--logo-clear)}
        @media (prefers-reduced-motion: reduce){.orai-logo-reveal{transition:none}}
      `}</style>
      <nav aria-label="功能導航" className="relative z-30 flex h-full w-[88px] shrink-0 flex-col overflow-visible bg-[#F0F3F8] px-1.5 py-2.5">
        <div className="orai-logo-slot relative mb-7 h-10 w-full shrink-0">
          <div className="orai-logo-reveal">
            <Image
              src={WORDMARK_ON_LIGHT}
              alt="orai"
              width={2400}
              height={1130}
              priority
              unoptimized
              className="orai-logo-img"
            />
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.id === view;
            const badge = item.id === "messages" ? MESSAGE_FOLLOW_UP_COUNT : item.id === "whatsapp" ? whatsappUnread : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setView(item.id);
                  setBellOpen(false);
                  setAccountOpen(false);
                }}
                aria-current={active ? "page" : undefined}
                className={`group relative flex flex-col items-center gap-1 rounded-md px-1 py-1.5 ${
                  active ? "bg-[#E3EDFC] text-[#2563EB]" : "text-[#7C8798] hover:bg-white/80 hover:text-[#20293B]"
                }`}
              >
                <Icon name={item.icon} />
                <span className="flex max-w-full items-center gap-0.5 text-[10px] leading-none">
                  <span className="truncate">{item.label}</span>
                  {badge > 0 && (
                    <span className="min-w-[14px] rounded-full bg-[#2563EB] px-1 text-center text-[9px] font-semibold leading-[14px] text-white">
                      {badge}
                    </span>
                  )}
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-[#20293B] px-2 py-1 text-left text-[11px] font-normal leading-4 text-white group-hover:block group-focus-visible:block"
                >
                  {item.label}
                  <span className="block text-[10px] text-[#C5CDD8]">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="prototype-header flex h-12 shrink-0 items-center justify-between border-b border-[#E0E4EB] bg-white pr-4">
          <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-semibold">{current.label}</h1>
            <span className="rounded border border-[#E0E4EB] px-1.5 py-0.5 text-[10px] leading-4 text-[#657084]">視覺原型</span>
          </div>
          <div ref={menuRef} className="relative flex items-center gap-1">
            <button
              type="button"
              aria-expanded={bellOpen}
              aria-label="通知"
              onClick={() => {
                setBellOpen((open) => !open);
                setAccountOpen(false);
              }}
              className="relative grid h-8 w-8 place-items-center rounded-md text-[#657084] hover:bg-[#F0F3F8]"
            >
              <Icon name="bell" className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
            </button>
            <button
              type="button"
              aria-expanded={accountOpen}
              aria-label="帳戶選單"
              onClick={() => {
                setAccountOpen((open) => !open);
                setBellOpen(false);
              }}
              className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-[#F0F3F8]"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#E3EDFC] text-[11px] font-semibold text-[#2563EB]">示</span>
              <span className="text-[12px] text-[#20293B]">示範店</span>
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-10 z-40 w-64 rounded-md border border-[#E0E4EB] bg-white p-1 shadow-stripe-sm">
                <p className="px-2 py-1.5 text-[11px] text-[#657084]">虛構通知</p>
                <button type="button" onClick={() => openThread("wong")} className="block w-full rounded px-2 py-1.5 text-left hover:bg-[#F7F8FA]">
                  黃先生等待真人跟進
                </button>
                <button type="button" onClick={() => openThread("jason")} className="block w-full rounded px-2 py-1.5 text-left hover:bg-[#F7F8FA]">
                  Jason Lee 有未讀訊息
                </button>
              </div>
            )}
            {accountOpen && (
              <div className="absolute right-0 top-10 z-40 w-56 rounded-md border border-[#E0E4EB] bg-white p-2 shadow-stripe-sm">
                <p className="text-[13px] font-medium">示範管理員</p>
                <p className="text-[11px] text-[#657084]">demo.shop@example.test</p>
                <p className="mt-2 text-[11px] leading-4 text-[#657084]">原型選單，不會登出正式帳戶。</p>
                <a href="/dashboard" className="mt-2 block rounded px-1 py-1 text-[12px] text-[#2563EB] hover:bg-[#F7F8FA]">
                  正式儀表板
                </a>
              </div>
            )}
          </div>
        </header>

        {view === "whatsapp" ? (
          <Inbox
            counts={counts}
            visible={visible}
            selected={selectedInView}
            selectedId={selectedId}
            query={query}
            statusFilter={statusFilter}
            channelFilter={channelFilter}
            draft={draft}
            threadRef={threadRef}
            onQuery={setQuery}
            onStatus={(value) => {
              setStickyId(null);
              setStatusFilter(value);
            }}
            onChannel={(value) => {
              setStickyId(null);
              setChannelFilter(value);
            }}
            onSelect={openThread}
            onToggle={toggleHandler}
            onDraft={setDraft}
            onSend={sendMessage}
          />
        ) : (
          <section className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4">
            <p className="text-[12px] text-[#657084]">{current.hint}</p>
            <div className="mt-3 max-w-xl rounded-md border border-[#E0E4EB] bg-[#F7F8FA] px-3 py-3 text-[12px] leading-5 text-[#657084]">
              視覺原型。呢頁未接真實資料，亦未取代正式儀表板。
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Inbox({
  counts,
  visible,
  selected,
  selectedId,
  query,
  statusFilter,
  channelFilter,
  draft,
  threadRef,
  onQuery,
  onStatus,
  onChannel,
  onSelect,
  onToggle,
  onDraft,
  onSend,
}: {
  counts: Record<StatusFilter, number>;
  visible: Thread[];
  selected: Thread | null;
  selectedId: string;
  query: string;
  statusFilter: StatusFilter;
  channelFilter: Channel | "all";
  draft: string;
  threadRef: RefObject<HTMLDivElement | null>;
  onQuery: (value: string) => void;
  onStatus: (value: StatusFilter) => void;
  onChannel: (value: Channel | "all") => void;
  onSelect: (id: string) => void;
  onToggle: () => void;
  onDraft: (value: string) => void;
  onSend: (event: FormEvent) => void;
}) {
  const filters: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "全部對話" },
    { id: "unread", label: "未讀訊息" },
    { id: "human", label: "待真人跟進" },
    { id: "ai", label: "AI 自動回覆" },
    { id: "resolved", label: "已解決" },
  ];
  const channels: { id: Channel; label: string; dot: string }[] = [
    { id: "whatsapp", label: "WhatsApp", dot: "#25B879" },
    { id: "website", label: "網站", dot: "#2563EB" },
    { id: "phone", label: "電話", dot: "#657084" },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[196px] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-[#E0E4EB] bg-white px-2 py-3">
        <div className="flex flex-col gap-0.5">
          {filters.map((filter) => {
            const active = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => onStatus(filter.id)}
                className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] ${
                  active ? "bg-[#E3EDFC] font-medium text-[#2563EB]" : "text-[#20293B] hover:bg-[#F7F8FA]"
                }`}
              >
                <span>{filter.label}</span>
                <span className={active ? "text-[#2563EB]" : "text-[#657084]"}>{counts[filter.id]}</span>
              </button>
            );
          })}
        </div>
        <p className="mb-1 mt-4 px-2 text-[10px] font-medium tracking-wide text-[#657084]">渠道</p>
        <div className="flex flex-col gap-0.5">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => onChannel(channelFilter === channel.id ? "all" : channel.id)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                channelFilter === channel.id ? "bg-[#E3EDFC] text-[#2563EB]" : "hover:bg-[#F7F8FA]"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: channel.dot }} />
              {channel.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex w-[300px] shrink-0 flex-col border-r border-[#E0E4EB] bg-white">
        <div className="shrink-0 border-b border-[#E0E4EB] px-3 py-2.5">
          <h2 className="text-[13px] font-semibold text-[#2563EB]">對話列表</h2>
          <label className="mt-2 flex items-center gap-1.5 rounded-md border border-[#E0E4EB] bg-[#F7F8FA] px-2 py-1.5">
            <Icon name="search" className="h-3.5 w-3.5 text-[#657084]" />
            <span className="sr-only">搜尋客戶或訊息</span>
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="搜尋客戶或訊息"
              className="w-full bg-transparent text-[12px] text-[#20293B] outline-none placeholder:text-[#657084]"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.length === 0 && <p className="px-3 py-6 text-[12px] text-[#657084]">沒有符合的對話</p>}
          {visible.map((thread) => {
            const active = thread.id === selectedId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelect(thread.id)}
                className={`flex w-full gap-2.5 border-b border-[#E0E4EB] px-3 py-2.5 text-left ${active ? "bg-[#E3EDFC]" : "hover:bg-[#F7F8FA]"}`}
              >
                <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold" style={{ background: thread.tint }}>
                  {thread.initial}
                  <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-[#25B879]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate ${thread.unread ? "font-semibold" : "font-medium"}`}>{thread.name}</span>
                    <span className="shrink-0 text-[10px] text-[#657084]">{thread.time}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-[#657084]">{thread.preview}</span>
                  <span className="mt-1 inline-flex rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-[#657084]">{statusLabel(thread)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col bg-[#F7F8FA]">
        {selected ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[#E0E4EB] bg-white px-3">
              <span className="relative grid h-8 w-8 place-items-center rounded-full text-[12px] font-semibold" style={{ background: selected.tint }}>
                {selected.initial}
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-[#25B879]" />
              </span>
              <h2 className="truncate text-[13px] font-semibold">{selected.name}</h2>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  selected.handler === "ai" ? "bg-[#E3EDFC] text-[#2563EB]" : "bg-[#E8F8F0] text-[#178A55]"
                }`}
              >
                {selected.handler === "ai" ? "AI 專員" : "真人"}
              </span>
              <span className="ml-auto" />
              <button
                type="button"
                onClick={onToggle}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                  selected.handler === "ai"
                    ? "bg-[#2563EB] text-white hover:bg-[#1D4FD7]"
                    : "border border-[#2563EB] bg-white text-[#2563EB] hover:bg-[#E3EDFC]"
                }`}
              >
                {selected.handler === "ai" ? "Take over" : "Resume AI"}
              </button>
            </header>
            <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
              <p className="text-center text-[11px] text-[#657084]">今日 · {CHANNEL_LABEL[selected.channel]}</p>
              {selected.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
            <form onSubmit={onSend} className="shrink-0 border-t border-[#E0E4EB] bg-white px-3 py-2">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-[#25B879]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#25B879]" />
                {CHANNEL_LABEL[selected.channel]}
                <span className="text-[#657084]">{selected.handler === "ai" ? "AI 專員值守" : "真人回覆中"}</span>
              </p>
              <div className="flex items-center gap-1.5">
                <ComposerIcon name="plus" label="附加（原型未連接）" />
                <ComposerIcon name="smile" label="表情（原型未連接）" />
                <ComposerIcon name="paperclip" label="檔案（原型未連接）" />
                <input
                  value={draft}
                  onChange={(event) => onDraft(event.target.value)}
                  placeholder="輸入訊息"
                  className="h-8 min-w-0 flex-1 rounded-md border border-[#E0E4EB] bg-[#F7F8FA] px-2 text-[12px] outline-none placeholder:text-[#657084] focus:border-[#2563EB]"
                />
                <button type="submit" aria-label="送出" className="grid h-8 w-8 place-items-center rounded-md bg-[#2563EB] text-white">
                  <Icon name="send" className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-[12px] text-[#657084]">此篩選入面沒有呢個對話</div>
        )}
      </section>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.from === "customer") {
    return (
      <div className="flex justify-start">
        <p className="max-w-[70%] rounded-md border border-[#E0E4EB] bg-white px-3 py-2 leading-5">{message.text}</p>
      </div>
    );
  }
  const human = message.from === "human";
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%]">
        <p className="mb-1 text-right text-[10px] text-[#657084]">{human ? "示範店 · 真人" : "Chloe · AI 專員"}</p>
        <p className={`rounded-md px-3 py-2 leading-5 ${human ? "border border-[#2563EB] bg-white" : "bg-[#E3EDFC]"}`}>{message.text}</p>
      </div>
    </div>
  );
}

function ComposerIcon({ name, label }: { name: IconName; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className="grid h-7 w-7 place-items-center rounded text-[#657084] hover:bg-[#F7F8FA]">
      <Icon name={name} className="h-3.5 w-3.5" />
    </button>
  );
}
