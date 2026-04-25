import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: '#0e0e10',           // app background
        surface: '#131316',      // primary card surface
        surfaceAlt: '#17171b',   // hover / nested surface
        elevated: '#1c1c22',     // raised pills, badges
        border: 'rgba(255,255,255,0.06)',
        borderStrong: 'rgba(255,255,255,0.10)',

        // Text
        ink: '#FFFFFF',
        muted: '#9b9b9b',
        subtle: '#6b6b6b',

        // Brand
        brand: {
          DEFAULT: '#FC72FF',
          soft: '#FC72FF1A',     // 10% pink for soft fills
          ring: '#FC72FF66',
          deep: '#D945E2',       // hover/pressed
          glow: '#FF007A',       // older Uniswap pink, for accents
        },

        // Status
        accent: '#3FCF8E',       // success / approved (Uniswap green)
        warn: '#F0B429',
        err: '#FF5C5C',

        // Agents — re-tinted to feel of-a-piece with the dark surface
        agent: {
          price: '#7AA2FF',
          risk: '#F0B429',
          strategy: '#FC72FF',
          coordinator: '#3FCF8E',
          execution: '#5BC8FA',
          bot: '#FF7AB6',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Tighter, more product-feel
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
      },
      borderRadius: {
        DEFAULT: '12px',
        md: '14px',
        lg: '20px',
        xl: '24px',
        '2xl': '28px',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 30px -12px rgba(0,0,0,0.6)',
        glow: '0 0 24px -4px rgba(252,114,255,0.35)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #FC72FF 0%, #D945E2 50%, #8B5CF6 100%)',
        'hero-gradient': 'radial-gradient(120% 100% at 0% 0%, rgba(252,114,255,0.08) 0%, transparent 50%), linear-gradient(180deg, #15101a 0%, #131316 100%)',
        'pill-gradient': 'linear-gradient(135deg, rgba(252,114,255,0.15), rgba(139,92,246,0.10))',
      },
      animation: {
        'row-enter': 'row-enter 240ms ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
      keyframes: {
        'row-enter': {
          from: { opacity: '0', transform: 'translateY(-3px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
