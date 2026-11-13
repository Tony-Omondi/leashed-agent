// Small shared pieces. Icons are Icons8 "Material Rounded" PNGs (see icons8.json),
// used as CSS masks so they inherit currentColor.
export function Icon({ name, size = 20, className = "" }) {
  const url = `url(/icons/${name}.png)`;
  return (
    <span
      aria-hidden="true"
      className={`icon ${className}`}
      style={{ width: size, height: size, maskImage: url, WebkitMaskImage: url }}
    />
  );
}

const STAMP = {
  PAID: "text-leaf",
  REQUESTED: "text-maize",
  DONE: "text-leaf",
  REVERTED: "text-murram",
  ERROR: "text-ink-3",
  "NO TX": "text-ink-3",
};

export function Stamp({ verdict, small = false, big = false }) {
  const size = small ? "px-1.5 py-px text-[10px]" : big ? "px-3 py-1 text-[16px] sm:px-4 sm:py-1.5 sm:text-[22px] border-[3px]" : "px-3 py-1 text-[15px]";
  return (
    <span key={verdict} className={`stamp ${STAMP[verdict]} ${size}`}>
      {verdict}
    </span>
  );
}

export function Label({ children, className = "" }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3 ${className}`}>{children}</div>
  );
}

export function Card({ children, className = "" }) {
  return <section className={`rounded-[14px] border border-rule bg-sheet ${className}`}>{children}</section>;
}

export function Pill({ tone = "leaf", children }) {
  const tones = {
    leaf: "bg-leaf-wash text-leaf",
    murram: "bg-murram-wash text-murram",
    maize: "bg-maize-wash text-maize",
    ink: "bg-well text-ink-2",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tones[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const BTN = {
  primary: "bg-ink text-sheet hover:bg-ink/90 border-transparent",
  quiet: "bg-sheet text-ink border-rule-strong hover:bg-well",
  danger: "bg-sheet text-murram border-murram/35 hover:bg-murram-wash",
};

export function Button({ variant = "quiet", icon, children, className = "", ...rest }) {
  return (
    <button
      type="button"
      className={`press inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] border px-3.5 text-[14px] font-medium
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf
        disabled:cursor-not-allowed disabled:opacity-45 ${BTN[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
