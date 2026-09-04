type MarkProps = {
  className?: string;
  compact?: boolean;
};

export function RefProMark({ className = "", compact = false }: MarkProps) {
  return (
    <span className={className} aria-label={compact ? "Ref Pro Group" : undefined}>
      <svg viewBox="0 0 180 108" role="img" aria-hidden={compact ? undefined : true} focusable="false">
        <defs>
          <linearGradient id="rpBlue" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#23a7ff" />
            <stop offset="1" stopColor="#0068dc" />
          </linearGradient>
          <linearGradient id="rpNavy" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#0b1c35" />
            <stop offset="1" stopColor="#173d66" />
          </linearGradient>
        </defs>
        <path d="M24 27C61 1 125 2 157 25C126 10 78 11 43 30Z" fill="url(#rpBlue)"/>
        <path d="M17 76C51 103 116 108 159 78C128 96 72 95 31 72Z" fill="#62d531" opacity=".95"/>
        <path d="M44 32H91C105 32 111 39 108 51C106 61 99 66 88 67L101 82H79L67 67H58L53 82H31L44 32ZM61 44L58 56H83C87 56 90 54 91 50C92 46 89 44 85 44H61Z" fill="white"/>
        <path d="M105 32H139C154 32 161 40 158 53C155 67 145 73 131 73H118L115 83H95L105 32ZM120 45L117 60H132C138 60 141 57 142 52C143 47 140 45 135 45H120Z" fill="url(#rpBlue)"/>
      </svg>
    </span>
  );
}

export function RefAssignMark({ className = "", compact = false }: MarkProps) {
  return (
    <span className={className} aria-label={compact ? "RefAssign" : undefined}>
      <svg viewBox="0 0 180 108" role="img" aria-hidden={compact ? undefined : true} focusable="false">
        <defs>
          <linearGradient id="raBlue" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#28a9ff" />
            <stop offset="1" stopColor="#0068dc" />
          </linearGradient>
        </defs>
        <path d="M32 29H83C98 29 106 36 103 49C101 60 94 66 82 67L96 83H74L61 68H52L48 83H27L32 29ZM54 43L51 56H78C83 56 86 54 87 50C88 45 85 43 80 43H54Z" fill="#0c1e37"/>
        <path d="M109 83H88L124 29H144L160 64H140L135 52L116 79Z" fill="url(#raBlue)"/>
        <path d="M124 67L134 76L157 48L166 55L136 90L117 73Z" fill="#61d430"/>
      </svg>
    </span>
  );
}
