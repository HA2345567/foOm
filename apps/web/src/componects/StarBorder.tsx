import React from "react";

interface StarBorderProps {
  as?: React.ElementType;
  className?: string;
  innerClassName?: string;
  color?: string;
  speed?: string;
  children: React.ReactNode;
  [key: string]: any;
}

export default function StarBorder({
  as: Component = "div",
  className = "",
  innerClassName = "",
  color = "white",
  speed = "5s",
  children,
  ...props
}: StarBorderProps) {
  return (
    <Component
      className={`relative p-[1px] overflow-hidden rounded-full inline-block ${className}`}
      {...props}
    >
      {/* Animated rotating border background */}
      <div
        className="absolute inset-[-1000%] animate-spin"
        style={{
          animationDuration: speed,
          background: `conic-gradient(from 0deg, transparent 40%, ${color} 50%, transparent 60%)`,
        }}
      />
      {/* Inner content box */}
      <div
        className={`relative bg-black text-white rounded-full h-full w-full flex items-center justify-center transition-colors duration-200 hover:bg-zinc-950 ${innerClassName}`}
      >
        {children}
      </div>
    </Component>
  );
}
