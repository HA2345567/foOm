import React from 'react';
import './StarBorder.css';

interface StarBorderProps<T extends React.ElementType = 'button'> {
  as?: T;
  className?: string;
  innerClassName?: string;
  color?: string;
  speed?: string;
  thickness?: number;
  children?: React.ReactNode;
}

export const StarBorder = <T extends React.ElementType = 'button'>({
  as,
  className = '',
  innerClassName = '',
  color = 'white',
  speed = '6s',
  thickness = 1,
  children,
  ...rest
}: StarBorderProps<T> & Omit<React.ComponentPropsWithoutRef<T>, keyof StarBorderProps<T>>) => {
  const Component = as || 'button';
  return (
    <Component
      className={`star-border-container ${className}`}
      style={{
        padding: `${thickness}px 0`,
        ...(rest.style as React.CSSProperties)
      }}
      {...rest}
    >
      <div
        className="border-gradient-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed
        }}
      ></div>
      <div
        className="border-gradient-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed
        }}
      ></div>
      <div className={`inner-content ${innerClassName}`.trim()}>{children}</div>
    </Component>
  );
};

export default StarBorder;
