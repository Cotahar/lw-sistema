const TOKEN_KEY = 'frotista_token';
const USUARIO_KEY = 'frotista_usuario';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUsuario() {
  const raw = localStorage.getItem(USUARIO_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function salvarSessao(token, usuario) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
}

export function limparSessao() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USUARIO_KEY);
}

// Nivel efetivo do usuario logado num modulo ('Nenhum'|'Visualizar'|'Gerenciar').
// Admin nao tem mapa de permissoes persistido (sempre Gerenciar).
export function nivelNoModulo(modulo) {
  const usuario = getUsuario();
  if (!usuario) return 'Nenhum';
  if (usuario.perfil === 'Admin') return 'Gerenciar';
  return (usuario.permissoes && usuario.permissoes[modulo]) || 'Nenhum';
}

export function podeVisualizar(modulo) {
  return nivelNoModulo(modulo) !== 'Nenhum';
}

export function podeGerenciar(modulo) {
  return nivelNoModulo(modulo) === 'Gerenciar';
}

export function ehAdmin() {
  const usuario = getUsuario();
  return Boolean(usuario && usuario.perfil === 'Admin');
}

class ApiError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Cliente HTTP fino sobre fetch: injeta o token, trata JSON/erro/204, e
// redireciona pro login em 401 (token expirado ou usuario desativado).
export async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    limparSessao();
    window.location.hash = '#/login';
    throw new ApiError(401, 'Sessao expirada. Faca login novamente.');
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const isText = contentType.includes('text/plain');
  const data = res.status === 204 ? null : isJson ? await res.json().catch(() => null) : isText ? await res.text() : null;

  if (!res.ok) {
    const mensagem = (data && data.erro) || `Erro ${res.status}`;
    throw new ApiError(res.status, mensagem);
  }
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body);
export const put = (path, body) => api('PUT', path, body);
export const patch = (path, body) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);
