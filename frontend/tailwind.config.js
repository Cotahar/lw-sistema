/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        // Amarelo exato extraido da logo (logo-frottex.png, seta do "X") -
        // #F9C307 - com o resto da rampa derivado do mesmo matiz/saturacao.
        brand: {
          50: '#fffbf0',
          100: '#fef6d7',
          200: '#fdebaa',
          300: '#fbde74',
          400: '#F9C307',
          500: '#e0af00',
          600: '#c79d05',
          700: '#a48104',
          800: '#866a03',
          900: '#685203',
        },
      },
    },
  },
  plugins: [],
};
