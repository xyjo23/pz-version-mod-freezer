type VaultMarkProps = {
  className?: string
}

export const VaultMark = ({ className }: VaultMarkProps): React.JSX.Element => (
  <svg
    className={className}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M24 3.5 40 9v12.7c0 10.5-6.5 18.8-16 22.8-9.5-4-16-12.3-16-22.8V9l16-5.5Z"
      fill="currentColor"
      fillOpacity=".16"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="23" r="10.5" stroke="currentColor" strokeWidth="2.5" />
    <path d="M24 12.5v4M24 29.5v4M13.5 23h4M30.5 23h4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M19.5 21.5h2.5M26 21.5h2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="m21 27 3-2 3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
