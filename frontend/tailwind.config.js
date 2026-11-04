/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      borderColor: { DEFAULT: '#262A31' },
      // Tipografia "letreiro de rodovia": Barlow Semi Condensed na interface (cabe mais coluna
      // na tabela), Barlow Condensed nos titulos e numeros grandes (font-display), JetBrains
      // Mono so em identificadores. A condensada le menor, entao a escala sobe ~1px.
      fontSize: {
        xs: ['0.8125rem', '1.15rem'],
        sm: ['0.9375rem', '1.35rem'],
        base: ['1.0625rem', '1.55rem'],
        lg: ['1.1875rem', '1.65rem'],
        xl: ['1.375rem', '1.8rem'],
        '2xl': ['1.75rem', '2rem'],
        '3xl': ['2.125rem', '2.35rem'],
        '4xl': ['2.625rem', '1'],
      },
      fontFamily: {
        sans: ['"Barlow Semi Condensed"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', '"Barlow Semi Condensed"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Sistema visual "Rodovia" (tema escuro fixo, escritorio + motorista).
        // Superficies = asfalto (grafite levemente quente, sem preto puro); cores de estado =
        // sinalizacao rodoviaria brasileira: azul (servico/acao), amarelo (advertencia),
        // vermelho (regulamentacao), verde (indicacao). Contrastes AA conferidos.
        'brand-light': '#0B0C0E', // asfalto: fundo da pagina
        'brand-surface': '#121418', // pista: card
        elevated: '#181B20', // meio-fio: modal, menu, dropdown, cabecalho de tabela
        'brand-dark': '#1F2329', // calcada: hover de linha/botao secundario
        line: '#262A31', // filete
        field: '#343945', // borda de campo e de botao secundario

        // Placa de servico (azul) = acao principal. "fg" = tom claro p/ texto, link e foco.
        accent: {
          DEFAULT: '#2B63F0',
          hover: '#1F52D6',
          fg: '#7EA4FF',
          soft: '#161F36',
        },
        // DEFAULT = cor base (texto/borda/faixa), soft = fundo (~12% da cor sobre o card),
        // text = tom claro p/ texto sobre o "soft".
        success: { DEFAULT: '#2BB673', soft: '#152723', text: '#6FDBA5' },
        warning: { DEFAULT: '#F5B800', soft: '#2D2815', text: '#FFD34D' },
        danger: { DEFAULT: '#F0524A', soft: '#2D1B1E', text: '#FF8B84' },
        info: { DEFAULT: '#7EA4FF', soft: '#161F36', text: '#A9C1FF' },

        // slate/gray: o sistema usa essas escalas de forma "posicional" (900 = texto principal,
        // 50/100 = fundo sutil...) - invertida aqui pra virar dark mode. 400 = texto auxiliar
        // (muted), 500 = texto secundario.
        slate: {
          50: '#0B0C0E', 100: '#181B20', 200: '#262A31', 300: '#343945',
          400: '#7B8290', 500: '#A3A9B5', 600: '#BDC2CB', 700: '#D3D7DE',
          800: '#E5E7EC', 900: '#ECEEF2', 950: '#F7F8FA',
        },
        gray: {
          50: '#0B0C0E', 100: '#181B20', 200: '#262A31', 300: '#343945',
          400: '#7B8290', 500: '#A3A9B5', 600: '#BDC2CB', 700: '#D3D7DE',
          800: '#E5E7EC', 900: '#ECEEF2', 950: '#F7F8FA',
        },
      },
    },
  },
  plugins: [],
};
