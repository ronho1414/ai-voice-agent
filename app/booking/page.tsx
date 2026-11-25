import type { Metadata } from "next";
import { RedirectHome } from "@/components/voicepilot/RedirectHome";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function BookingPage() {
  return <RedirectHome page="home" section="demo-booking-form" />;
}
