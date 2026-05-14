import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="py-20 px-6 border-t border-border bg-background">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 flex items-center justify-center relative overflow-hidden">
             <Logo className="w-7 h-7 text-[#f5f5f7]" />
          </div>
          <span className="font-brand text-[20px] font-semibold tracking-[-0.03em] text-foreground">
            foOm
          </span>
        </div>
        
        <div className="flex items-center gap-10">
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">Twitter</a>
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">GitHub</a>
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">Terms</a>
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">Privacy</a>
        </div>
        
        <p className="text-[13px] font-medium text-muted-foreground">
          © {new Date().getFullYear()} foOm. Build with love.
        </p>
      </div>
    </footer>
  );
}
