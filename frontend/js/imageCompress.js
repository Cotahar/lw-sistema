// Reduz uma foto (tipicamente varios MB direto do celular) para um tamanho
// razoavel antes de enviar - lado maximo 1600px e JPEG 80% por padrao, o
// suficiente pra manter legibilidade (checklist, comprovante de abastecimento)
// sem pesar no armazenamento/upload. Compartilhado entre checklist.js e o
// modulo do motorista.
export async function comprimirImagem(arquivo, ladoMaximo = 1600, qualidade = 0.8) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, largura, altura);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
}
