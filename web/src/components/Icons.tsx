import type { JSX } from "preact";

type P = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;

const base = (size: number, rest: JSX.SVGAttributes<SVGSVGElement>) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  "stroke-width": 2, "stroke-linecap": "round" as const, "stroke-linejoin": "round" as const, "aria-hidden": true, ...rest,
});

export const Search = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const Back = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M15 5l-7 7 7 7" /></svg>;
export const Plus = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M12 5v14M5 12h14" /></svg>;
export const Close = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const Swap = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></svg>;
export const Layers = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>;
export const Locate = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M21 3L3 10.5l7.5 3 3 7.5L21 3z" /></svg>;
export const Share = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>;
export const Watch = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3" /></svg>;
export const Bookmark = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
export const Timer = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>;
export const Train = ({ size = 22, ...r }: P) => <svg {...base(size, r)}><rect x="6" y="3" width="12" height="14" rx="3" /><path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4" /></svg>;
export const Speaker = ({ size = 22, ...r }: P) => <svg {...base(size, r)}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9a4 4 0 010 6" /></svg>;
export const Muted = ({ size = 22, ...r }: P) => <svg {...base(size, r)}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9l4 6M21 9l-4 6" /></svg>;
export const Trash = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const Grip = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3" /></svg>;
export const ChevronDown = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M6 9l6 6 6-6" /></svg>;
export const ChevronUp = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M6 15l6-6 6 6" /></svg>;
/** A compass needle: red end points north. Rotate the whole icon by -bearing. */
export const Needle = ({ size = 26, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...r}>
    <path d="M12 2.5l3.6 9.5H8.4z" fill="#D9541E" />
    <path d="M12 21.5l-3.6-9.5h7.2z" fill="#9AA39E" />
  </svg>
);
export const Pin = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>;

export function Turn({ type, size = 52 }: { type: string; size?: number }) {
  const p = base(size, { "stroke-width": 2.4 });
  switch (type) {
    case "turn-left": return <svg {...p}><path d="M16 20v-7a4 4 0 00-4-4H5" /><path d="M9 5L5 9l4 4" /></svg>;
    case "bear-left": return <svg {...p}><path d="M16 20v-6l-7-7" /><path d="M9 12V7h5" /></svg>;
    case "bear-right": return <svg {...p}><path d="M8 20v-6l7-7" /><path d="M15 12V7h-5" /></svg>;
    case "uturn": return <svg {...p}><path d="M8 20V9a4 4 0 018 0v4" /><path d="M12 10l4 4 4-4" /></svg>;
    case "park": case "arrive": return <svg {...p}><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M10 16V8h3a2.5 2.5 0 010 5h-3" /></svg>;
    case "continue": case "join": case "depart": return <svg {...p}><path d="M12 20V5M7 10l5-5 5 5" /></svg>;
    default: return <svg {...p}><path d="M8 20v-7a4 4 0 014-4h7" /><path d="M15 5l4 4-4 4" /></svg>;
  }
}

const tabIcon = (d: JSX.Element) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>;
export const TabHome = () => tabIcon(<><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></>);
export const TabMap = () => tabIcon(<><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>);
export const TabRoutes = () => tabIcon(<><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5" /></>);
export const TabCrew = () => tabIcon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>);
export const TabRides = () => tabIcon(<path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />);
export const TabMe = () => tabIcon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>);
export const More = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
export const RouteIcon = ({ size = 22, ...r }: P) => <svg {...base(size, r)}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5" /></svg>;
export const PlayIcon = ({ size = 22, ...r }: P) => <svg {...base(size, r)}><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5.5 3.5-5.5 3.5z" /></svg>;
export const Gear = ({ size = 22, ...r }: P) => <svg {...base(size, r)} stroke-width="2.4"><circle cx="12" cy="12" r="6.2" /><circle cx="12" cy="12" r="2.3" /><path d="M18.5 12.0L21.3 12.0M16.6 16.6L18.6 18.6M12.0 18.5L12.0 21.3M7.4 16.6L5.4 18.6M5.5 12.0L2.7 12.0M7.4 7.4L5.4 5.4M12.0 5.5L12.0 2.7M16.6 7.4L18.6 5.4" stroke-width="3.2" /></svg>;
export const Upload = ({ size = 20, ...r }: P) => <svg {...base(size, r)}><path d="M12 15V4" /><path d="M7 8.5L12 4l5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" /></svg>;
export const Cloud = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M7 18a4.5 4.5 0 01-.5-8.97A6 6 0 0118 10.5 3.75 3.75 0 0117.25 18H7z" /></svg>;
export const CloudRain = ({ size = 18, ...r }: P) => <svg {...base(size, r)}><path d="M7 15a4.5 4.5 0 01-.5-8.97A6 6 0 0118 7.5 3.75 3.75 0 0117.25 15H7z" /><path d="M8 18.5l-1 2M12 18.5l-1 2M16 18.5l-1 2" /></svg>;
