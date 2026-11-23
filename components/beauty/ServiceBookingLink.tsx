"use client";

export function ServiceBookingLink({ serviceId }: { serviceId: string }) {
  return <a href="#booking" className="beauty-service-link" onClick={() => window.dispatchEvent(new CustomEvent("beauty:select-service", { detail: serviceId }))}>選擇此療程</a>;
}
