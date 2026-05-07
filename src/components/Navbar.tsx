import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-b border-border">
      <div className="mx-auto max-w-7xl px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-11 h-11 rounded-2xl bg-[#f5f5f7] flex items-center justify-center transition-all duration-500 group-hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] group-hover:-translate-y-0.5 relative overflow-hidden">
            {/* Background Texture/Gradient for Premium Feel */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#f5f5f7] via-[#f5f5f7] to-gray-200 opacity-50" />
            
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10">
              {/* The "Z-Focus" Mark */}
              <path 
                d="M4 8L12 4L20 8V16L12 20L4 16V8Z" 
                stroke="black" 
                strokeWidth="2" 
                strokeLinejoin="round"
              />
              <path 
                d="M4 8L12 12M12 12L20 8M12 12V20" 
                stroke="black" 
                strokeWidth="1.5" 
                strokeOpacity="0.3" 
                strokeLinecap="round"
              />
              {/* The Core Focus Node */}
              <circle cx="12" cy="12" r="2.5" fill="black" />
              <circle cx="12" cy="12" r="5" stroke="black" strokeWidth="0.5" strokeDasharray="2 2" />
            </svg>
          </div>
          <span className="font-display text-[21px] font-medium tracking-[-0.07em] text-foreground flex items-baseline">
            Zo<span className="font-bold tracking-[-0.09em]">O</span>mly
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-10">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[14px] font-medium text-muted-foreground hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-6">
          <a
            href="#pricing"
            className="text-[14px] font-medium text-muted-foreground hover:text-white transition-colors"
          >
            Log in
          </a>
          <Link
            to="/record"
            className="px-5 py-2 rounded-full bg-[#f5f5f7] text-black text-[14px] font-bold shadow-button hover:bg-white transition-all active:scale-95"
          >
            Start Recording
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {mobileOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 8h16M4 16h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden border-b border-border bg-black"
          >
            <div className="px-6 py-6 flex flex-col gap-6">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-[16px] font-medium text-muted-foreground hover:text-white transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <Link 
                to="/record" 
                className="block w-full px-4 py-3.5 rounded-full bg-[#f5f5f7] text-black text-[15px] font-bold text-center" 
                onClick={() => setMobileOpen(false)}
              >
                Start Recording
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

