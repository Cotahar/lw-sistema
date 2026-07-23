/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        // Design system Criciuma EC (amarelo/preto/branco), alto contraste.
        'brand-yellow': '#FACC15',
        'brand-yellow-hover': '#EAB308',
        'brand-black': '#111827',
        'brand-dark': '#1F2937',
        'brand-light': '#F9FAFB',
      },
    },
  },
  plugins: [],
};
