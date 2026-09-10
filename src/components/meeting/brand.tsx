import Image from "next/image";
import { productName } from "@/lib/product";
import { cn } from "@/lib/utils";

export function Brand({ className, compact = false, hideCopyOnMobile = false }: { className?: string; compact?: boolean; hideCopyOnMobile?: boolean }) {
  return (
    <div className={cn("inline-flex min-w-0 items-center gap-2.5", className)} data-testid="brand">
      <Image
        alt=""
        className={cn("size-9 shrink-0", compact && "size-8")}
        data-testid="agora-logo"
        height={compact ? 32 : 36}
        priority
        src="/agora-logo-mark.svg"
        width={compact ? 32 : 36}
      />
      <span className={cn("grid min-w-0", hideCopyOnMobile && "max-sm:hidden")}>
        <strong className="truncate text-[15px] font-bold leading-5 text-meeting">{productName}</strong>
      </span>
    </div>
  );
}
