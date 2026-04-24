interface OdontoFlowLogoProps {
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
  textClassName?: string;
  subtextClassName?: string;
  showText?: boolean;
}

const sizeMap = {
  sm: { img: 32, name: "text-[13px]", sub: "text-[9px]" },
  md: { img: 40, name: "text-[15px]", sub: "text-[10px]" },
  lg: { img: 48, name: "text-[17px]", sub: "text-[10px]" },
  xl: { img: 56, name: "text-[22px]", sub: "text-[12px]" },
  "2xl": { img: 80, name: "text-[26px]", sub: "text-[14px]" },
};

export default function OdontoFlowLogo({
  size = "md",
  className = "",
  textClassName = "",
  subtextClassName = "",
  showText = true,
}: OdontoFlowLogoProps) {
  const { img: px, name: nameCls, sub: subCls } = sizeMap[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img
        src="/odontoflow-logo.png"
        alt="OdontoFlow"
        width={px}
        height={px}
        className="rounded-xl object-contain flex-shrink-0"
        style={{ width: px, height: px }}
      />
      {showText && (
        <div className="min-w-0">
          <span
            className={`block font-bold tracking-tight leading-tight ${nameCls} ${textClassName}`}
          >
            OdontoFlow
          </span>
          <span
            className={`block font-semibold tracking-[0.13em] uppercase leading-tight ${subCls} ${subtextClassName}`}
          >
            Secretária IA
          </span>
        </div>
      )}
    </div>
  );
}
