import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type HelpTooltipProps = {
  content: ReactNode;
  title?: string;
  className?: string;
  align?: "left" | "center" | "right";
};

export function HelpTooltip({
  content,
  title,
  className = "",
  align = "center",
}: HelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const [placeBelow, setPlaceBelow] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !tooltipRef.current || !containerRef.current) {
      setShiftX(0);
      setPlaceBelow(false);
      return;
    }

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const triggerRect = containerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const edgePadding = 12;

    let nextShiftX = 0;
    if (tooltipRect.left < edgePadding) {
      nextShiftX = edgePadding - tooltipRect.left;
    } else if (tooltipRect.right > viewportW - edgePadding) {
      nextShiftX = viewportW - edgePadding - tooltipRect.right;
    }

    setShiftX(Math.round(nextShiftX));
    setPlaceBelow(triggerRect.top < tooltipRect.height + 24);
  }, [isOpen]);

  const alignmentClasses = {
    left: "left-0 translate-x-0",
    center: "left-1/2 -translate-x-1/2",
    right: "right-0 translate-x-0",
  }[align];

  return (
    <span ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-label={title ? `Penjelasan tentang ${title}` : "Penjelasan istilah"}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -m-2 p-2 text-[var(--muted-foreground)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded-full transition-colors cursor-pointer"
      >
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none select-none"
          aria-hidden="true"
        >
          ?
        </span>
      </button>

      {isOpen && (
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            boxShadow: "var(--elevation-float)",
            marginLeft: shiftX ? `${shiftX}px` : undefined,
          }}
          className={`absolute ${
            placeBelow ? "top-full mt-2" : "bottom-full mb-2"
          } ${alignmentClasses} z-50 w-64 max-w-[calc(100vw-24px)] rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3 text-xs leading-relaxed text-[var(--foreground)] animate-in fade-in zoom-in-95 duration-150`}
        >
          {title && <span className="block font-bold mb-1 text-[var(--primary)]">{title}</span>}
          <span className="block text-[var(--muted-foreground)] font-normal">{content}</span>
        </span>
      )}
    </span>
  );
}
