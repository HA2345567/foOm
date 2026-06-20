import React from "react";

interface WindowsIconProps extends React.SVGProps<SVGSVGElement> {}

export function WindowsIcon(props: WindowsIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M0 3.449L9.75 2.1v9.45H0V3.449zM0 12.45h9.75v9.45L0 20.551v-8.101zM11.25 1.89L24 0v11.55H11.25V1.89zM11.25 12.45H24v11.55l-12.75-1.89v-9.66z" />
    </svg>
  );
}
