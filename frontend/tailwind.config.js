/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        // Design system Criciuma EC (amarelo/preto/branco), alto contraste.
        'brand-yellow': '#FACC15',
        'brand-yellow-hover': '#EAB308',
        'brand-black': '#131217',
        'brand-dark': '#1F2937',
        // Dark mode fixo pro sistema inteiro (escritorio + motorista), sem
        // alternancia - pedido explicito do usuario. #121212 em vez de preto
        // puro evita fadiga ocular (Bloco 1 do parecer de refatoracao).
        'brand-light': '#121212',
        // Superficie "elevada" (cards, modais, dropdowns) - um tom mais claro
        // que o fundo da pagina pra dar profundidade, como bg-white fazia no
        // claro (pagina cinza-clara + card branco). Substitui bg-white nesses
        // usos; texto branco de verdade (text-white) continua intacto.
        'brand-surface': '#1E1E1E',
        // slate/gray: a maioria do sistema usa essas escalas de forma
        // "posicional" (900 = texto principal, 50/100 = fundo sutil, etc) -
        // invertida aqui pra virar dark mode automaticamente em ~98% dos
        // usos, sem tocar em nenhuma tela. As poucas excecoes onde
        // slate/gray-800/900 eram usados como fundo FIXO escuro (hover do
        // menu, scrim de modal, toast) foram trocadas por bg-white/10,
        // bg-black/40 ou brand-dark - ver commits desta mudanca.
        slate: {
          50: '#18171C', 100: '#1F1E23', 200: '#2B2A30', 300: '#3D3B42',
          400: '#68656F', 500: '#8B8894', 600: '#ACA9B3', 700: '#C9C6CE',
          800: '#E1DFE4', 900: '#F5F4F6', 950: '#FAFAFB',
        },
        gray: {
          50: '#18181A', 100: '#1F1F21', 200: '#2C2C2F', 300: '#3E3E42',
          400: '#69696E', 500: '#8C8C91', 600: '#ADADB1', 700: '#CACACD',
          800: '#E2E2E3', 900: '#F5F5F6', 950: '#FAFAFA',
        },
      },
    },
  },
  plugins: [],
};
