import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="py-20 px-6 border-t border-border bg-background">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 items-center justify-center relative overflow-hidden">
            <Logo className="h-6" />
          </div>
          <span className="font-brand text-[20px] font-semibold tracking-[-0.03em] text-foreground">
            foOom
          </span>
        </div>



        <p className="text-[13px] font-medium text-muted-foreground">
          Copyright {new Date().getFullYear()} foOom. Built with love ❤️
        </p>
      </div>
    </footer>
  );
}
