export function Footer() {
  return (
    <footer className="border-t border-border py-12 px-6">
      <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-primary-foreground">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="4" fill="currentColor" />
            </svg>
          </div>
          <span className="font-display text-sm font-semibold text-foreground">ZoomCast</span>
        </div>
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} ZoomCast. Browser-first AI screen recording.
        </p>
      </div>
    </footer>
  );
}
