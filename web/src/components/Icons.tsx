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
export const TabMap = () => tabIcon(<><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>);
export const TabRoutes = () => tabIcon(<><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5" /></>);
export const TabCrew = () => tabIcon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>);
export const TabRides = () => tabIcon(<path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />);
export const TabMe = () => tabIcon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>);
