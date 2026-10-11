type VyaktiMarkProps = {
  className?: string;
  showDomain?: boolean;
};

export default function VyaktiMark({ className = "", showDomain = true }: VyaktiMarkProps) {
  return (
    <span className={`vyakti-mark${className ? ` ${className}` : ""}`}>
      <span className="vyakti-mark__glyph" aria-hidden="true" lang="hi">{"\u0935\u094d\u092f"}</span>
      <span className="vyakti-mark__word">
        <span>vyakti</span>
        {showDomain ? <small>.ai</small> : null}
      </span>
    </span>
  );
}
