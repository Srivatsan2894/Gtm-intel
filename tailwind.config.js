/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        ink: '#0d0d0d',
        paper: '#f5f2ec',
        accent: '#6c63ff',
        accent2: '#ff6584',
        surface: '#111118',
        surface2: '#1a1a24',
        border: '#2a2a38',
        muted: '#6b6b80',
      }
    },
  },
  plugins: [],
}
