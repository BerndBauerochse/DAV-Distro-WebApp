/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      backdropBlur: { '2xl': '40px' },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        glow:  '0 0 20px rgba(34,211,238,0.3)',
        card:  '0 4px 24px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
}
