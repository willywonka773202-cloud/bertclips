import { ClippingCockpit } from "@/components/clipping/ClippingCockpit";

export const dynamic = "force-dynamic";

/**
 * The bertclips cockpit is the whole app: turn long-form VODs into vertical clips with
 * the free local engine, review + approve, record real payouts, track paid campaigns,
 * and run game promos (own-game clips: dev progress now, launch ads later).
 */
export default function Page() {
  return (
    <div className="h-screen">
      <ClippingCockpit />
    </div>
  );
}
