/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        blood: {
          50: '#FFF5F5', 100: '#FFE3E3', 200: '#FFC9C9', 300: '#FFA8A8',
          400: '#FF6B6B', 500: '#E03131', 600: '#C92A2A', 700: '#A51111',
          800: '#7A0C0C', 900: '#520808',
        },
        ink: { 50: '#F7F8FA', 100: '#EDEFF3', 200: '#DCE0E8', 300: '#C2C8D4', 400: '#8C95A6', 500: '#5F6A7D', 600: '#434D5E', 700: '#2F3846', 800: '#1E2531', 900: '#121821' },
        vital: { 50: '#ECFDF3', 500: '#12A150', 600: '#0C7A3D' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Helvetica Neue', 'Arial', 'Noto Kufi Arabic', 'Tahoma', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(18,24,33,.04), 0 8px 24px -12px rgba(18,24,33,.18)',
        lift: '0 2px 6px rgba(18,24,33,.06), 0 18px 40px -18px rgba(122,12,12,.28)',
      },
      borderRadius: { xl2: '1.25rem' },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pulseRing: { '0%': { transform: 'scale(.9)', opacity: '.7' }, '70%': { transform: 'scale(1.35)', opacity: '0' }, '100%': { opacity: '0' } },
      },
      animation: { 'fade-up': 'fade-up .45s ease-out both', 'pulse-ring': 'pulseRing 2s ease-out infinite' },
    },
  },
  plugins: [],
};
