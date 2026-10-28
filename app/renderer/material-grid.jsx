import React, { useLayoutEffect, useRef, useState } from "react";

// Keep full-library selection/filtering in the parent; mount only nearby rows.
export function MaterialGrid({ items, density, children }) {
  const holder = useRef(null);
  const [view, setView] = useState({ width: 0, height: 600, top: 0, cardHeight: 300 });
  const minWidth = { small: 150, medium: 260, large: 280 }[density];
  const columns = Math.max(1, Math.floor((view.width - 24) / (minWidth + 24)));
  const stride = view.cardHeight + 24, rows = Math.ceil(items.length / columns);
  const first = Math.max(0, Math.min(rows - 1, Math.floor((view.top - 24) / stride) - 2));
  const end = Math.min(rows, first + Math.ceil(view.height / stride) + 5);
  useLayoutEffect(() => {
    const el = holder.current;
    const measure = () => setView(v => ({ ...v, width: el.clientWidth, height: el.clientHeight }));
    const observer = new ResizeObserver(measure);
    observer.observe(el);measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const card = holder.current.querySelector('.asset-card');
    if (!card) return;
    const observer = new ResizeObserver(() => {
      const cardHeight = card.getBoundingClientRect().height;
      setView(v => v.cardHeight === cardHeight ? v : { ...v, cardHeight });
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [first, columns, items]);
  useLayoutEffect(() => {
    holder.current.scrollTop = 0;
    setView(v => ({ ...v, top: 0 }));
  }, [items, density]);
  return <div className="asset-grid" ref={holder} style={{ flex: 1, minHeight: 0, gridAutoRows: 'max-content', overflowAnchor: 'none' }}
    onScroll={e => { const top = e.currentTarget.scrollTop;setView(v => ({ ...v, top })); }}>
    {first > 0 && <div aria-hidden style={{ gridColumn: '1 / -1', height: first * stride - 24 }} />}
    {items.slice(first * columns, end * columns).map(children)}
    {end < rows && <div aria-hidden style={{ gridColumn: '1 / -1', height: (rows - end) * stride - 24 }} />}
  </div>;
}
