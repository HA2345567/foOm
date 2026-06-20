interface LogoProps {
  className?: string;
}

export function Logo({ className = "" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M18 32L40 10H92V32H40V52H18V32Z" fill="currentColor" />
      <path d="M18 72L40 52H85L63 72H18Z" fill="currentColor" />
      <path d="M18 72H40V95H18V72Z" fill="currentColor" />
      <circle cx="53" cy="42" r="8.5" fill="currentColor" />
    </svg>
  );
}
