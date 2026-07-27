import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Logo } from "./Logo";
import { DownloadButton } from "./DownloadButton";

const navLinks: { label: string; href: string }[] = [];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-colors ${
        mobileOpen ? "bg-black/95 backdrop-blur-md border-b border-border" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 flex items-center justify-center transition-all duration-500 group-hover:-translate-y-0.5 relative overflow-hidden">
            <Logo className="w-9 h-9 text-[#f5f5f7] relative z-10" />
          </div>
          <span className="font-brand text-[24px] font-semibold tracking-[-0.03em] text-foreground">
            foOm
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
          <DownloadButton
            label="Download"
            useWindowsIcon={false}
            innerClassName="px-5 py-2 text-[14px] flex items-center gap-2"
            speed="5s"
          />
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            {mobileOpen ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 8h16M4 16h16" />}
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
            className="md:hidden overflow-hidden bg-black/95 shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
          >
            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 pb-5 pt-2">
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
              <DownloadButton
                label="Download for Windows"
                className="w-full"
                innerClassName="px-4 py-3.5 text-[15px] flex items-center justify-center gap-2"
                speed="5s"
                onClick={() => setMobileOpen(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
