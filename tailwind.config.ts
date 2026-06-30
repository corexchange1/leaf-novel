import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: {
          bg: '#F8FAF9',
          card: '#FFFFFF',
          text: '#101828',
          muted: '#667085',
          border: '#E6ECEA',
          primary: '#14B8A6',
          primaryDark: '#0F9F93',
          primarySoft: '#E6FAF6',
          danger: '#EF4444',
        },
      },
      boxShadow: {
        soft: '0 8px 24px rgba(16, 24, 40, 0.06)',
        float: '0 14px 34px rgba(16, 24, 40, 0.14)',
      },
      borderRadius: {
        card: '24px',
        button: '18px',
      },
    },
  },
  plugins: [],
} satisfies Config;
