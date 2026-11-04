// Deteccao de versao nova do sistema (fim do "precisa dar F5 depois do deploy").
//
// Os modulos ES ficam na memoria da aba: depois de um deploy, uma aba aberta antes continua rodando o
// JS antigo ate um reload de verdade - trocar de tela (hash) nao recarrega nada. O servidor manda em
// toda resposta da API o cabecalho X-App-Versao (hash do frontend, ver backend/src/utils/versaoApp.js);
// a primeira resposta define a versao desta aba e, quando uma resposta chega com outra:
//  - aparece um aviso com o botao "Atualizar agora";
//  - na PROXIMA troca de tela o router recarrega sozinho (ver router.js) - quem saiu da tela ja
//    abandonou o que estava nela, entao nada digitado se perde. Nunca recarrega no meio de um formulario.
let versaoDaAba = null;
let novaVersao = false;

export function registrarVersaoDoServidor(versao) {
  if (!versao) return;
  if (versaoDaAba === null) { versaoDaAba = versao; return; }
  if (versao !== versaoDaAba && !novaVersao) {
    novaVersao = true;
    mostrarAviso();
  }
}

export function haNovaVersao() {
  return novaVersao;
}

// Estilo inline de proposito: o aviso precisa aparecer em qualquer tela (login, app do motorista,
// impressao) e nao depender de classe Tailwind que talvez nem esteja no output.css antigo em cache.
function mostrarAviso() {
  if (document.querySelector('[data-aviso-versao]')) return;
  const aviso = document.createElement('div');
  aviso.dataset.avisoVersao = '';
  aviso.setAttribute('role', 'status');
  aviso.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;'
    + 'max-width:calc(100vw - 32px);padding:10px 14px;border:1px solid #F5B800;border-radius:10px;background:#181B20;color:#fff;font:500 14px/1.3 system-ui,sans-serif;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.25)';
  aviso.innerHTML = '<span>Saiu uma versao nova do Frottex. Ela entra sozinha quando voce trocar de tela.</span>';
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = 'Atualizar agora';
  botao.style.cssText = 'flex-shrink:0;padding:6px 10px;border:0;border-radius:8px;background:#F5B800;color:#181B20;font-weight:700;cursor:pointer';
  botao.addEventListener('click', () => window.location.reload());
  aviso.appendChild(botao);
  document.body.appendChild(aviso);
}
