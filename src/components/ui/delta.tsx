import { cn } from "@/lib/utils";

interface DeltaProps {
  value: number;
  suffix?: string;
  inverse?: boolean;
  className?: string;
}

export function Delta({ value, suffix = "%", inverse = false, className }: DeltaProps) {
  const isPos = inverse ? value < 0 : value > 0;
  const isNeg = inverse ? value > 0 : value < 0;
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  const formatted = Math.abs(value).toFixed(1).replace(".", ",");

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 text-xs font-semibold",
        isPos && "text-pos",
        isNeg && "text-neg",
        className
      )}
    >
      <span>{arrow}</span>
      <span>{formatted}{suffix}</span>
    </span>
  );
}
