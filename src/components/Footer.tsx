import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="py-20 px-6 border-t border-border bg-background">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-br from-white to-gray-100" />
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10">
              <path d="M4 8L12 4L20 8V16L12 20L4 16V8Z" stroke="black" strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="3" fill="black" />
            </svg>
          </div>
          <span className="font-display text-[17px] font-medium tracking-[-0.07em] text-foreground flex items-baseline">
            Zo<span className="font-bold tracking-[-0.09em]">O</span>mly
          </span>
        </div>
        
        <div className="flex items-center gap-10">
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">Twitter</a>
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">GitHub</a>
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">Terms</a>
          <a href="#" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">Privacy</a>
        </div>
        
        <p className="text-[13px] font-medium text-muted-foreground">
          © {new Date().getFullYear()} ZoOmly. Build with love.
        </p>
      </div>
    </footer>
  );
}
