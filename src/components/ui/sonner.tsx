import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-right"
      richColors
      closeButton
      expand
      visibleToasts={4}
      className="toaster group"
      toastOptions={{
        duration: 4200,
        classNames: {
          toast:
            "group toast pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-white/10 bg-[hsl(220_20%_8%/0.85)] px-4 py-3.5 text-sm text-foreground shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-xl backdrop-saturate-150",
          title: "text-[13px] font-semibold leading-snug tracking-tight text-foreground",
          description: "text-[12px] leading-snug text-muted-foreground mt-0.5",
          icon: "shrink-0 mt-0.5",
          loader: "shrink-0",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md group-[.toast]:px-2.5 group-[.toast]:py-1 group-[.toast]:text-xs group-[.toast]:font-medium hover:group-[.toast]:opacity-90 transition-opacity",
          cancelButton:
            "group-[.toast]:bg-white/5 group-[.toast]:text-muted-foreground group-[.toast]:rounded-md group-[.toast]:px-2.5 group-[.toast]:py-1 group-[.toast]:text-xs hover:group-[.toast]:bg-white/10 transition-colors",
          closeButton:
            "group-[.toast]:bg-white/5 group-[.toast]:border-white/10 group-[.toast]:text-muted-foreground hover:group-[.toast]:bg-white/10 hover:group-[.toast]:text-foreground transition-colors",
          success:
            "group-[.toaster]:!border-emerald-500/25 group-[.toaster]:!bg-[hsl(160_50%_8%/0.88)] group-[.toaster]:!text-emerald-50",
          error:
            "group-[.toaster]:!border-red-500/30 group-[.toaster]:!bg-[hsl(0_50%_10%/0.88)] group-[.toaster]:!text-red-50",
          warning:
            "group-[.toaster]:!border-amber-500/30 group-[.toaster]:!bg-[hsl(40_50%_10%/0.88)] group-[.toaster]:!text-amber-50",
          info:
            "group-[.toaster]:!border-sky-500/25 group-[.toaster]:!bg-[hsl(210_50%_10%/0.88)] group-[.toaster]:!text-sky-50",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
