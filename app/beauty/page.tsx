import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BeautyBookingForm } from "@/components/beauty/BeautyBookingForm";
import { ServiceBookingLink } from "@/components/beauty/ServiceBookingLink";
import { BEAUTY_SERVICES } from "@/lib/beauty/catalog";
import "./beauty.css";

export const metadata: Metadata = { title: "Orai Beauty｜把時間，留給自己", description: "暖意、留白與細緻護理。Orai Beauty 香港美容院示範網站，探索療程及提交預約要求。", robots: { index: false, follow: false }, alternates: { canonical: "/beauty" } };

export default function BeautyPage() {
  return <main className="beauty-page">
    <div className="beauty-demo-bar">ORAI SERVICE 示範商戶網站 <span>療程、價錢及店舖資料均為虛構，請只使用測試資料。</span></div>
    <header className="beauty-nav"><a className="beauty-wordmark" href="/beauty">orai<span>BEAUTY & WELLNESS</span></a>
      <nav aria-label="美容院網站導覽"><a href="#rituals">我們的療程</a><a href="#space">關於空間</a><a href="#visit">到訪我們</a></nav>
      <a href="#booking" className="beauty-nav-book">預約一段好時光</a></header>

    <section className="beauty-hero">
      <div className="beauty-hero-copy"><p className="beauty-eyebrow">A LITTLE SPACE, JUST FOR YOU</p><h1>把時間，<br />留給自己。</h1>
        <p className="beauty-hero-description">讓日常慢下來，讓肌膚深呼吸。<br />在溫柔的光線裡，找回屬於你的從容。</p>
        <a href="#rituals" className="beauty-button">探索你的護理儀式</a><p className="beauty-hero-footnote">香港 · 私人護理空間 · 預約制</p></div>
      <div className="beauty-hero-image"><Image src="/beauty/salon-hero.png" alt="暖米白圓拱、淺木色與石材接待桌構成的美容院示範空間" fill priority sizes="(max-width: 760px) 100vw, 60vw" />
        <span className="beauty-image-caption">SOFT LIGHT. QUIET MOMENTS.</span></div>
    </section>

    <section className="beauty-intro" id="space"><p className="beauty-eyebrow">THE ORAI WAY</p><h2>照顧肌膚，<br className="beauty-mobile-break" />也照顧你的節奏。</h2><p>我們相信，護理可以是一段安靜的相處。<br />從了解你的需要開始，以細緻的步驟，留住每一刻放鬆。</p><span className="beauty-botanical" aria-hidden="true">✳</span></section>

    <section className="beauty-rituals" id="rituals"><div className="beauty-section-heading"><div><p className="beauty-eyebrow">YOUR SKIN, YOUR RITUAL</p><h2>為你而設的護理。</h2></div><p>三種節奏，一份細心。<br />實際療程會按到店諮詢再作確認。</p></div>
      <div className="beauty-service-grid">{BEAUTY_SERVICES.map((service) => <article className={`beauty-service beauty-service-${service.tone}`} key={service.id}>
        <div className="beauty-service-art" aria-hidden="true"><div className="beauty-stone"/><div className="beauty-stone-small"/><span>{service.english}</span></div>
        <p className="beauty-service-detail">{service.detail}</p><h3>{service.name}</h3><p>{service.description}</p>
        <div className="beauty-service-meta"><span>{service.minutes} 分鐘</span><span>HK${service.price.toLocaleString()}</span></div><ServiceBookingLink serviceId={service.id} />
      </article>)}</div>
      <p className="beauty-disclaimer">以上為示範療程及價目，並非醫療服務或效果保證。</p>
    </section>

    <section className="beauty-pause"><p className="beauty-eyebrow">COME AS YOU ARE</p><p>不趕時間。<br />只好好感受，被照顧的此刻。</p><div className="beauty-pause-line"/></section>

    <section id="booking" className="beauty-booking"><div className="beauty-booking-copy"><p className="beauty-eyebrow">MAKE TIME FOR YOURSELF</p><h2>下一段好時光，<br />由這裡開始。</h2><p>告訴我們你喜歡的療程與到訪時間。<br />收到要求後，店員會再與你確認安排。</p><div className="beauty-booking-process"><div><span>選擇療程及時間</span><p>按你的日常節奏，留下偏好。</p></div><div><span>留下聯絡資料</span><p>只用作處理這一次預約要求。</p></div><div><span>等候店員確認</span><p>提交要求不代表已預留時段。</p></div></div></div><BeautyBookingForm /></section>

    <section className="beauty-visit" id="visit"><div><p className="beauty-eyebrow">A QUIET CORNER IN THE CITY</p><h2>在城市裡，<br />留一個安靜的角落。</h2></div><dl><div><dt>示範地址</dt><dd>香港中環 · Orai 示範護理空間<br /><small>虛構位置，並非實際營業店舖</small></dd></div><div><dt>示範營業時間</dt><dd>星期一至日 11:00 – 19:00<br /><small>只接受預約，時段需由店員確認</small></dd></div><div><dt>預約查詢</dt><dd>請使用本頁預約表格<br /><small>示範網站不設真實電話或電郵</small></dd></div></dl></section>
    <footer className="beauty-footer"><a className="beauty-wordmark" href="/beauty">orai<span>BEAUTY & WELLNESS</span></a><p>用心護理，從容生活。</p><div><Link href="/dashboard">商戶登入</Link><Link href="/">Orai Service</Link><span>© 2026 Orai Beauty · 示範網站</span></div></footer>
  </main>;
}
