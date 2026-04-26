import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  darkMode: 'class',
  safelist: [
    'bg-agent-price','bg-agent-risk','bg-agent-strategy',
    'bg-agent-coordinator','bg-agent-execution','bg-agent-bot',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#131313',
        surface: '#191919',
        surfaceAlt: '#1f1f1f',
        elevated: '#262626',
        border: 'rgba(255,255,255,0.08)',
        borderStrong: 'rgba(255,255,255,0.14)',
        ink: '#FFFFFF',
        muted: '#9b9b9b',
        subtle: '#6b6b6b',
        brand: {
          DEFAULT: '#E501A5',
          soft: '#E501A51A',
          ring: '#E501A566',
          deep: '#B8007F',
          glow: '#FC72FF',
        },
        accent: '#3FCF8E',
        warn: '#F0B429',
        err: '#FF5C5C',
        agent: {
          price: '#7AA2FF',
          risk: '#F0B429',
          strategy: '#E501A5',
          coordinator: '#3FCF8E',
          execution: '#5BC8FA',
          bot: '#FF7AB6',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '12px', md: '14px', lg: '20px', xl: '24px', '2xl': '28px',
      },
      boxShadow: {
        card: 'none',
        glow: 'none',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #E501A5 0%, #B8007F 100%)',
        'hero-gradient': 'radial-gradient(120% 100% at 0% 0%, rgba(229,1,165,0.10) 0%, transparent 50%), linear-gradient(180deg, #1a1019 0%, #131316 100%)',
      },
      keyframes: {
        'pulse-soft': { '0%,100%': { opacity: '0.55' }, '50%': { opacity: '1' } },
      },
      animation: { 'pulse-soft': 'pulse-soft 2s ease-in-out infinite' },
    },
  },
  plugins: [],
};

export default config;
