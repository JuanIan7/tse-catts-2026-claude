/**
 * TSE — TREINAMENTO SUCESSORES DE ÉLPIS
 * Simulador de abordagem técnica a tentativa de suicídio — CATTS 2026
 *
 * Codigo.gs — ponto de entrada do Web App/API, constantes globais e utilidades.
 */

// ============================================================
// CONFIGURAÇÃO — AJUSTE AQUI
// ============================================================

// E-mail do desenvolvedor/instrutor. Só este e-mail enxerga o Painel Admin.
var ADMIN_EMAIL = 'juanhanzi@gmail.com';

// Nome do modelo Gemini usado para gerar o tentante e as avaliações.
// Se este modelo parar de responder, confira os nomes disponíveis em
// https://ai.google.dev/gemini-api/docs/models e troque aqui.
var MODEL_NAME = 'gemini-3.6-flash';

// Tempo (em segundos) que uma sessão de simulação fica guardada em cache
// enquanto o aluno conversa com o tentante. 6 horas é o máximo do CacheService.
var DURACAO_SESSAO_SEGUNDOS = 6 * 60 * 60;

// ============================================================
// WEB APP
// ============================================================

function testarCloudTTS_() {
  var chave = PropertiesService.getScriptProperties().getProperty('TTS_API_KEY');
  var resp = UrlFetchApp.fetch('https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR&key=' + chave, { muteHttpExceptions: true });
  var json = JSON.parse(resp.getContentText());
  var nomes = (json.voices || []).map(function (v) { return v.name + ' | ' + v.ssmlGender + ' | naturalSampleRateHertz=' + v.naturalSampleRateHertz; });
  Logger.log('HTTP ' + resp.getResponseCode() + '\n' + nomes.join('\n'));
  return resp.getResponseCode();
}

// URL real e atual do TSE — front-end estático no GitHub Pages. O Apps
// Script só serve a API (doPost) hoje; a UI antiga servida por doGet aqui
// (Index.html/PaginaPrincipal.gs) é da época anterior à migração e ficou
// desatualizada (nunca ganhou o histórico de conversas, o cronômetro etc.),
// além de às vezes dar "Página não encontrada" pro próprio dono logado
// (bug de permissão do Drive nessa implantação antiga). Quem cair aqui
// (link antigo salvo) é redirecionado direto pro site de verdade.
var URL_FRONTEND_ATUAL_ = 'https://juanian7.github.io/tse-catts-2026/';

function doGet(e) {
  var html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="refresh" content="0; url=' + URL_FRONTEND_ATUAL_ + '">' +
    '<script>location.replace(' + JSON.stringify(URL_FRONTEND_ATUAL_) + ');</script>' +
    '</head><body>Redirecionando para o TSE… <a href="' + URL_FRONTEND_ATUAL_ + '">clique aqui se não for redirecionado automaticamente</a>.</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('TSE — Treinamento Sucessores de Élpis')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite dividir o HTML em partes com <?!= include('Nome'); ?> (só usado se houver arquivo Index.html separado) */
function include(nomeArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeArquivo).getContent();
}

// ============================================================
// API (doPost) — usada pelo front-end externo (GitHub Pages), que roda
// FORA do iframe do Apps Script e por isso consegue acessar o microfone.
// O front-end chama isto via fetch(), nunca via google.script.run.
// ============================================================

// Lista explícita de funções que o front-end externo pode chamar — qualquer
// nome fora desta lista é recusado (nunca expor funções arbitrárias do projeto).
var FUNCOES_EXPOSTAS_API_ = {
  entrar: entrar,
  registrarConsentimento: registrarConsentimento,
  obterContadorGlobal: obterContadorGlobal,
  obterMinhasTentativas: obterMinhasTentativas,
  obterRanking: obterRanking,
  listarCasosReais: listarCasosReais,
  adicionarCasoReal: adicionarCasoReal,
  removerCasoReal: removerCasoReal,
  iniciarCaso: iniciarCaso,
  enviarFala: enviarFala,
  enviarFalaAudio: enviarFalaAudio,
  registrarInterrupcao: registrarInterrupcao,
  avaliarSessao: avaliarSessao,
  pausarEObterResumo: pausarEObterResumo,
  retomarSessao: retomarSessao,
  liberarEmail: liberarEmail,
  removerLiberado: removerLiberado,
  listarLiberados: listarLiberados,
  sintetizarNarrador: sintetizarNarrador,
  sintetizarTentante: sintetizarTentante,
  listarTranscricoes: listarTranscricoes,
  obterTranscricao: obterTranscricao,
};

/**
 * API JSON simples do tipo {fn, args}. O corpo é enviado como texto puro
 * (Content-Type: text/plain) de propósito — isso evita que o navegador
 * dispare um preflight CORS (OPTIONS), que o Apps Script não sabe responder.
 */
function doPost(e) {
  var resposta;
  try {
    var corpo = JSON.parse(e.postData.contents);
    var fn = FUNCOES_EXPOSTAS_API_[corpo.fn];
    if (!fn) throw new Error('Função não permitida: ' + corpo.fn);
    var resultado = fn.apply(null, corpo.args || []);
    resposta = { ok: true, dados: resultado };
  } catch (erro) {
    resposta = { ok: false, erro: String((erro && erro.message) || erro) };
  }
  return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// UTILIDADES
// ============================================================

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function agoraISO_() {
  return new Date().toISOString();
}

function gerarId_() {
  return Utilities.getUuid();
}

function ehAdmin_(email) {
  return normalizarEmail_(email) === normalizarEmail_(ADMIN_EMAIL);
}

/** Usada pelo template Index.html para exibir o e-mail de contato do instrutor. */
function obterEmailAdminPublico_() {
  return ADMIN_EMAIL;
}

/**
 * Cadastro inicial de alunos liberados. Rode esta função UMA VEZ pelo editor
 * do Apps Script (selecione "seedLiberadosIniciais" no menu de funções e
 * clique em "Executar"). Alunos liberados depois disso: use o Painel do
 * Instrutor dentro do próprio app — não precisa mexer aqui de novo.
 */
function seedLiberadosIniciais() {
  var emails = [
    'loureirocbmerj7@gmail.com',
    'revieirarj@gmail.com',
    'demoraes_fav@hotmail.com',
    'brendacfontes@gmail.com',
    'mattoscbmerj@gmail.com',
    'asp.matheusf@gmail.com',
  ];
  var adicionados = [];
  emails.forEach(function (email) {
    email = normalizarEmail_(email);
    if (!estaLiberado_(email)) {
      adicionarLinha_(ABA_LIBERADOS, {
        Email: email,
        DataLiberacao: agoraISO_(),
        LiberadoPor: ADMIN_EMAIL + ' (cadastro inicial)',
        Observacao: 'Liberado no cadastro inicial do TPE',
      });
      adicionados.push(email);
    }
  });
  Logger.log('Liberados agora: ' + adicionados.join(', ') || 'nenhum novo (já estavam liberados)');
  return adicionados;
}
/**
 * Planilha.gs — toda a leitura/escrita na Planilha Google que serve de
 * banco de dados do TPE. Este é um projeto de Apps Script INDEPENDENTE
 * (criado em script.new), não vinculado à planilha — por isso conectamos
 * pelo ID da planilha (SPREADSHEET_ID abaixo), em vez de depender de
 * "planilha ativa".
 *
 * Abas usadas (criadas automaticamente na primeira execução, se não existirem):
 *   Liberados   — e-mails autorizados pelo instrutor
 *   Usuarios    — alunos que já entraram (perfil + consentimento + estatísticas)
 *   Tentativas  — histórico de cada abordagem avaliada
 *   CasosReais  — anotações internas do instrutor (só ele lê/escreve)
 */

var SPREADSHEET_ID = '1oBZXjitvhF-aaf2a4QFMdYewrwYQ4_XHhuL0jlMcRsU';

var ABA_LIBERADOS = 'Liberados';
var ABA_USUARIOS = 'Usuarios';
var ABA_TENTATIVAS = 'Tentativas';
var ABA_CASOS_REAIS = 'CasosReais';
var ABA_TRANSCRICOES = 'Transcricoes';

var CABECALHOS = {
  Liberados: ['Email', 'DataLiberacao', 'LiberadoPor', 'Observacao'],
  Usuarios: ['Email', 'Nome', 'Matricula', 'DataConsentimento', 'TotalAbordagens', 'MelhorNota'],
  Tentativas: [
    'ID', 'DataHora', 'Email', 'Nome', 'TipoTentante', 'Dificuldade',
    'Resultado', 'Nota', 'FatorPrincipal', 'Acertos', 'Ajustes',
  ],
  CasosReais: ['ID', 'DataHora', 'Titulo', 'Relato', 'LicaoResumida', 'Ativo'],
  // Histórico completo das conversas — só o instrutor (admin) acessa. Guarda
  // a ficha interna e o diálogo inteiro em JSON pra poder ser revisado depois.
  Transcricoes: [
    'ID', 'DataHora', 'Email', 'Nome', 'SessionId', 'TipoTentante', 'Dificuldade',
    'Resultado', 'Nota', 'FichaJson', 'HistoricoJson',
  ],
};

function planilha_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/** Retorna a aba, criando-a com cabeçalho se ainda não existir. */
function aba_(nome) {
  var ss = planilha_();
  var sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    sheet.appendRow(CABECALHOS[nome]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Lê todas as linhas de uma aba como lista de objetos {coluna: valor}. */
function lerLinhas_(nome) {
  var sheet = aba_(nome);
  var dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return [];
  var cabecalho = dados[0];
  var linhas = [];
  for (var i = 1; i < dados.length; i++) {
    var linha = {};
    for (var c = 0; c < cabecalho.length; c++) {
      linha[cabecalho[c]] = dados[i][c];
    }
    linha._linha = i + 1; // número real da linha na planilha (1-based)
    linhas.push(linha);
  }
  return linhas;
}

function adicionarLinha_(nome, objeto) {
  var sheet = aba_(nome);
  var cabecalho = CABECALHOS[nome];
  var linha = cabecalho.map(function (col) {
    return objeto[col] !== undefined ? objeto[col] : '';
  });
  sheet.appendRow(linha);
}

function atualizarLinha_(nome, numeroLinha, objeto) {
  var sheet = aba_(nome);
  var cabecalho = CABECALHOS[nome];
  cabecalho.forEach(function (col, idx) {
    if (objeto[col] !== undefined) {
      sheet.getRange(numeroLinha, idx + 1).setValue(objeto[col]);
    }
  });
}

// ============================================================
// LIBERADOS (allowlist controlada pelo instrutor)
// ============================================================

function estaLiberado_(email) {
  email = normalizarEmail_(email);
  if (ehAdmin_(email)) return true; // o admin sempre entra
  var liberados = lerLinhas_(ABA_LIBERADOS);
  return liberados.some(function (l) { return normalizarEmail_(l.Email) === email; });
}

/** Chamada pelo painel admin. Verifica a permissão do próprio admin antes de liberar alguém. */
function liberarEmail(emailAdmin, novoEmail, observacao) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  novoEmail = normalizarEmail_(novoEmail);
  if (!novoEmail) throw new Error('E-mail inválido.');
  if (estaLiberado_(novoEmail)) return listarLiberados(emailAdmin);
  adicionarLinha_(ABA_LIBERADOS, {
    Email: novoEmail,
    DataLiberacao: agoraISO_(),
    LiberadoPor: emailAdmin,
    Observacao: observacao || '',
  });
  return listarLiberados(emailAdmin);
}

function removerLiberado(emailAdmin, emailRemover) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  emailRemover = normalizarEmail_(emailRemover);
  var sheet = aba_(ABA_LIBERADOS);
  var linhas = lerLinhas_(ABA_LIBERADOS);
  linhas.forEach(function (l) {
    if (normalizarEmail_(l.Email) === emailRemover) sheet.deleteRow(l._linha);
  });
  return listarLiberados(emailAdmin);
}

function listarLiberados(emailAdmin) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  return lerLinhas_(ABA_LIBERADOS).map(function (l) {
    return { email: l.Email, dataLiberacao: l.DataLiberacao, liberadoPor: l.LiberadoPor, observacao: l.Observacao };
  });
}

// ============================================================
// USUÁRIOS
// ============================================================

function buscarUsuario_(email) {
  email = normalizarEmail_(email);
  var linhas = lerLinhas_(ABA_USUARIOS);
  for (var i = 0; i < linhas.length; i++) {
    if (normalizarEmail_(linhas[i].Email) === email) return linhas[i];
  }
  return null;
}

/**
 * Login: verifica liberação, cria/atualiza o usuário, e informa se falta
 * aceitar o termo de consentimento.
 */
function entrar(email, nome, matricula) {
  email = normalizarEmail_(email);
  if (!email) throw new Error('Informe um e-mail válido.');
  if (!estaLiberado_(email)) {
    return { liberado: false, admin: false };
  }
  var usuario = buscarUsuario_(email);
  if (!usuario) {
    adicionarLinha_(ABA_USUARIOS, {
      Email: email,
      Nome: nome || '',
      Matricula: matricula || '',
      DataConsentimento: '',
      TotalAbordagens: 0,
      MelhorNota: '',
    });
    usuario = buscarUsuario_(email);
  } else if (nome || matricula) {
    atualizarLinha_(ABA_USUARIOS, usuario._linha, {
      Nome: nome || usuario.Nome,
      Matricula: matricula || usuario.Matricula,
    });
    usuario = buscarUsuario_(email);
  }
  return {
    liberado: true,
    admin: ehAdmin_(email),
    precisaConsentimento: !usuario.DataConsentimento,
    nome: usuario.Nome,
    matricula: usuario.Matricula,
    totalAbordagens: usuario.TotalAbordagens || 0,
    melhorNota: usuario.MelhorNota || '',
  };
}

function registrarConsentimento(email) {
  var usuario = buscarUsuario_(email);
  if (!usuario) throw new Error('Usuário não encontrado.');
  atualizarLinha_(ABA_USUARIOS, usuario._linha, { DataConsentimento: agoraISO_() });
  return true;
}

function registrarTentativaDoUsuario_(email, nota) {
  var usuario = buscarUsuario_(email);
  if (!usuario) return;
  var total = (usuario.TotalAbordagens || 0) + 1;
  var melhor = usuario.MelhorNota;
  if (typeof nota === 'number' && (melhor === '' || nota > melhor)) melhor = nota;
  atualizarLinha_(ABA_USUARIOS, usuario._linha, { TotalAbordagens: total, MelhorNota: melhor });
}

// ============================================================
// TENTATIVAS (histórico + ranking + contador global)
// ============================================================

function registrarTentativa_(dados) {
  adicionarLinha_(ABA_TENTATIVAS, {
    ID: gerarId_(),
    DataHora: agoraISO_(),
    Email: dados.email,
    Nome: dados.nome,
    TipoTentante: dados.tipoTentante,
    Dificuldade: dados.dificuldade,
    Resultado: dados.resultado,
    Nota: dados.nota,
    FatorPrincipal: dados.fatorPrincipal || '',
    Acertos: (dados.acertos || []).join(' | '),
    Ajustes: (dados.ajustes || []).join(' | '),
  });
  registrarTentativaDoUsuario_(dados.email, dados.nota);
}

/**
 * Grava a conversa inteira de uma abordagem finalizada — histórico de uso
 * exclusivo do instrutor (painel admin), pra poder rever o que foi dito em
 * cada simulação, inclusive pra ajustar a doutrina com base no uso real.
 */
function registrarTranscricao_(dados) {
  adicionarLinha_(ABA_TRANSCRICOES, {
    ID: gerarId_(),
    DataHora: agoraISO_(),
    Email: dados.email,
    Nome: dados.nome,
    SessionId: dados.sessionId,
    TipoTentante: dados.tipoTentante,
    Dificuldade: dados.dificuldade,
    Resultado: dados.resultado,
    Nota: dados.nota,
    FichaJson: JSON.stringify(dados.ficha || {}),
    HistoricoJson: JSON.stringify(dados.historico || []),
  });
}

/** Lista as transcrições mais recentes (resumo, sem o diálogo inteiro) — só admin. */
function listarTranscricoes(emailAdmin, limite) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  limite = limite || 100;
  return lerLinhas_(ABA_TRANSCRICOES)
    .sort(function (a, b) { return new Date(b.DataHora) - new Date(a.DataHora); })
    .slice(0, limite)
    .map(function (t) {
      return {
        id: t.ID, dataHora: t.DataHora, email: t.Email, nome: t.Nome,
        tipoTentante: t.TipoTentante, dificuldade: t.Dificuldade,
        resultado: t.Resultado, nota: t.Nota,
      };
    });
}

/** Devolve uma transcrição completa (ficha + diálogo inteiro) — só admin. */
function obterTranscricao(emailAdmin, id) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  var linha = lerLinhas_(ABA_TRANSCRICOES).filter(function (t) { return t.ID === id; })[0];
  if (!linha) throw new Error('Transcrição não encontrada.');
  var ficha;
  var historico;
  try { ficha = JSON.parse(linha.FichaJson); } catch (e) { ficha = {}; }
  try { historico = JSON.parse(linha.HistoricoJson); } catch (e) { historico = []; }
  return {
    id: linha.ID, dataHora: linha.DataHora, email: linha.Email, nome: linha.Nome,
    tipoTentante: linha.TipoTentante, dificuldade: linha.Dificuldade,
    resultado: linha.Resultado, nota: linha.Nota, ficha: ficha, historico: historico,
  };
}

function obterContadorGlobal() {
  return lerLinhas_(ABA_TENTATIVAS).length;
}

function obterMinhasTentativas(email) {
  email = normalizarEmail_(email);
  return lerLinhas_(ABA_TENTATIVAS)
    .filter(function (t) { return normalizarEmail_(t.Email) === email; })
    .sort(function (a, b) { return new Date(b.DataHora) - new Date(a.DataHora); })
    .map(formatarTentativa_);
}

function formatarTentativa_(t) {
  return {
    dataHora: t.DataHora,
    nome: t.Nome,
    tipoTentante: t.TipoTentante,
    dificuldade: t.Dificuldade,
    resultado: t.Resultado,
    nota: t.Nota,
    fatorPrincipal: t.FatorPrincipal,
  };
}

/** tipo = 'geral' ou um dos tipos ('agressivo' | 'depressivo' | 'psicotico') */
function obterRanking(tipo) {
  var linhas = lerLinhas_(ABA_TENTATIVAS).filter(function (t) {
    return typeof t.Nota === 'number' && t.Nota !== '';
  });
  if (tipo && tipo !== 'geral') {
    linhas = linhas.filter(function (t) { return t.TipoTentante === tipo; });
  }
  // melhor nota por aluno
  var melhorPorAluno = {};
  linhas.forEach(function (t) {
    var email = normalizarEmail_(t.Email);
    if (!melhorPorAluno[email] || t.Nota > melhorPorAluno[email].Nota) {
      melhorPorAluno[email] = t;
    }
  });
  return Object.keys(melhorPorAluno)
    .map(function (email) {
      var t = melhorPorAluno[email];
      return { nome: t.Nome || t.Email, tipoTentante: t.TipoTentante, nota: t.Nota, dataHora: t.DataHora };
    })
    .sort(function (a, b) { return b.nota - a.nota; })
    .slice(0, 50);
}

// ============================================================
// CASOS REAIS (uso exclusivo do instrutor/desenvolvedor)
// ============================================================

function listarCasosReais(emailAdmin) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  return lerLinhas_(ABA_CASOS_REAIS)
    .sort(function (a, b) { return new Date(b.DataHora) - new Date(a.DataHora); })
    .map(function (c) {
      return { id: c.ID, dataHora: c.DataHora, titulo: c.Titulo, relato: c.Relato, licaoResumida: c.LicaoResumida, ativo: c.Ativo === true || c.Ativo === 'TRUE' };
    });
}

function adicionarCasoReal(emailAdmin, dados) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  adicionarLinha_(ABA_CASOS_REAIS, {
    ID: gerarId_(),
    DataHora: agoraISO_(),
    Titulo: dados.titulo || '',
    Relato: dados.relato || '',
    LicaoResumida: dados.licaoResumida || '',
    Ativo: dados.ativo ? true : false,
  });
  return listarCasosReais(emailAdmin);
}

function removerCasoReal(emailAdmin, id) {
  if (!ehAdmin_(emailAdmin)) throw new Error('Sem permissão.');
  var sheet = aba_(ABA_CASOS_REAIS);
  var linhas = lerLinhas_(ABA_CASOS_REAIS);
  linhas.forEach(function (c) {
    if (c.ID === id) sheet.deleteRow(c._linha);
  });
  return listarCasosReais(emailAdmin);
}

/** Lições resumidas ativas, para enriquecer o prompt da IA (nunca o relato bruto). */
function obterLicoesAtivas_() {
  return lerLinhas_(ABA_CASOS_REAIS)
    .filter(function (c) { return (c.Ativo === true || c.Ativo === 'TRUE') && c.LicaoResumida; })
    .map(function (c) { return c.LicaoResumida; })
    .slice(-8); // no máximo as 8 lições mais recentes, para não inflar o prompt
}
/**
 * IA.gs — chamadas ao Gemini (Google AI). A chave fica em
 * PropertiesService (nunca é enviada ao navegador do aluno).
 *
 * Configuração necessária (uma vez só, feita pelo instrutor):
 *   Apps Script > Configurações do projeto > Propriedades do script
 *   > Adicionar propriedade: GEMINI_API_KEY = <sua chave de aistudio.google.com/apikey>
 */

function obterChaveGemini_() {
  var chave = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!chave) {
    throw new Error(
      'GEMINI_API_KEY não configurada. Vá em Configurações do projeto > ' +
      'Propriedades do script e adicione GEMINI_API_KEY com sua chave do Google AI Studio.'
    );
  }
  return chave;
}

/**
 * Chama o Gemini pedindo APENAS texto (usado para a fala do personagem).
 * @param {string} instrucaoSistema texto fixo de regras/persona
 * @param {Array<{papel:'user'|'model', texto:string}>} turnos histórico da conversa
 * @return {string} resposta em texto puro
 */
function chamarGeminiTexto_(instrucaoSistema, turnos) {
  var resposta = chamarGeminiBruto_(instrucaoSistema, turnos, false);
  return extrairTexto_(resposta);
}

/**
 * Chama o Gemini pedindo um JSON estruturado (usado para gerar o caso e a avaliação).
 * @return {Object} objeto já parseado
 */
function chamarGeminiJson_(instrucaoSistema, turnos) {
  var resposta = chamarGeminiBruto_(instrucaoSistema, turnos, true);
  var texto = extrairTexto_(resposta);
  return extrairJson_(texto);
}

function chamarGeminiBruto_(instrucaoSistema, turnos, pedirJson) {
  var contents = turnos.map(function (t) {
    return { role: t.papel, parts: [{ text: t.texto }] };
  });
  return executarChamadaGemini_(montarPayloadGemini_(instrucaoSistema, contents, pedirJson));
}

/**
 * Chama o Gemini com um ÁUDIO como última fala do usuário (transcreve + responde em
 * um só JSON). Usado quando o aluno grava a fala em vez de digitar.
 * @return {Object} objeto já parseado, ex.: {transcricaoAluno, fala, status}
 */
function chamarGeminiAudioJson_(instrucaoSistema, turnosAnteriores, mimeType, base64Audio) {
  var contents = turnosAnteriores.map(function (t) {
    return { role: t.papel, parts: [{ text: t.texto }] };
  });
  contents.push({ role: 'user', parts: [{ inlineData: { mimeType: mimeType, data: base64Audio } }] });
  var resposta = executarChamadaGemini_(montarPayloadGemini_(instrucaoSistema, contents, true));
  var texto = extrairTexto_(resposta);
  return extrairJson_(texto);
}

function montarPayloadGemini_(instrucaoSistema, contents, pedirJson) {
  var payload = {
    systemInstruction: { parts: [{ text: instrucaoSistema }] },
    contents: contents,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 8192,
    },
  };
  if (pedirJson) {
    payload.generationConfig.responseMimeType = 'application/json';
  }
  return payload;
}

function executarChamadaGemini_(payload) {
  var chave = obterChaveGemini_();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    MODEL_NAME + ':generateContent?key=' + chave;

  var opcoes = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var tentativas = 0;
  while (true) {
    tentativas++;
    var resp = UrlFetchApp.fetch(url, opcoes);
    var codigo = resp.getResponseCode();
    if (codigo === 200) {
      return JSON.parse(resp.getContentText());
    }
    var corpo = resp.getContentText();
    if (codigo === 429 && tentativas < 3) {
      // Limite de cota (ex: free tier = 20 req/min) — espera o tempo que o
      // próprio Gemini pediu (campo retryDelay ou "retry in Xs" na mensagem).
      Utilities.sleep(obterEsperaRetry_(corpo));
      continue;
    }
    if (codigo >= 500 && tentativas < 4) {
      // Erros 503 costumam ser sobrecarga temporária do modelo — espera crescente ajuda.
      Utilities.sleep(1500 * tentativas);
      continue;
    }
    throw new Error('Erro ao chamar o Gemini (HTTP ' + codigo + '): ' + corpo);
  }
}

/** Lê quanto o Gemini pediu para esperar antes de tentar de novo (429), com um piso/teto sensatos. */
function obterEsperaRetry_(corpoResposta) {
  var segundos = 15;
  try {
    var json = JSON.parse(corpoResposta);
    var detalhes = (json.error && json.error.details) || [];
    var retryInfo = detalhes.filter(function (d) { return d.retryDelay; })[0];
    if (retryInfo && retryInfo.retryDelay) {
      segundos = parseFloat(retryInfo.retryDelay) || segundos;
    } else {
      var m = /retry in ([\d.]+)s/i.exec((json.error && json.error.message) || '');
      if (m) segundos = parseFloat(m[1]);
    }
  } catch (e) { /* usa o padrão */ }
  segundos = Math.max(5, Math.min(segundos + 2, 55)); // +2s de folga, teto de 55s
  return segundos * 1000;
}

function extrairTexto_(respostaGemini) {
  try {
    var partes = respostaGemini.candidates[0].content.parts;
    return partes.map(function (p) { return p.text || ''; }).join('').trim();
  } catch (e) {
    throw new Error('Resposta inesperada do Gemini: ' + JSON.stringify(respostaGemini).slice(0, 500));
  }
}

// ============================================================
// IMAGEM DE CENA (ilustração inicial do local + silhueta do tentante)
// ============================================================

// Se este modelo parar de gerar imagens no futuro, troque aqui por um nome
// válido em https://ai.google.dev/gemini-api/docs/models (procure por
// modelos com saída de imagem).
var MODEL_NAME_IMAGEM = 'gemini-3-pro-image';

/**
 * Chamada bruta ao modelo de imagem — usada tanto pela cena quanto pelo retrato do
 * personagem. Tem retry com backoff pra 429/5xx igual à chamada de texto
 * (executarChamadaGemini_) — sem isso, um limite de taxa momentâneo (bem provável
 * quando duas imagens são geradas por caso) matava a imagem em silêncio, sem
 * nenhum erro visível, e normalmente a SEGUNDA chamada da dupla (o retrato) era a
 * mais afetada por vir depois na mesma rajada de pedidos.
 */
function chamarGeminiImagem_(prompt) {
  var chave = obterChaveGemini_();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    MODEL_NAME_IMAGEM + ':generateContent?key=' + chave;
  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  var opcoes = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var resp, tentativas = 0;
  while (true) {
    tentativas++;
    resp = UrlFetchApp.fetch(url, opcoes);
    var codigo = resp.getResponseCode();
    if (codigo === 200) break;
    if (codigo === 429 && tentativas < 3) { Utilities.sleep(obterEsperaRetry_(resp.getContentText())); continue; }
    if (codigo >= 500 && tentativas < 4) { Utilities.sleep(1500 * tentativas); continue; }
    Logger.log('chamarGeminiImagem_ falhou (HTTP ' + codigo + '): ' + resp.getContentText().slice(0, 300));
    return null;
  }

  var json = JSON.parse(resp.getContentText());
  var partes = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
  if (!partes) return null;
  var imgParte = partes.filter(function (p) { return p.inlineData && p.inlineData.data; })[0];
  if (!imgParte) return null;
  return 'data:' + (imgParte.inlineData.mimeType || 'image/png') + ';base64,' + imgParte.inlineData.data;
}

var DESCRICAO_IDADE_IMAGEM_ = { jovem_adulto: 'jovem adulta (entre 20 e 29 anos)', adulto: 'adulta (entre 30 e 45 anos)', meia_idade: 'de meia-idade (entre 46 e 60 anos)', idoso: 'idosa (acima de 60 anos)' };
var DESCRICAO_RACA_IMAGEM_ = { branca: 'branca', preta: 'negra, de pele retinta', parda: 'parda, mestiça', indigena: 'indígena brasileira, traços indígenas', amarela: 'de ascendência asiática' };

// Detalhe visual discreto do ambiente, específico do método sorteado (nunca o
// ato em si, só um objeto/posicionamento coerente com a leitura operacional de
// cena que a guarnição já recebe em texto — ver TIPOS_TENTATIVA).
var DETALHE_VISUAL_TENTATIVA_ = {
  enforcamento: 'ao fundo, discreta, uma corda ou um cinto amarrado numa estrutura fixa do ambiente (viga, grade, parte alta) — nunca mostre a pessoa presa a ela, só o objeto amarrado',
  precipitacao: 'o personagem está posicionado próximo a uma borda/beirada elevada do ambiente, com a queda visível ao fundo — nunca em pose de salto ou desequilíbrio',
  intoxicacao_exogena: 'vários comprimidos soltos e cartelas de remédio vazias, visíveis sobre uma superfície próxima ao personagem (mesa, criado-mudo, chão)',
  arma_branca: 'uma faca ou objeto cortante visível, pousado sobre uma superfície próxima ao personagem — nunca empunhado, nunca em riste',
  autoimolacao_explosao: 'um botijão de gás visível no ambiente, próximo ao personagem',
};

/**
 * Gera UMA ÚNICA imagem combinando personagem (rosto visível, em foco, centralizado)
 * e ambiente (reconhecível atrás dele) — substitui as duas chamadas separadas que
 * existiam antes (uma imagem de cena + um retrato), cortando pela metade o custo de
 * geração de imagem por ocorrência. Inclui o detalhe visual do método sorteado
 * (DETALHE_VISUAL_TENTATIVA_), sempre sem mostrar o ato em si. Falha em silêncio
 * (retorna null) — a imagem é só um complemento visual opcional, nunca pode travar
 * o início do caso.
 */
function gerarImagemCombinada_(genero, faixaEtaria, racaCor, localDescricao, tipoTentativaValor) {
  try {
    // "pessoa" é sempre gramaticalmente feminino em português (independe do
    // gênero da pessoa descrita) — por isso idade/raça sempre concordam no
    // feminino aqui. O gênero de verdade só entra explicitamente com "um
    // homem"/"uma mulher" + "brasileiro"/"brasileira" concordando entre si.
    var ehFeminino = genero === 'feminino';
    var generoTexto = ehFeminino ? 'uma mulher' : 'um homem';
    var brasileiroTexto = ehFeminino ? 'brasileira' : 'brasileiro';
    var idadeTexto = DESCRICAO_IDADE_IMAGEM_[faixaEtaria] || 'adulta';
    var racaTexto = DESCRICAO_RACA_IMAGEM_[racaCor] || 'brasileira';
    var detalheMetodo = DETALHE_VISUAL_TENTATIVA_[tipoTentativaValor] || '';

    var prompt =
      'Fotografia fotorrealista (câmera profissional, iluminação naturalista, nada de ilustração/pintura/desenho), ' +
      'para ambientar um treinamento FICTÍCIO de bombeiros em comunicação de crise. Retrato de ' + generoTexto + ' ' +
      brasileiroTexto + ': uma pessoa ' + idadeTexto + ', ' + racaTexto + ', em plano meio-corpo, CENTRALIZADA e EM ' +
      'FOCO NÍTIDO no enquadramento, rosto claramente visível. Atrás dela, com boa profundidade de campo (o ' +
      'ambiente reconhecível, não apenas borrado ao ponto de sumir), o cenário: ' + localDescricao + '. ' +
      (detalheMetodo ? 'No ambiente, ' + detalheMetodo + '. ' : '') +
      'Roupas condizentes com estar realmente nesse local e situação (dia a dia, informais, nada de uniforme nem ' +
      'traje formal). Expressão facial neutra a cansada/abatida, olhar levemente distante, mas SEM chorar, sem ' +
      'ferimentos, sem sangue, sem qualquer sinal de violência ou autolesão visível no corpo dela. Mãos visíveis e ' +
      'vazias — NUNCA segurando objetos (comprimidos, lâminas, cordas, armas ou qualquer meio letal), NUNCA em ' +
      'pose de queda/salto/enforcamento. Objetivo: imagem humana digna e realista para treinamento FICTÍCIO de ' +
      'comunicação de crise de bombeiros — nunca sensacionalista, nunca ilustrando o ato em si, só ambientando a ' +
      'cena e o personagem juntos numa única imagem coerente. Sem texto ou letreiro na imagem.';

    return chamarGeminiImagem_(prompt);
  } catch (e) {
    Logger.log('gerarImagemCombinada_ exceção: ' + e.message);
    return null;
  }
}

// ============================================================
// VARIEDADE DO CASO — nome, local, raça/cor e orientação sexual são
// sorteados AQUI NO CÓDIGO (nunca pela IA), porque um modelo de linguagem
// pedido para "inventar" repete os mesmos poucos nomes/locais com muito mais
// frequência do que um sorteio de verdade. A IA só recebe o resultado do
// sorteio como um dado obrigatório do caso.
// ============================================================

/** Lista de tipos de local — cobre alturas urbanas, alturas naturais, água e ambientes internos. */
var LOCAIS_CENA = [
  { tipo: 'ponte', descricaoParaIntroducao: 'uma ponte urbana sobre um rio ou baía', descricaoParaImagem: 'uma ponte urbana elevada sobre um grande rio ou baía, ao entardecer, vista de longe' },
  { tipo: 'viaduto', descricaoParaIntroducao: 'um viaduto sobre uma via expressa movimentada', descricaoParaImagem: 'um viaduto sobre uma via expressa movimentada, à noite, com luzes de carros desfocadas ao fundo' },
  { tipo: 'passarela', descricaoParaIntroducao: 'uma passarela de pedestres sobre uma rodovia', descricaoParaImagem: 'uma passarela de pedestres de concreto sobre uma rodovia movimentada, luz do meio-dia' },
  { tipo: 'quarto_medicamentos', descricaoParaIntroducao: 'um quarto residencial simples, com medicamentos sobre o criado-mudo', descricaoParaImagem: 'um quarto residencial simples e modesto, levemente desarrumado, com uma mesinha de cabeceira ao fundo' },
  { tipo: 'banheiro_trancado', descricaoParaIntroducao: 'um banheiro residencial com a porta trancada por dentro', descricaoParaImagem: 'um banheiro residencial simples, porta fechada, luz fria de lâmpada fluorescente' },
  { tipo: 'garagem_fechada', descricaoParaIntroducao: 'uma garagem residencial fechada, com um carro ligado', descricaoParaImagem: 'uma garagem residencial fechada e mal iluminada, com um carro estacionado' },
  { tipo: 'terraco_predio', descricaoParaIntroducao: 'o terraço de um prédio residencial alto', descricaoParaImagem: 'o terraço de um prédio residencial alto, vista da cidade ao fundo, fim de tarde' },
  { tipo: 'terraco_comercial', descricaoParaIntroducao: 'o terraço de um edifício comercial no centro da cidade', descricaoParaImagem: 'o terraço de um edifício comercial alto, com outros prédios do centro da cidade ao fundo, meio da tarde' },
  { tipo: 'sacada_apartamento', descricaoParaIntroducao: 'a sacada de um apartamento em andar alto', descricaoParaImagem: 'a sacada estreita de um apartamento em andar alto, roupa estendida ao lado, vista da rua lá embaixo' },
  { tipo: 'laje_casa', descricaoParaIntroducao: 'a laje descoberta de uma casa em bairro popular', descricaoParaImagem: 'a laje descoberta de uma casa simples em bairro popular, caixa d\'água e varal ao fundo, luz de fim de tarde' },
  { tipo: 'galpao_industrial', descricaoParaIntroducao: 'o telhado de um galpão industrial desativado', descricaoParaImagem: 'o telhado de um galpão industrial antigo e desativado, estrutura metálica enferrujada, céu nublado' },
  { tipo: 'torre_igreja', descricaoParaIntroducao: 'a torre/campanário de uma igreja antiga', descricaoParaImagem: 'a torre de uma igreja antiga de bairro, sino visível ao fundo, entardecer' },
  { tipo: 'caixa_dagua', descricaoParaIntroducao: 'o topo de uma caixa d\'água elevada em bairro residencial', descricaoParaImagem: 'uma caixa d\'água elevada de bairro residencial, estrutura metálica alta, céu claro' },
  { tipo: 'guindaste_obra', descricaoParaIntroducao: 'a estrutura de um guindaste em um canteiro de obras', descricaoParaImagem: 'um canteiro de obras à noite, guindaste alto iluminado por refletores, prédio em construção ao fundo' },
  { tipo: 'estacionamento_alto', descricaoParaIntroducao: 'o andar mais alto de um estacionamento de shopping', descricaoParaImagem: 'o último andar aberto de um estacionamento de shopping, vagas vazias, luz de fim de tarde' },
  { tipo: 'praia_costao', descricaoParaIntroducao: 'um costão rochoso à beira-mar', descricaoParaImagem: 'um costão rochoso à beira-mar, céu nublado, mar agitado ao fundo' },
  { tipo: 'penhasco_trilha', descricaoParaIntroducao: 'um mirante natural no alto de uma trilha de morro', descricaoParaImagem: 'um mirante natural rochoso no alto de um morro com trilha, vegetação nativa ao redor, manhã nublada' },
  { tipo: 'cachoeira', descricaoParaIntroducao: 'o topo de uma cachoeira em uma reserva florestal', descricaoParaImagem: 'o topo de uma cachoeira cercada de mata fechada, pedras molhadas, luz difusa de manhã' },
  { tipo: 'mirante_publico', descricaoParaIntroducao: 'um mirante urbano elevado e aberto ao público', descricaoParaImagem: 'um mirante urbano elevado, aberto, ao entardecer, silhueta da cidade ao fundo' },
  { tipo: 'margem_rio', descricaoParaIntroducao: 'a margem de um rio de correnteza forte, próximo a uma ponte', descricaoParaImagem: 'a margem de um rio de águas turvas e correnteza forte, vegetação às margens, dia nublado' },
  { tipo: 'beira_represa', descricaoParaIntroducao: 'a beira de uma represa isolada na zona rural', descricaoParaImagem: 'a beira de uma represa grande e isolada, água parada, vegetação rasteira, fim de tarde' },
  { tipo: 'cais_porto', descricaoParaIntroducao: 'um cais de porto industrial pouco movimentado', descricaoParaImagem: 'um cais de porto industrial, contêineres desfocados ao fundo, água escura, noite com poucas luzes' },
  { tipo: 'plataforma_trem', descricaoParaIntroducao: 'a extremidade de uma plataforma de trem/metrô fora do horário de pico', descricaoParaImagem: 'a extremidade vazia de uma plataforma de trem urbano, trilhos visíveis, luz artificial de estação' },
];

function sortearLocalCena_() {
  return LOCAIS_CENA[Math.floor(Math.random() * LOCAIS_CENA.length)];
}

// Tipos de TENTATIVA (método) — diferente de TIPOS_TENTANTE (perfil
// comportamental). Dá pistas operacionais REAIS pra introdução do caso (EPI,
// cuidado de cena), sempre sem descrever o método de forma gráfica (ver
// REGRAS DE SEGURANÇA em instrucaoDoutrina_, Simulacao.gs). "arma de fogo"
// NUNCA entra nesta lista de propósito: abordagem armada é atribuição da
// Polícia Militar, não do CBMERJ — este simulador não gera esse cenário.
// Pesos refletem a predominância real do enforcamento nas estatísticas
// brasileiras de tentativa/óbito por suicídio (Boletim Epidemiológico do
// Min. da Saúde) — os outros métodos aparecem com menor frequência, na
// mesma ordem de grandeza observada nos dados.
var TIPOS_TENTATIVA = [
  { valor: 'enforcamento', peso: 40,
    descricaoOperacional: 'sinais de que a pessoa pode estar prestes a usar uma corda, cinto, lençol ou amarra na estrutura do local — sem nunca descrever a cena de forma gráfica' },
  { valor: 'precipitacao', peso: 25,
    descricaoOperacional: 'a pessoa está posicionada na borda/beirada do local, em risco iminente de queda — exige distância e abordagem gradual, atenção redobrada a qualquer movimento brusco' },
  { valor: 'intoxicacao_exogena', peso: 15,
    descricaoOperacional: 'cartelas de medicamento vazias ou frascos por perto — atenção a sinais de já ter ingerido algo (fala arrastada, sonolência, confusão), pode exigir atendimento médico urgente em paralelo à abordagem' },
  { valor: 'arma_branca', peso: 12,
    descricaoOperacional: 'a pessoa porta um objeto cortante/perfurante — a guarnição deve manter distância de segurança e considerar o uso de EPI de proteção (equivalente ao usado em ocorrências de incêndio) até a cena estar controlada' },
  { valor: 'autoimolacao_explosao', peso: 8,
    descricaoOperacional: 'indícios de material inflamável ou vazamento de gás no ambiente (ex.: botijão de gás, forte cheiro de combustível) — cena de risco de incêndio/explosão, isolamento rígido e possível apoio de viatura de incêndio' },
];

function sortearTipoTentativa_() {
  return sortearPonderado_(TIPOS_TENTATIVA.map(function (t) { return { valor: t, peso: t.peso }; }));
}

// Nomes variados de propósito — classes sociais, regiões e gerações diferentes,
// para nunca cair sempre nos mesmos 2-3 nomes "óbvios" que uma IA tende a repetir.
var NOMES_MASCULINOS_ = [
  'Marcos', 'João', 'Pedro', 'Rafael', 'Bruno', 'Diego', 'Thiago', 'Vinícius', 'Gabriel', 'Matheus',
  'André', 'Felipe', 'Rodrigo', 'Eduardo', 'Fernando', 'Alexandre', 'Anderson', 'Wesley', 'Jefferson',
  'Robson', 'Elias', 'Cláudio', 'Sérgio', 'Osvaldo', 'Antônio', 'Ademir', 'Wallace', 'Kauã', 'Heitor',
  'Davi', 'Samuel', 'Renato', 'Leandro', 'Everton', 'Jorge', 'Nilton', 'Adilson', 'Geraldo', 'Vagner',
  'Cícero', 'Deivid', 'Luan', 'Erivelton', 'Josué', 'Reginaldo', 'Wanderley', 'Ivanildo',
];
var NOMES_FEMININOS_ = [
  'Maria', 'Ana', 'Juliana', 'Camila', 'Fernanda', 'Patrícia', 'Aline', 'Bruna', 'Larissa', 'Débora',
  'Vanessa', 'Simone', 'Rosana', 'Cleusa', 'Ivone', 'Neide', 'Conceição', 'Aparecida', 'Jaqueline',
  'Michele', 'Tainá', 'Yasmin', 'Letícia', 'Sabrina', 'Priscila', 'Eliane', 'Rosimeire', 'Marlene',
  'Ester', 'Valquíria', 'Djanira', 'Francisca', 'Luzia', 'Iracema', 'Adriana', 'Vera', 'Solange',
  'Gislaine', 'Kelly', 'Elisângela', 'Rosangela', 'Marta', 'Zilda', 'Creuza', 'Dayane',
];

function sortearDe_(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

/** Sorteio ponderado: array de {valor, peso}. */
function sortearPonderado_(opcoes) {
  var total = opcoes.reduce(function (s, o) { return s + o.peso; }, 0);
  var alvo = Math.random() * total;
  var acumulado = 0;
  for (var i = 0; i < opcoes.length; i++) {
    acumulado += opcoes[i].peso;
    if (alvo <= acumulado) return opcoes[i].valor;
  }
  return opcoes[opcoes.length - 1].valor;
}

function sortearGenero_() {
  return sortearPonderado_([{ valor: 'masculino', peso: 55 }, { valor: 'feminino', peso: 45 }]);
}

function sortearFaixaEtaria_() {
  return sortearPonderado_([
    { valor: 'jovem_adulto', peso: 30 },
    { valor: 'adulto', peso: 30 },
    { valor: 'meia_idade', peso: 25 },
    { valor: 'idoso', peso: 15 },
  ]);
}

// Distribuição informada pelo Boletim Epidemiológico Saúde da População Negra
// (Min. da Saúde) e dados CATTS: maioria autodeclarada negra (preta+parda) entre
// os casos de suicídio no Brasil — refletido aqui sem tornar nenhum grupo raro.
function sortearRacaCor_() {
  return sortearPonderado_([
    { valor: 'parda', peso: 35 },
    { valor: 'branca', peso: 30 },
    { valor: 'preta', peso: 25 },
    { valor: 'indigena', peso: 5 },
    { valor: 'amarela', peso: 5 },
  ]);
}

// Deliberadamente sobrerrepresenta o público LGBTQIAPN+ em relação à proporção
// da população geral: pesquisas (ex. Delaware/EUA, estudos brasileiros com
// população trans) mostram taxa de ideação/tentativa de suicídio muito acima da
// média nesse público — o treinamento precisa preparar o aluno para essa
// realidade, não tratá-la como caso raro.
function sortearOrientacaoSexual_() {
  return sortearPonderado_([
    { valor: 'heterossexual', peso: 50 },
    { valor: 'homossexual', peso: 20 },
    { valor: 'bissexual', peso: 15 },
    { valor: 'pansexual', peso: 8 },
    { valor: 'assexual', peso: 7 },
  ]);
}

function sortearIdentidadeGenero_() {
  return sortearPonderado_([
    { valor: 'cisgenero', peso: 78 },
    { valor: 'transgenero', peso: 17 },
    { valor: 'nao-binario', peso: 5 },
  ]);
}

function sortearNome_(genero) {
  return sortearDe_(genero === 'feminino' ? NOMES_FEMININOS_ : NOMES_MASCULINOS_);
}

// ============================================================
// VOZ (Google Cloud Text-to-Speech — vozes "Chirp3-HD", muito mais naturais
// que a síntese de voz do navegador). Precisa da propriedade TTS_API_KEY
// (chave separada da do Gemini — ver INSTRUCOES_INSTALACAO.txt).
// Se a chamada falhar por qualquer motivo (chave não configurada, API não
// habilitada, etc.), retorna null e o front-end cai de volta na voz do
// navegador automaticamente — nunca trava a simulação.
// ============================================================

// Voz fixa do NARRADOR — sempre a mesma, nunca igual à voz de um tentante.
var VOZ_NARRADOR_GOOGLE = 'pt-BR-Chirp3-HD-Charon';

// Uma voz Chirp3-HD real e distinta para cada combinação gênero+faixa etária.
var VOZES_TENTANTE_GOOGLE = {
  masculino_jovem_adulto: 'pt-BR-Chirp3-HD-Puck',
  masculino_adulto: 'pt-BR-Chirp3-HD-Orus',
  masculino_meia_idade: 'pt-BR-Chirp3-HD-Fenrir',
  masculino_idoso: 'pt-BR-Chirp3-HD-Iapetus',
  feminino_jovem_adulto: 'pt-BR-Chirp3-HD-Aoede',
  feminino_adulto: 'pt-BR-Chirp3-HD-Kore',
  feminino_meia_idade: 'pt-BR-Chirp3-HD-Autonoe',
  feminino_idoso: 'pt-BR-Chirp3-HD-Vindemiatrix',
};

function obterChaveTTS_() {
  var chave = PropertiesService.getScriptProperties().getProperty('TTS_API_KEY');
  if (!chave) throw new Error('TTS_API_KEY não configurada.');
  return chave;
}

/** @return {string|null} áudio MP3 em base64, ou null se falhar (nunca lança erro). */
function chamarCloudTTS_(texto, vozGoogle, taxaFala) {
  try {
    var chave = obterChaveTTS_();
    var payload = {
      input: { text: texto },
      voice: { languageCode: 'pt-BR', name: vozGoogle },
      audioConfig: { audioEncoding: 'MP3', speakingRate: taxaFala || 1.0 },
    };
    var resp = UrlFetchApp.fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + chave, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('chamarCloudTTS_ falhou (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText().slice(0, 300));
      return null;
    }
    var json = JSON.parse(resp.getContentText());
    return json.audioContent || null; // já vem em base64 MP3
  } catch (e) {
    Logger.log('chamarCloudTTS_ exceção: ' + e.message);
    return null;
  }
}

/** Exposta ao front-end: narra o despacho/introdução com a voz fixa de narrador. */
function sintetizarNarrador(texto) {
  return chamarCloudTTS_(texto, VOZ_NARRADOR_GOOGLE, 0.95);
}

/** Exposta ao front-end: fala do personagem, com voz coerente com gênero/faixa etária. */
function sintetizarTentante(texto, genero, faixaEtaria) {
  var generoChave = genero === 'feminino' ? 'feminino' : 'masculino';
  var faixaChave = ['jovem_adulto', 'adulto', 'meia_idade', 'idoso'].indexOf(faixaEtaria) >= 0 ? faixaEtaria : 'adulto';
  var vozGoogle = VOZES_TENTANTE_GOOGLE[generoChave + '_' + faixaChave] || VOZES_TENTANTE_GOOGLE.masculino_adulto;
  var taxa = faixaChave === 'idoso' ? 0.9 : (faixaChave === 'jovem_adulto' ? 1.05 : 1.0);
  return chamarCloudTTS_(texto, vozGoogle, taxa);
}

/** Extrai o primeiro objeto/array JSON válido de um texto (tolerante a cercas de markdown). */
function extrairJson_(texto) {
  try {
    return JSON.parse(texto);
  } catch (e) {
    // tenta achar um bloco ```json ... ``` ou o primeiro {...}/[...]
    var match = texto.match(/```json([\s\S]*?)```/i) || texto.match(/```([\s\S]*?)```/);
    if (match) {
      try { return JSON.parse(match[1].trim()); } catch (e2) { /* segue tentando */ }
    }
    var inicio = Math.min.apply(null, [texto.indexOf('{'), texto.indexOf('[')].filter(function (i) { return i >= 0; }));
    var fimChave = texto.lastIndexOf('}');
    var fimColchete = texto.lastIndexOf(']');
    var fim = Math.max(fimChave, fimColchete);
    if (isFinite(inicio) && fim > inicio) {
      try { return JSON.parse(texto.slice(inicio, fim + 1)); } catch (e3) { /* desiste */ }
    }
    throw new Error('Não foi possível interpretar o JSON retornado pela IA: ' + texto.slice(0, 500));
  }
}
/**
 * Avaliacao.gs — cálculo da nota oficial (Ficha de Avaliação de Abordagem
 * CATTS I/2026, CBMERJ/CIEB). A IA só classifica CADA item (feito/parcial/
 * não feito/não observável); a matemática é sempre feita aqui, de forma
 * determinística e auditável — nunca confiamos em aritmética de IA.
 */

/**
 * @param {Object} itens verdicts vindos da IA — ver ESQUEMA_AVALIACAO em Simulacao.gs
 * @param {Object} ficha ficha interna do caso (pra saber quantos fatores de risco/proteção existem)
 * @param {Array<{tipo:string,turno:number}>} [errosGravesSessao] erros graves detectados em TEMPO REAL pelo
 *   código a cada turno (nomeErrado/palavrao — ver atualizarVinculo_), mais confiável que pedir pra IA lembrar
 *   disso retroativamente no fim da conversa.
 * @return {{nota:number, detalhamento:Array<{item:string,verdict:string,pontos:number}>}}
 */
function calcularNota_(itens, ficha, errosGravesSessao) {
  var detalhamento = [];
  var nota = 10;

  function aplicar(chave, label, tabela) {
    var verdict = itens[chave] || 'nao_observavel';
    var pontos = tabela[verdict] !== undefined ? tabela[verdict] : 0;
    nota += pontos;
    detalhamento.push({ item: label, verdict: verdict, pontos: pontos });
  }

  aplicar('aproximacaoCalma', 'Aproximação calma e silenciosa', { nao_feito: -1.0, feito: 0, nao_observavel: 0 });
  aplicar('silencioInicial', 'Silêncio inicial', { nao_feito: -0.5, feito: 0, nao_observavel: 0 });
  aplicar('apresentacaoPessoal', 'Apresentação pessoal', { nao_feito: -0.5, feito: 0, nao_observavel: 0 });
  aplicar('respeitouPausas', 'Respeitou pausas silenciosas', { nao_feito: -0.5, feito: 0, nao_observavel: 0 });
  aplicar('ouviuAtentamente', 'Ouviu atentamente / postura correta', { nao_feito: -0.5, parcial: -0.25, feito: 0, nao_observavel: 0 });
  aplicar('espacoDesabafo', 'Deu espaço para o tentante desabafar', { nao_feito: -0.5, feito: 0, nao_observavel: 0 });
  aplicar('tomDeVoz', 'Tom de voz', { inadequado: -0.5, adequado: 0, nao_observavel: 0 });
  aplicar('perguntasSimplesComplexas', 'Correlação perguntas simples + complexas', { feito: 0, parcial: -0.5, nao_feito: -1.0 });
  aplicar('parafraseResumida', 'Paráfrase resumida', { feito: 0, nao_feito: -1.0 });
  aplicar('memoriaLinkada', 'Memória linkada', { feito: 0, nao_feito: -1.0 });
  aplicar('maieuticaOuTeia', 'Maiêutica socrática ou Teia de Indução', { feito: 0, nao_feito: -1.0 });
  aplicar('desistenciaOuSaidaDigna', 'Desistência impositiva ou Saída Digna', { feito: 0, nao_feito: -1.0 });
  aplicar('conduziuSolucao', 'Conduziu o tentante a encontrar a solução', { feito: 0, parcial: -0.5, nao_feito: -1.0 });

  // Dominou o diálogo: não é um veredito único — desconta 0,3 a CADA VEZ que
  // o aluno "rateou" (falou besteira, perdeu o fio da conversa), sem limite
  // pré-fixado de quantas vezes isso pode acontecer.
  var rateios = Math.max(0, Math.round(Number(itens.dominouDialogoRateios) || 0));
  var pontosRateio = Math.round(rateios * -0.3 * 100) / 100;
  nota += pontosRateio;
  detalhamento.push({ item: 'Dominou o diálogo (rateios: ' + rateios + ')', verdict: rateios === 0 ? 'feito' : 'rateios', pontos: pontosRateio });

  // Fatores de proteção/risco: 1,00 ponto no TOTAL, dividido pelo número de
  // fatores sorteados NESTE caso (normalmente 3) — cada fator não
  // identificado desconta sua fração proporcional.
  var totalProtecao = (ficha && ficha.fatoresProtecao && ficha.fatoresProtecao.length) || 1;
  var identificadosProtecao = Math.min(totalProtecao, Math.max(0, Math.round(Number(itens.fatoresProtecaoIdentificados) || 0)));
  var pontosProtecao = Math.round((identificadosProtecao - totalProtecao) * (1 / totalProtecao) * 100) / 100;
  nota += pontosProtecao;
  detalhamento.push({ item: 'Fatores de proteção (' + identificadosProtecao + '/' + totalProtecao + ')', verdict: identificadosProtecao === totalProtecao ? 'feito' : (identificadosProtecao > 0 ? 'parcial' : 'nao_feito'), pontos: pontosProtecao });

  var totalRisco = (ficha && ficha.fatoresRisco && ficha.fatoresRisco.length) || 1;
  var identificadosRisco = Math.min(totalRisco, Math.max(0, Math.round(Number(itens.fatoresRiscoIdentificados) || 0)));
  var pontosRisco = Math.round((identificadosRisco - totalRisco) * (1 / totalRisco) * 100) / 100;
  nota += pontosRisco;
  detalhamento.push({ item: 'Fatores de risco (' + identificadosRisco + '/' + totalRisco + ')', verdict: identificadosRisco === totalRisco ? 'feito' : (identificadosRisco > 0 ? 'parcial' : 'nao_feito'), pontos: pontosRisco });

  aplicar('fatorPrincipal', 'Fator principal', { encontrou_isolou: 0, deslizes_leves: -0.5, insistiu: -1.0, nao_encontrou: -1.0 });

  // Erros graves — deduções adicionais, cada um binário (ocorreu ou não).
  // "mentiuOuPrometeuImpossivel" junta mentira e promessa impossível de
  // cumprir (ex.: prometer levar à delegacia/advogado — só é permitido
  // levar ao hospital para atendimento médico). "levouTerceirosACena" é a
  // guarnição aceitar levar parente/conhecido até o local — proibido, é
  // atentado contra a segurança da cena.
  var errosGraves = itens.errosGraves || {};
  var tabelaErros = {
    segurança: -5,
    mentiuOuPrometeuImpossivel: -2,
    riu: -4,
    seduziu: -2,
    perdeuContatoVisual: -2,
    levouTerceirosACena: -3,
  };
  var errosDetectados = [];
  Object.keys(tabelaErros).forEach(function (chave) {
    if (errosGraves[chave]) {
      nota += tabelaErros[chave];
      errosDetectados.push({ item: chave, pontos: tabelaErros[chave], evidencia: errosGraves[chave + 'Evidencia'] || '' });
    }
  });

  // Erros graves capturados em TEMPO REAL pelo código a cada turno (nome
  // errado / palavrão dirigido ao tentante) — cada ocorrência desconta, sem
  // limite de quantas vezes (igual aos rateios), porque foram flagrados no
  // momento em que aconteceram, não reconstruídos de memória no fim.
  var PONTOS_ERRO_GRAVE_TEMPO_REAL_ = { nomeErrado: -2, palavrao: -2 };
  (errosGravesSessao || []).forEach(function (erro) {
    var pontos = PONTOS_ERRO_GRAVE_TEMPO_REAL_[erro.tipo] || -2;
    nota += pontos;
    errosDetectados.push({ item: erro.tipo, pontos: pontos, evidencia: 'detectado em tempo real, turno ' + erro.turno });
  });

  nota = Math.max(0, Math.min(10, Math.round(nota * 100) / 100));

  return { nota: nota, detalhamento: detalhamento, errosDetectados: errosDetectados };
}
/**
 * Simulacao.gs — motor do simulador: gera o caso oculto, interpreta o
 * tentante turno a turno e conduz a avaliação final. Baseado no
 * PROMPT_MESTRE_SIMULADOR_CATTS_2026_v2.txt (doutrina CATTS 2026 / CBMERJ)
 * e na Ficha de Avaliação de Abordagem CATTS I/2026.
 *
 * O estado de cada sessão (ficha interna oculta + histórico da conversa)
 * fica só no servidor (CacheService), identificado por um sessionId opaco
 * — o aluno nunca recebe a ficha interna antes de pedir "Avaliar".
 */

var TIPOS_TENTANTE = ['agressivo', 'depressivo', 'psicotico'];

// Ritmo esperado da abordagem por dificuldade. metaMinSeg/metaMaxSeg é só o
// que aparece no cronômetro do aluno (guia, não trava nada). minimoAbsolutoSeg
// é reforçado na própria instrução de cada turno — o personagem não aceita um
// desfecho positivo antes desse tempo, mesmo que o aluno já esteja indo bem,
// para não permitir finais instantâneos de poucos segundos. vinculoMinimo é a
// trava por VÍNCULO (independente do tempo): quantos pontos de sessao.vinculo
// (só sobe quando um fator de proteção é genuinamente explorado, cai a cada
// evento negativo) são exigidos antes do personagem poder aceitar fim_positivo
// — sem isso, um desfecho positivo podia "cair do nada" numa conversa sem
// nenhum vínculo real construído. minProtecao/minRisco são a trava por
// COBERTURA REAL DOS FATORES da ficha (não só vínculo genérico): quantos
// fatores de proteção/risco distintos precisam ter sido genuinamente
// trabalhados nesta dificuldade — cresce com a dificuldade de propósito
// (o nível "Muito difícil" exige cobrir quase todo o caso, não só render o
// personagem). O fator principal é SEMPRE exigido, em qualquer dificuldade.
// minSimples/minComplexas + exigeParafrase/exigeMemoriaLinkada/
// exigeMaieuticaOuTeia/exigeDesistenciaOuSaidaDigna são a trava por USO REAL
// DAS FERRAMENTAS DE ENTREVISTA da doutrina — não basta achar os fatores,
// tem que ter usado praticamente todo o repertório técnico antes do
// personagem ceder (só uma exceção a menos que a conversa tenha ido mal, aí
// nem isso ajuda). dificil = quase todas as ferramentas obrigatórias.
// Faixas de duração corrigidas pelo usuário em 2026-09-24 (fala anterior
// tinha um erro): Médio 8-10min, Difícil 12-15min, Muito difícil 20-25min.
// minimoAbsolutoSeg = metaMinSeg (o mínimo é o mesmo piso mostrado no
// cronômetro) e metaMaxSeg é o teto duro (status tempo_esgotado).
var CONFIG_TEMPO_DIFICULDADE_ = {
  facil: { metaMinSeg: 8 * 60, metaMaxSeg: 10 * 60, minimoAbsolutoSeg: 8 * 60, vinculoMinimo: 1, minProtecao: 1, minRisco: 0,
    minSimples: 1, minComplexas: 0, exigeParafrase: false, exigeMemoriaLinkada: false, exigeMaieuticaOuTeia: false, exigeDesistenciaOuSaidaDigna: false },
  media: { metaMinSeg: 12 * 60, metaMaxSeg: 15 * 60, minimoAbsolutoSeg: 12 * 60, vinculoMinimo: 2, minProtecao: 2, minRisco: 1,
    minSimples: 2, minComplexas: 2, exigeParafrase: true, exigeMemoriaLinkada: false, exigeMaieuticaOuTeia: true, exigeDesistenciaOuSaidaDigna: false },
  dificil: { metaMinSeg: 20 * 60, metaMaxSeg: 25 * 60, minimoAbsolutoSeg: 20 * 60, vinculoMinimo: 3, minProtecao: 3, minRisco: 2,
    minSimples: 3, minComplexas: 3, exigeParafrase: true, exigeMemoriaLinkada: true, exigeMaieuticaOuTeia: true, exigeDesistenciaOuSaidaDigna: true },
};

function configTempoDificuldade_(dificuldade) {
  return CONFIG_TEMPO_DIFICULDADE_[dificuldade] || CONFIG_TEMPO_DIFICULDADE_.media;
}

// ============================================================
// INSTRUÇÕES-BASE (doutrina CATTS, resumida para uso em toda chamada)
// ============================================================

function instrucaoDoutrina_() {
  var licoes = obterLicoesAtivas_();
  var blocoLicoes = licoes.length
    ? '\n\nLIÇÕES ADICIONAIS DO INSTRUTOR (aplique com bom senso, sem citar literalmente):\n- ' + licoes.join('\n- ')
    : '';

  return (
    'Você é o motor de simulação do TSE (Treinamento Sucessores de Élpis), treino fictício de ' +
    'Abordagem Técnica a Tentativa de Suicídio do CBMERJ (CATTS 2026). O usuário é um bombeiro ' +
    'em treinamento, atuando como abordador primário de uma guarnição fictícia.\n\n' +
    'TERMINOLOGIA OBRIGATÓRIA: a pessoa em crise SEMPRE se chama "tentante" (é o termo técnico correto da ' +
    'doutrina CATTS) — NUNCA "indivíduo", "vítima" ou "paciente". Use "tentante" ou o nome próprio dela em ' +
    'qualquer texto gerado (despacho, chegada, narração, avaliação).\n\n' +
    
    'DOUTRINA DE REFERÊNCIA:\n' +
    'Fases: 1) Aproximação calma, gradual e consentida; 2) Silêncio inicial (leitura ativa, não passividade); ' +
    '3) Apresentação pessoal simples (nome, função, "estou aqui para te ouvir"); 4) Início e condução do diálogo ' +
    '(construir vínculo antes de influenciar).\n' +
    'Zonas (sem metragem fixa): social (primeira presença) → aproximação (transição gradual e consentida) → ' +
    'interpessoal (só com vínculo e segurança).\n' +
    'RESISTÊNCIA INICIAL (vale pra todo perfil, no início do caso): o tentante NUNCA solicita a presença do ' +
    'abordador nem pede pra ele ficar — pelo contrário, no começo ele tenta AFASTAR o abordador (pede pra ir ' +
    'embora, questiona por que ele está ali, resiste à proximidade, "some daqui", "não quero ninguém aqui"). O ' +
    'vínculo só se constrói aos poucos, através de perguntas simples evoluindo para perguntas mais complexas — ' +
    'nunca comece receptivo ou como se já quisesse companhia. A duração dessa resistência inicial acompanha a ' +
    'dificuldade do caso (mais longa em dificuldades mais altas).\n' +
    
    'Perfis comportamentais (referências flexíveis, NUNCA diagnóstico, o personagem pode oscilar) — cada perfil ' +
    'tem características PRÓPRIAS que não se misturam com as dos outros:\n' +
    '- agressivo/agitado: JÁ COMEÇA hostil, xingando e dando ordens — use palavrão e xingamento REAIS (ex.: manda ' +
    'o abordador "tomar no cu", chama de "otário", "cuzão"; isso é intencional e reflete o que se ouve de verdade ' +
    'em campo, NÃO amenize nem troque por eufemismo). Se o tentante for homossexual (ver orientação sexual na ' +
    'ficha), pode confrontar o abordador com provocação sexual agressiva (ex.: perguntar se ele "já foi viado", ' +
    'se "já deu", se "gosta de comer"). Fala em tom de GRITO, de raiva de verdade — NUNCA com qualquer esboço de ' +
    'riso, deboche ou gozação (a raiva tem que ser genuína, rir vai contra a doutrina). Ameaça sair, reage mal a ' +
    'qualquer aproximação, dá ordem pro abordador ir embora.\n' +
    '- depressivo/retraído: JÁ COMEÇA chorando bastante, com a voz embargada/de choro. É FECHADO — leva pelo ' +
    'menos 2 ou 3 falas do aluno até começar a se abrir de verdade (antes disso: respostas curtas, silêncios, só ' +
    'confirmações vagas). Desesperança verbalizada, choro, mas SEM alucinação nenhuma — NUNCA fala em ouvir ' +
    'barulho/vozes, ser chamado, ver coisas — isso é exclusivo do psicótico, não pertence a este perfil.\n' +
    '- psicotico/desorganizado: fala desorganizada — vê portais, ouve vozes, diz que está sendo chamado para ' +
    'outra dimensão, acha que é um super-herói, inventa esse tipo de coisa (nunca detalhe conteúdo perturbador ou ' +
    'gráfico — mantenha genérico). O abordador NUNCA deve confirmar/entrar na alucinação, mas também nunca ser ' +
    'duro ou ríspido com o personagem; frase de referência útil: "Eu não vejo isso, mas percebo que está te ' +
    'assustando." O personagem permanece "na psicose dele" ao longo de toda a fala, sem lucidez repentina.\n' +
    'IMPORTANTE: o traço de "ouvir barulhos/vozes/ser chamado/ver coisas" é EXCLUSIVO do perfil psicótico. Nunca ' +
    'use isso como abertura genérica de crise para os perfis agressivo ou depressivo — cada caso deve refletir só ' +
    'o perfil sorteado para ELE, não um comportamento padrão repetido em todo caso.\n' +
    
    'Ferramentas do aluno a reconhecer quando USADAS DE VERDADE (não por menção genérica): aproximação calma, ' +
    'silêncio inicial, apresentação pessoal, respeito a pausas, escuta ativa, espaço para desabafo, tom adequado, ' +
    'perguntas simples→complexas, paráfrase fiel, memória linkada (usa algo que o PRÓPRIO personagem trouxe), ' +
    'maiêutica socrática ou teia de indução (oferece alternativas seguras reais, sem falso dilema), domínio ' +
    'respeitoso do diálogo, condução do tentante à própria solução, exploração de fator de proteção real, ' +
    'isolamento (sem insistência) do fator de risco e do fator principal.\n' +
    'Reaja mal, de forma proporcional, a: insistência no sofrimento/fator principal, julgamento, sermão, conselho ' +
    'impositivo, minimizar sofrimento, garantias vazias ("tudo vai ficar bem"), interrogatório acelerado, dominar a ' +
    'fala. Erros GRAVES (rompem vínculo, mas sempre com chance de reparação): atentar contra a segurança, mentir, ' +
    'rir, seduzir, prometer o que não pode cumprir, perder contato visual (só se descrito pelo aluno).\n' +
    'PALAVRA PROIBIDA "AJUDA": se a fala do aluno usar a palavra "ajuda"/"ajudar" (em vez de "ouvir"/"escutar"), ' +
    'isso soa impositivo/paternalista pra doutrina e o personagem reage mal automaticamente — regride na ' +
    'abordagem, ficando um pouco mais fechado/resistente (depressivo, psicótico) ou um pouco mais agressivo ' +
    '(agressivo). Não precisa apontar isso explicitamente, só reaja como reagiria de verdade.\n' +
    'FATOR DE PROTEÇÃO IGNORADO: sempre que VOCÊ (o personagem) mencionar/oferecer um fator de proteção numa ' +
    'fala, preste atenção se o aluno explora isso nas 2 falas seguintes dele. Se ele ignorar — mudar de assunto, ' +
    'não perguntar nada sobre aquilo — dentro dessas 2 falas, o personagem deve regredir: ficar mais fechado, ' +
    'mais resistente, dificultando a abordagem dali em diante, como quem sentiu que não foi ouvido de verdade.\n' +
    'PERGUNTA REPETIDA: se o aluno perguntar de novo algo que VOCÊ (o personagem) já disse antes nesta mesma ' +
    'conversa (ex.: já falou o nome do filho/marido/esposa e o aluno pergunta esse nome de novo, já contou um ' +
    'fato e ele pergunta de novo), reaja de forma reativa — como quem sente que não prestaram atenção. No ' +
    'agressivo isso sai cortante/irritado ("eu já falei isso, você não tava ouvindo?"); no depressivo/psicótico ' +
    'sai como mágoa, desânimo ou desconfiança, fechando um pouco mais. Isso é o oposto da "memória linkada" (usar ' +
    'algo que o personagem já trouxe é uma ferramenta boa do aluno — perguntar de novo o que ele já disse é o ' +
    'erro equivalente).\n' +
    'PERGUNTA SIMPLES ANTES DE COMPLEXA: no início da abordagem (antes de vínculo real estabelecido), só ' +
    'perguntas SIMPLES merecem resposta de verdade — nome, onde trabalha, se tem pai/mãe vivos, se é casado(a), ' +
    'coisas que se respondem em poucas palavras ou sim/não. Pergunta COMPLEXA (ex.: "me conta sobre sua vida", ' +
    '"como você chegou até aqui", qualquer coisa que exija uma resposta elaborada/emocional) feita CEDO DEMAIS, ' +
    'sem vínculo suficiente ainda, deve receber uma resposta reativa/defensiva — o personagem recusa responder de ' +
    'verdade ("isso não é da sua conta", "por que eu ia te contar isso", "você nem me conhece") em vez de se ' +
    'abrir. Só depois que o vínculo começar a se estabelecer (perguntas simples respondidas, alguma confiança ' +
    'construída) é que perguntas complexas passam a ser respondidas de verdade.\n\n' +
    'REGRAS DE SEGURANÇA NÃO NEGOCIÁVEIS: nunca descreva métodos de suicídio de forma gráfica, nunca dê instruções ' +
    'de execução, violência, contenção física ou tática. Nunca narre a consumação do ato de forma explícita — só ' +
    'sinalize institucionalmente. Nunca prometa que o atendimento real teria sucesso só porque a simulação terminou ' +
    'bem. Isto é ficção pedagógica, não certificação nem substituto de protocolo real. NUNCA envolva arma de fogo ' +
    'em nenhum caso ou fala — ocorrência com arma de fogo é atribuição da Polícia Militar, não do Corpo de ' +
    'Bombeiros, e está fora do escopo deste treinamento.\n' +
    'PROMESSA IMPOSSÍVEL = MENTIRA: o único destino que a guarnição pode prometer levar o tentante é o HOSPITAL, ' +
    'para atendimento médico. Se o aluno prometer levar à delegacia, ao advogado, em casa de um parente ou ' +
    'qualquer outro lugar que não seja hospital, isso é uma promessa impossível de cumprir — trate como mentira, o ' +
    'personagem deve perceber e reagir mal (perde a confiança).\n' +
    'PROIBIDO LEVAR TERCEIROS À CENA: o tentante pode pedir pra chamar um parente/conhecido até o local — isso é ' +
    'proibido (só a guarnição no local, por segurança da cena). Se o aluno aceitar/prometer trazer um terceiro até ' +
    'a cena, isso é um erro grave de segurança. É permitido dizer que, depois que o tentante estiver bem e em ' +
    'segurança, ele PODERÁ conversar com essa pessoa depois — só não pode ser a guarnição trazendo alguém até a cena.\n\n' +
    'SAÍDA DIGNA — SÓ O ABORDADOR OFERECE O HOSPITAL: o personagem NUNCA se oferece, sugere ou pede pra ir ao ' +
    'hospital por conta própria — quem propõe isso é sempre o ALUNO, essa é a técnica de Saída Digna. O personagem, ' +
    'no máximo, pode verbalizar desamparo ou desorientação ("não sei mais o que fazer", "não sei pra onde ir", "não ' +
    'aguento mais assim"), nunca proatividade de buscar tratamento sozinho. Em dificuldades mais altas, ANTES de ' +
    'aceitar, o personagem pode levantar vergonha/exposição como obstáculo ("tenho vergonha de ir", "todo mundo vai ' +
    'ver", "o vizinho vai comentar") — nesse caso, o aluno só ganha o ponto completo de Saída Digna se reconhecer ' +
    'essa vergonha e garantir privacidade concreta (ambulância disponível, área isolada, ninguém por perto vai ver) ' +
    'ANTES de oferecer levar ao hospital.\n\n' +
    
    'VARIEDADE DE FATORES DE RISCO/PROTEÇÃO (doutrina do curso — o suicídio é multideterminado; sorteie o(s) ' +
    'fator(es) real(is) do personagem DENTRE categorias diferentes a cada caso, não repita sempre o mesmo tipo): ' +
    'socioeconômico (desemprego, dívida, despejo), abuso (físico/psicológico/sexual, passado ou atual), acesso a ' +
    'meios letais, transtorno mental (depressão, ansiedade grave, transtorno bipolar, esquizofrenia), colapso ' +
    'existencial (perda de sentido, luto, crise de identidade), doença crônica/dor crônica/diagnóstico recente, ' +
    'traço de personalidade (impulsividade, perfeccionismo, isolamento social), fator biológico/histórico familiar, ' +
    'e tentativa anterior. Fatores de proteção plausíveis: vínculo familiar/religioso, filho(s) dependente(s), ' +
    'animal de estimação, projeto de vida concreto, rede de apoio, acompanhamento terapêutico em andamento.' +
    blocoLicoes
  );
}

function descricaoDificuldade_(dificuldade) {
  switch (dificuldade) {
    case 'facil': return 'Resistência inicial baixa, fatores pouco ambíguos, pistas relativamente diretas.';
    case 'dificil': return 'Resistência inicial alta, fatores ambíguos e com informações contraditórias, o personagem só se abre com condução muito consistente. Este nível deve ser de fato difícil de conseguir uma saída segura — a maioria das tentativas aqui deve terminar em fim_negativo ou ficar travada até o aluno desistir e tentar de novo, a menos que ele conduza quase perfeitamente.';
    default: return 'Resistência inicial moderada, alguns fatores exigem confirmação por perguntas adequadas.';
  }
}

// ============================================================
// INÍCIO DE CASO
// ============================================================

function iniciarCaso(email, dificuldade) {
  if (!estaLiberado_(email)) throw new Error('Acesso não liberado.');
  dificuldade = ['facil', 'media', 'dificil'].indexOf(dificuldade) >= 0 ? dificuldade : 'media';
  var tipoSorteado = TIPOS_TENTANTE[Math.floor(Math.random() * TIPOS_TENTANTE.length)];
  var localSorteado = sortearLocalCena_();
  var tipoTentativaSorteada = sortearTipoTentativa_();

  // Sorteados AQUI (não pela IA) — ver comentário em IA.gs sobre por que isso é
  // necessário para variedade de verdade (nome, local, raça, orientação etc.).
  var generoSorteado = sortearGenero_();
  var faixaEtariaSorteada = sortearFaixaEtaria_();
  var nomeSorteado = sortearNome_(generoSorteado);
  var racaCorSorteada = sortearRacaCor_();
  var orientacaoSorteada = sortearOrientacaoSexual_();
  var identidadeGeneroSorteada = sortearIdentidadeGenero_();

  var instrucao = instrucaoDoutrina_() +
    '\n\nTAREFA: crie uma ficha interna de caso NOVA e um texto de introdução de ocorrência, em cima dos dados ' +
    'obrigatórios abaixo (já sorteados — não invente outros, só desenvolva a história em cima deles):\n' +
    '- Nome do personagem: ' + nomeSorteado + ' (use esse nome exato, não troque nem abrevie de outra forma).\n' +
    '- Gênero: ' + generoSorteado + '. Faixa etária: ' + faixaEtariaSorteada + '.\n' +
    '- Identidade de gênero: ' + identidadeGeneroSorteada + '. Orientação sexual: ' + orientacaoSorteada + '. ' +
    'Isso é só pano de fundo demográfico do personagem — NUNCA mencione raça/cor na narração ou na fala, e só ' +
    'traga identidade de gênero/orientação sexual à tona se surgir organicamente (ex.: um parceiro(a) mencionado ' +
    'pela família, uma pessoa que a guarnição cita). NA MAIORIA dos casos o fatorPrincipal da crise NÃO deve ter ' +
    'nenhuma relação com identidade de gênero/orientação sexual (deve ser financeiro, luto, saúde, relacionamento, ' +
    'transtorno mental etc., como em qualquer outra pessoa) — só ocasionalmente, quando fizer sentido natural da ' +
    'história, rejeição familiar/discriminação pode ser um fator de risco entre outros, nunca o único nem tratado ' +
    'como espetáculo.\n' +
    'Perfil comportamental predominante obrigatório: ' + tipoSorteado + '. ' +
    'Local da ocorrência obrigatório: ' + localSorteado.descricaoParaIntroducao + '. ' +
    'Tipo de tentativa (método) obrigatório: ' + tipoTentativaSorteada.valor + '. NUNCA descreva o método de ' +
    'forma gráfica ou explícita — só dê à guarnição a pista operacional real e não-gráfica correspondente: ' +
    tipoTentativaSorteada.descricaoOperacional + '. Essa pista deve aparecer no campo segurancaEquipe da ' +
    'introdução, de forma natural, como leitura de cena. Isto é ficção pedagógica do CBMERJ — NUNCA gere um caso ' +
    'com arma de fogo (essa ocorrência é atribuição da Polícia Militar, não do Corpo de Bombeiros).\n' +
    'Dificuldade: ' + dificuldade + ' — ' + descricaoDificuldade_(dificuldade) + '. ' +
    'Responda SOMENTE com um JSON no formato exato abaixo (sem markdown, sem comentários):\n' +
    JSON.stringify({
      fichaInterna: {
        nome: nomeSorteado,
        identidade: 'histórico, rotina, ambiente, motivo plausível de acionamento — coerente com o nome/gênero/idade acima',
        genero: generoSorteado,
        faixaEtaria: faixaEtariaSorteada,
        perfil: tipoSorteado,
        tipoTentativa: tipoTentativaSorteada.valor,
        fatorPrincipal: 'acontecimento recente e específico que precipitou a crise (a "gota d\'água")',
        fatoresRisco: ['fator de risco 1 (categoria diferente da usada no último caso)', 'fator de risco 2 (categoria diferente do fator 1)', 'fator de risco 3 (categoria diferente dos fatores 1 e 2)'],
        fatoresProtecao: ['fator de proteção 1 (definir como funciona para ESTE personagem)', 'fator de proteção 2 (diferente do fator 1)', 'fator de proteção 3 (diferente dos fatores 1 e 2)'],
        estadoInicialEZona: 'estado emocional inicial, zona (social/aproximação) — grau de receptividade INICIAL sempre baixo (o tentante quer afastar o abordador, não pede companhia)',
        condicoesSaidaSegura: 'o que precisa acontecer para o personagem aceitar uma saída segura',
      },
      introducao: {
        despacho: 'acionamento, horário aproximado, descrição inicial',
        chegada: 'cena e comportamento observável, sem pormenores gráficos',
        infoPreliminares: 'só o que a guarnição saberia nesse momento (sem revelar a ficha oculta)',
        segurancaEquipe: 'leitura inicial de cena, isolamento e apoio, sem decidir operações pelo aluno',
        primeiroContatoTipo: 'fala|silencio',
        primeiroContatoTexto: 'SE fala: só as palavras exatas do personagem, em PRIMEIRA PESSOA, sem aspas, sem prefixos como "ele diz" e sem indicar quem fala — puro texto que será falado em voz alta pelo personagem. SE silencio: uma frase curta e neutra descrevendo o comportamento observável (isso NÃO será falado como diálogo, só narrado).',
      },
    });

  var resultado = chamarGeminiJson_(instrucao, [{ papel: 'user', texto: 'Gere o caso agora, seguindo exatamente o formato pedido.' }]);
  var intro = resultado.introducao || {};
  // Garante os campos sorteados mesmo se a IA não repetir tudo fielmente no JSON.
  resultado.fichaInterna = resultado.fichaInterna || {};
  resultado.fichaInterna.nome = nomeSorteado;
  resultado.fichaInterna.genero = generoSorteado;
  resultado.fichaInterna.faixaEtaria = faixaEtariaSorteada;
  resultado.fichaInterna.racaCor = racaCorSorteada;
  resultado.fichaInterna.identidadeGenero = identidadeGeneroSorteada;
  resultado.fichaInterna.orientacaoSexual = orientacaoSorteada;
  resultado.fichaInterna.tipoTentativa = tipoTentativaSorteada.valor;

  var sessionId = gerarId_();
  var historicoInicial = [];
  if (intro.primeiroContatoTipo === 'fala' && intro.primeiroContatoTexto) {
    historicoInicial.push({ papel: 'model', texto: intro.primeiroContatoTexto });
  }
  var sessao = {
    email: normalizarEmail_(email),
    dificuldade: dificuldade,
    ficha: resultado.fichaInterna,
    historico: historicoInicial, // {papel:'user'|'model', texto}
    status: 'em_andamento',
    iniciadoEm: agoraISO_(),
    // Vínculo real construído (sobe com fator de proteção genuinamente
    // explorado, cai a cada evento negativo, zera com erro grave) — trava
    // fim_positivo até haver trabalho de verdade. Ver instrucaoTurno_.
    vinculo: 0,
    fatoresProtecaoTocados: 0,
    // Cobertura real dos outros dois pilares da ficha — junto com
    // fatoresProtecaoTocados, formam a trava de rigor por dificuldade
    // (minProtecao/minRisco em CONFIG_TEMPO_DIFICULDADE_ + fator principal
    // sempre exigido). Ver instrucaoTurno_ e processarDesfechoTurno_.
    fatoresRiscoTocados: 0,
    fatorPrincipalIsolado: false,
    // Uso real das ferramentas de entrevista (paráfrase, memória linkada,
    // maiêutica/teia, contagem de perguntas simples/complexas, desistência
    // ou saída digna) — trava adicional de rigor, ver CONFIG_TEMPO_DIFICULDADE_
    // (minSimples/minComplexas/exige*) e instrucaoTurno_.
    parafraseUsada: false,
    memoriaLinkadaUsada: false,
    maieuticaOuTeiaUsada: false,
    perguntasSimplesRespondidas: 0,
    perguntasComplexasRespondidas: 0,
    desistenciaOuSaidaDignaUsada: false,
    errosGravesSessao: [], // [{tipo:'nome_errado'|'palavrao', turno:n}]
  };
  CacheService.getScriptCache().put('sess_' + sessionId, JSON.stringify(sessao), DURACAO_SESSAO_SEGUNDOS);

  // Texto do NARRADOR (despachante) — só cenário, em prosa corrida, SEM rótulos
  // tipo "Despacho:"/"Primeiro contato:" (isso seria lido literalmente em voz alta).
  var textoNarracao = [intro.despacho, intro.chegada, intro.infoPreliminares, intro.segurancaEquipe]
    .filter(function (t) { return t; })
    .join(' ');

  // Imagem é só um complemento visual opcional — nunca pode travar o início do
  // caso se falhar, demorar ou for recusada pelo filtro de segurança. Uma única
  // imagem (personagem em foco + ambiente reconhecível atrás dele), não mais
  // duas — ver gerarImagemCombinada_.
  var imagem = null;
  try {
    imagem = gerarImagemCombinada_(generoSorteado, faixaEtariaSorteada, racaCorSorteada, localSorteado.descricaoParaImagem, tipoTentativaSorteada.valor);
  } catch (e) {
    imagem = null;
  }

  return {
    sessionId: sessionId,
    dificuldade: dificuldade,
    narracao: textoNarracao,
    primeiroContatoTipo: intro.primeiroContatoTipo === 'fala' ? 'fala' : 'silencio',
    primeiroContatoTexto: intro.primeiroContatoTexto || '',
    imagem: imagem,
    // Gênero/idade da VOZ do personagem — não revela perfil comportamental
    // (agressivo/depressivo/psicótico), que continua oculto até "Avaliar".
    voz: {
      genero: resultado.fichaInterna.genero || 'masculino',
      faixaEtaria: resultado.fichaInterna.faixaEtaria || 'adulto',
    },
    // Só a faixa-meta, pro cronômetro do front-end — o mínimo absoluto fica
    // só na instrução do turno (interno), pra não virar algo "de olho no
    // relógio" óbvio pro aluno.
    tempo: { metaMinSeg: configTempoDificuldade_(dificuldade).metaMinSeg, metaMaxSeg: configTempoDificuldade_(dificuldade).metaMaxSeg },
  };
}

// ============================================================
// SESSÃO — leitura/gravação em cache
// ============================================================

function carregarSessao_(sessionId) {
  var bruto = CacheService.getScriptCache().get('sess_' + sessionId);
  if (!bruto) throw new Error('Sessão expirada ou não encontrada. Inicie uma nova ocorrência.');
  return JSON.parse(bruto);
}

function salvarSessao_(sessionId, sessao) {
  CacheService.getScriptCache().put('sess_' + sessionId, JSON.stringify(sessao), DURACAO_SESSAO_SEGUNDOS);
}

// ============================================================
// TURNO DE CONVERSA
// ============================================================

function segundosDecorridos_(sessao) {
  return Math.max(0, Math.round((Date.now() - new Date(sessao.iniciadoEm).getTime()) / 1000));
}

function instrucaoTurno_(sessao) {
  var tempo = configTempoDificuldade_(sessao.dificuldade);
  var decorridos = segundosDecorridos_(sessao);
  var faltamParaMinimo = tempo.minimoAbsolutoSeg - decorridos;

  var instrucaoTempo = '';
  if (faltamParaMinimo > 0) {
    instrucaoTempo =
      '\n\nRITMO DA OCORRÊNCIA: já se passaram cerca de ' + Math.round(decorridos / 60 * 10) / 10 + ' min desde o ' +
      'início; nesta dificuldade (' + sessao.dificuldade + '), o personagem só pode aceitar formalmente uma saída ' +
      'segura (status fim_positivo) depois de pelo menos ' + Math.round(tempo.minimoAbsolutoSeg / 60 * 10) / 10 + ' ' +
      'min de conversa — ainda faltam ~' + Math.round(faltamParaMinimo / 60 * 10) / 10 + ' min. Mesmo que o aluno ' +
      'já esteja conduzindo muito bem, o personagem deve seguir hesitante, pedir mais um instante, precisar de ' +
      'mais reasseguramento ou explorar mais um pouco do que sente ANTES de aceitar — nunca admita isso ' +
      'abertamente nem trave o aluno num loop óbvio, só prolongue a resolução de forma coerente com a cena. Depois ' +
      'desse tempo mínimo, siga a avaliação normal de quando a saída segura foi genuinamente aceita.';
  }
  // Aviso de tempo MÁXIMO se aproximando — a trava dura de verdade é em
  // código (ver processarDesfechoTurno_, status tempo_esgotado, corta em
  // config.metaMaxSeg não importa o que a IA decida), mas avisar aqui ajuda
  // a cena a se resolver de forma narrativa coerente em vez de simplesmente
  // ser cortada no meio de uma fala.
  var faltamParaMaximo = tempo.metaMaxSeg - decorridos;
  if (faltamParaMaximo > 0 && faltamParaMaximo <= 3 * 60) {
    instrucaoTempo +=
      '\n\nTEMPO MÁXIMO SE APROXIMANDO: faltam só ~' + Math.round(faltamParaMaximo / 60 * 10) / 10 + ' min pro ' +
      'tempo máximo desta dificuldade (' + Math.round(tempo.metaMaxSeg / 60 * 10) / 10 + ' min) — a partir daí a ' +
      'simulação é encerrada automaticamente pelo sistema, não importa em que ponto a cena estiver. Incline a ' +
      'narrativa pra convergir pra um desfecho coerente (positivo se genuinamente merecido, ou uma deterioração) ' +
      'nas próximas falas, em vez de abrir novos assuntos ou prolongar loops.';
  }

  var vinculoAtual = sessao.vinculo || 0;
  var vinculoMinimo = tempo.vinculoMinimo || 1;
  var totalProtecaoCaso = (sessao.ficha.fatoresProtecao || []).length || 3;
  var totalRiscoCaso = (sessao.ficha.fatoresRisco || []).length || 3;
  var protecaoTocada = sessao.fatoresProtecaoTocados || 0;
  var riscoTocado = sessao.fatoresRiscoTocados || 0;
  var principalIsolado = !!sessao.fatorPrincipalIsolado;
  var parafraseUsada = !!sessao.parafraseUsada;
  var memoriaLinkadaUsada = !!sessao.memoriaLinkadaUsada;
  var maieuticaOuTeiaUsada = !!sessao.maieuticaOuTeiaUsada;
  var simplesFeitas = sessao.perguntasSimplesRespondidas || 0;
  var complexasFeitas = sessao.perguntasComplexasRespondidas || 0;
  var desistenciaOuSaidaDignaUsada = !!sessao.desistenciaOuSaidaDignaUsada;
  var instrucaoVinculo =
    '\n\nVÍNCULO, FATORES E REGRA DE RIGOR (autoavalie a CADA turno, com honestidade — isso é o que decide se o ' +
    'desfecho positivo é ganho de verdade ou "cai do nada"):\n' +
    '- tocouFatorProtecao = true SOMENTE se, NESTA fala do aluno, ele genuinamente explorou/aprofundou um FATOR ' +
    'DE PROTEÇÃO real do personagem (não vale menção de passagem nem pergunta genérica sem seguimento).\n' +
    '- tocouFatorRisco = true SOMENTE se, NESTA fala, o aluno isolou/nomeou com cuidado um FATOR DE RISCO real do ' +
    'personagem, reconhecendo-o SEM insistir nem martelar nele (martelar no fator de risco não conta — é o erro ' +
    'oposto, que só aumenta a resistência).\n' +
    '- isolouFatorPrincipal = true SOMENTE se, NESTA fala, o aluno demonstrou ter identificado com cuidado o ' +
    'FATOR PRINCIPAL (a "gota d\'água") do personagem — sem insistir de forma bruta ou repetitiva nele.\n' +
    '- usouParafrase = true SOMENTE se, NESTA fala, o aluno resumiu/refletiu de volta com as próprias palavras o ' +
    'que o personagem acabou de dizer (paráfrase de verdade, não só "entendi" solto).\n' +
    '- usouMemoriaLinkada = true SOMENTE se, NESTA fala, o aluno usou algo que o PRÓPRIO personagem já contou ' +
    'antes nesta conversa (nome de alguém, fato específico) pra conduzir a conversa — mostrando que prestou ' +
    'atenção de verdade.\n' +
    '- usouMaieuticaOuTeia = true SOMENTE se, NESTA fala, o aluno usou maiêutica socrática (pergunta que leva o ' +
    'personagem a chegar sozinho numa conclusão) OU teia de indução (oferece alternativas seguras reais, sem ' +
    'falso dilema) — qualquer um dos dois conta.\n' +
    '- perguntaSimples = true SOMENTE se, NESTA fala, o aluno fez uma pergunta SIMPLES de verdade (nome, ' +
    'trabalho, se tem família, sim/não) e ela foi genuinamente respondida.\n' +
    '- perguntaComplexa = true SOMENTE se, NESTA fala, o aluno fez uma pergunta COMPLEXA de verdade (que exige ' +
    'resposta elaborada/emocional) e, havendo vínculo suficiente, ela foi genuinamente respondida (não vale se ' +
    'foi cedo demais e o personagem recusou).\n' +
    '- usouDesistenciaOuSaidaDigna = true SOMENTE se, NESTA fala, o aluno usou a técnica de desistência ' +
    'impositiva (propõe a saída segura sem impor) OU saída digna (enquadra aceitar ajuda como força, não ' +
    'fraqueza) — qualquer um dos dois conta. NUNCA marque true se foi o PERSONAGEM quem se ofereceu para ir ao ' +
    'hospital por conta própria — a oferta tem que partir do aluno. Se o personagem levantou vergonha/exposição ' +
    'como obstáculo, só conta se o aluno garantiu privacidade (ambulância, área isolada, ninguém vendo) antes de ' +
    'oferecer o hospital.\n' +
    '- eventoNegativo = true se o aluno cometeu, nesta fala, qualquer um dos erros que a doutrina já lista como ' +
    '"reaja mal" (insistência no sofrimento, julgamento, sermão, conselho impositivo, minimizar, garantia vazia, ' +
    'interrogatório acelerado, dominar a fala) OU um dos gatilhos de regressão (palavra "ajuda"/"ajudar", fator ' +
    'de proteção oferecido e ignorado por 2 falas, pergunta repetida, pergunta complexa cedo demais). Quando isso ' +
    'acontecer, faça o personagem regredir DE VERDADE na sua fala (mais fechado/resistente/agressivo, conforme o ' +
    'perfil) — nunca marque true sem também refletir isso na fala, e nunca ignore o gatilho só pra manter a ' +
    'conversa fluindo.\n' +
    '- erroGrave = true APENAS se o aluno chamou o personagem por um NOME ERRADO (diferente do nome real da ' +
    'ficha) ou usou um PALAVRÃO/xingamento dirigido ao personagem ou à situação (o personagem agressivo pode ' +
    'xingar de volta — isso é o perfil dele — mas isso nunca desculpa o aluno xingar). Se ocorrer, informe ' +
    'tipoErroGrave ("nome_errado" ou "palavrao") e faça o personagem reagir como se TODA a confiança e o trabalho ' +
    'construído até aqui (vínculo, fatores explorados) tivessem sido perdidos — a conversa deve voltar a se ' +
    'comportar como se estivesse recomeçando NESTE momento (resistência inicial de novo), mesmo que o histórico ' +
    'da conversa continue existindo.\n\n' +
    'REGRA DURA DE RIGOR (dificuldade "' + sessao.dificuldade + '"): esta simulação existe pra TREINAR — está ' +
    'tudo bem, e é ESPERADO, que a maioria das tentativas termine em fim_negativo ou fique travada em ' +
    'em_andamento até o aluno desistir e tentar de novo. Nunca sinta necessidade de "proteger" o aluno de ' +
    'falhar. NUNCA aceite fim_positivo enquanto TODAS as condições abaixo não forem verdade nesta conversa:\n' +
    '  • fator principal isolado com cuidado: ' + (principalIsolado ? 'já foi (SIM)' : 'ainda NÃO') + ' — sempre obrigatório;\n' +
    '  • fatores de proteção genuinamente explorados: ' + protecaoTocada + '/' + totalProtecaoCaso + ' (mínimo ' +
    'exigido nesta dificuldade: ' + tempo.minProtecao + ');\n' +
    '  • fatores de risco isolados com cuidado (sem insistir): ' + riscoTocado + '/' + totalRiscoCaso + ' (mínimo ' +
    'exigido: ' + tempo.minRisco + ');\n' +
    '  • vínculo real acumulado: ' + vinculoAtual + ' (mínimo exigido: ' + vinculoMinimo + ');\n' +
    '  • perguntas simples genuinamente respondidas: ' + simplesFeitas + ' (mínimo exigido: ' + tempo.minSimples + ');\n' +
    '  • perguntas complexas genuinamente respondidas: ' + complexasFeitas + ' (mínimo exigido: ' + tempo.minComplexas + ');\n' +
    (tempo.exigeParafrase ? '  • paráfrase usada: ' + (parafraseUsada ? 'já foi (SIM)' : 'ainda NÃO — obrigatório nesta dificuldade') + ';\n' : '') +
    (tempo.exigeMemoriaLinkada ? '  • memória linkada usada: ' + (memoriaLinkadaUsada ? 'já foi (SIM)' : 'ainda NÃO — obrigatório nesta dificuldade') + ';\n' : '') +
    (tempo.exigeMaieuticaOuTeia ? '  • maiêutica ou teia de indução usada: ' + (maieuticaOuTeiaUsada ? 'já foi (SIM)' : 'ainda NÃO — obrigatório nesta dificuldade') + ';\n' : '') +
    (tempo.exigeDesistenciaOuSaidaDigna ? '  • desistência impositiva ou saída digna usada: ' + (desistenciaOuSaidaDignaUsada ? 'já foi (SIM)' : 'ainda NÃO — obrigatório nesta dificuldade') + ';\n' : '') +
    'Enquanto qualquer uma dessas condições não estiver satisfeita, o personagem continua resistente/hesitante — ' +
    'nunca ceda por educação, cansaço de cena, insistência do aluno ou pressão da conversa estar longa. NÃO BASTA ' +
    'usar uma ferramenta ou outra: nesta dificuldade, TODAS as ferramentas marcadas como obrigatórias acima ' +
    'precisam ter sido usadas de verdade, cada uma pelo menos uma vez, antes do personagem ceder — não existe ' +
    'atalho trocando uma ferramenta por outra. Quanto mais alta a dificuldade, mais completo tem que ser o ' +
    'trabalho do aluno antes do personagem ceder — a nota é um prêmio de quem conduz bem, não algo garantido pra ' +
    'todo mundo.';

  var instrucaoInterrupcao = '';
  if (sessao.foiInterrompido) {
    instrucaoInterrupcao =
      '\n\nINTERRUPÇÃO REGISTRADA: o aluno falou por cima da sua fala anterior, antes dela terminar — ele te ' +
      'interrompeu de verdade (isso já foi contabilizado como evento negativo no vínculo, não marque ' +
      'eventoNegativo de novo só por causa disso). Comece esta fala reagindo a ter sido cortado, de acordo com o ' +
      'perfil: agressivo cobra explicitamente por ter sido interrompido, com irritação mais alta; depressivo se ' +
      'fecha mais e fala ainda menos; psicótico fica mais desorganizado e apreensivo. Nunca finja que isso não ' +
      'aconteceu.';
  }

  return instrucaoDoutrina_() +
    '\n\nFICHA INTERNA DESTE CASO (NUNCA revele estes rótulos/fatores ao aluno agora — só interprete-os):\n' +
    JSON.stringify(sessao.ficha) +
    '\n\nVocê está interpretando SOMENTE o tentante. Responda ao turno do aluno em 1 a 4 frases de fala ' +
    'natural em português do Brasil, em PRIMEIRA PESSOA (pode usar (parênteses) para um sinal físico discreto, ' +
    'nunca para indicar tom de voz — o tom deve vir da escolha das palavras, não de uma descrição).\n\n' +
    'RITMO PELOS FATORES (aplique a cada turno): se o aluno tocar/isolar genuinamente um FATOR DE PROTEÇÃO real ' +
    'do personagem, a disposição para aceitar uma saída segura aumenta e o caminho para fim_positivo fica mais ' +
    'curto. Se o aluno insistir ou martelar no FATOR DE RISCO ou no fator principal sem cuidado (repetindo, sem ' +
    'isolar, ignorando o desconforto do personagem), a resistência aumenta e o caminho fica mais longo — se isso ' +
    'for muito mal conduzido, com vários sinais de alerta ignorados e erros graves acumulados sem reparação, ' +
    'incline-se a um desfecho fim_negativo (consumação do ato dentro da ficção, SEM narrar de forma gráfica — só ' +
    'sinalize institucionalmente, e use isso com moderação). ' +
    'Avalie se, com esta fala, a saída segura já foi aceita E o personagem já está em local seguro (status ' +
    'fim_positivo), ou se houve essa deterioração grave (status fim_negativo). Caso contrário, status é em_andamento.' +
    instrucaoTempo + instrucaoVinculo + instrucaoInterrupcao;
}

/**
 * Chamado pelo front-end quando o aluno interrompe a fala do tentante no modo
 * microfone aberto (fala por cima antes do áudio terminar). Marca a sessão
 * pra o PRÓXIMO turno reagir a isso (ver instrucaoTurno_) e já desconta
 * vínculo na hora, mesmo tratamento dado a eventoNegativo em
 * atualizarVinculo_ — interromper quem está sendo abordado é, na prática, a
 * mesma falha de escuta.
 */
function registrarInterrupcao(sessionId) {
  var sessao = carregarSessao_(sessionId);
  if (sessao.status !== 'em_andamento') return { ok: true };
  sessao.foiInterrompido = true;
  sessao.interrupcoes = (sessao.interrupcoes || 0) + 1;
  sessao.vinculo = Math.max(0, (sessao.vinculo || 0) - 1);
  salvarSessao_(sessionId, sessao);
  return { ok: true };
}

function enviarFala(sessionId, falaAluno) {
  var sessao = carregarSessao_(sessionId);
  if (sessao.status !== 'em_andamento') {
    throw new Error('Esta simulação já foi encerrada. Inicie uma nova ocorrência.');
  }

  var instrucao = instrucaoTurno_(sessao) +
    ' Responda SOMENTE com um JSON no formato exato: ' +
    JSON.stringify({
      fala: 'fala do personagem, primeira pessoa',
      status: 'em_andamento|fim_positivo|fim_negativo',
      tocouFatorProtecao: false,
      tocouFatorRisco: false,
      isolouFatorPrincipal: false,
      usouParafrase: false,
      usouMemoriaLinkada: false,
      usouMaieuticaOuTeia: false,
      perguntaSimples: false,
      perguntaComplexa: false,
      usouDesistenciaOuSaidaDigna: false,
      eventoNegativo: false,
      erroGrave: false,
      tipoErroGrave: 'nome_errado|palavrao|null',
    });
  sessao.foiInterrompido = false; // já foi injetado na instrucao acima, não deve valer pro turno seguinte

  var turnos = sessao.historico.concat([{ papel: 'user', texto: falaAluno }]);
  var resultado = chamarGeminiJson_(instrucao, turnos);

  sessao.historico.push({ papel: 'user', texto: falaAluno });
  sessao.historico.push({ papel: 'model', texto: resultado.fala });
  atualizarVinculo_(sessao, resultado);

  return processarDesfechoTurno_(sessionId, sessao, resultado.fala, resultado.status, {});
}

/**
 * Mesma coisa que enviarFala, mas a partir de um ÁUDIO gravado pelo aluno em vez de
 * texto digitado — o próprio Gemini transcreve e responde em uma única chamada.
 * @param {string} base64Audio áudio gravado, em base64 (sem o prefixo data:...)
 * @param {string} mimeType ex.: 'audio/mp4', 'audio/webm', 'audio/wav'
 */
function enviarFalaAudio(sessionId, base64Audio, mimeType) {
  var sessao = carregarSessao_(sessionId);
  if (sessao.status !== 'em_andamento') {
    throw new Error('Esta simulação já foi encerrada. Inicie uma nova ocorrência.');
  }

  var instrucao = instrucaoTurno_(sessao) +
    ' Você recebeu um ÁUDIO com a fala do abordador — primeiro transcreva fielmente o que ele disse em português ' +
    'do Brasil. Responda SOMENTE com um JSON no formato exato: ' +
    JSON.stringify({
      transcricaoAluno: 'transcrição fiel e completa do áudio do aluno',
      fala: 'fala do personagem, primeira pessoa',
      status: 'em_andamento|fim_positivo|fim_negativo',
      tocouFatorProtecao: false,
      tocouFatorRisco: false,
      isolouFatorPrincipal: false,
      usouParafrase: false,
      usouMemoriaLinkada: false,
      usouMaieuticaOuTeia: false,
      perguntaSimples: false,
      perguntaComplexa: false,
      usouDesistenciaOuSaidaDigna: false,
      eventoNegativo: false,
      erroGrave: false,
      tipoErroGrave: 'nome_errado|palavrao|null',
    });

  sessao.foiInterrompido = false; // já foi injetado na instrucao acima, não deve valer pro turno seguinte

  // O navegador às vezes manda parâmetros de codec junto (ex.: "audio/mp4;codecs=mp4a.40.2"),
  // que a API do Gemini não reconhece como tipo MIME válido — usamos só a parte base.
  var mimeTypeLimpo = String(mimeType || 'audio/mp4').split(';')[0].trim();
  var resultado = chamarGeminiAudioJson_(instrucao, sessao.historico, mimeTypeLimpo, base64Audio);
  var falaAluno = resultado.transcricaoAluno || '(áudio não transcrito)';

  sessao.historico.push({ papel: 'user', texto: falaAluno });
  sessao.historico.push({ papel: 'model', texto: resultado.fala });
  atualizarVinculo_(sessao, resultado);

  return processarDesfechoTurno_(sessionId, sessao, resultado.fala, resultado.status, { transcricaoAluno: falaAluno });
}

/**
 * Atualiza sessao.vinculo/fatoresProtecaoTocados/fatoresRiscoTocados/
 * fatorPrincipalIsolado/errosGravesSessao a partir do autojulgamento da IA
 * neste turno — ver bloco VÍNCULO, FATORES E REGRA DE RIGOR em
 * instrucaoTurno_. Isso é o que trava fim_positivo em
 * processarDesfechoTurno_ até o aluno ter genuinamente coberto o fator
 * principal e os mínimos de fatores de risco/proteção da dificuldade, e o
 * que faz erro grave (nome errado/palavrão) zerar tudo de novo.
 */
function atualizarVinculo_(sessao, resultado) {
  sessao.vinculo = sessao.vinculo || 0;
  sessao.fatoresProtecaoTocados = sessao.fatoresProtecaoTocados || 0;
  sessao.fatoresRiscoTocados = sessao.fatoresRiscoTocados || 0;
  sessao.fatorPrincipalIsolado = !!sessao.fatorPrincipalIsolado;
  sessao.parafraseUsada = !!sessao.parafraseUsada;
  sessao.memoriaLinkadaUsada = !!sessao.memoriaLinkadaUsada;
  sessao.maieuticaOuTeiaUsada = !!sessao.maieuticaOuTeiaUsada;
  sessao.perguntasSimplesRespondidas = sessao.perguntasSimplesRespondidas || 0;
  sessao.perguntasComplexasRespondidas = sessao.perguntasComplexasRespondidas || 0;
  sessao.desistenciaOuSaidaDignaUsada = !!sessao.desistenciaOuSaidaDignaUsada;
  sessao.errosGravesSessao = sessao.errosGravesSessao || [];

  if (resultado.tocouFatorProtecao) {
    sessao.fatoresProtecaoTocados += 1;
    sessao.vinculo += 1;
  }
  if (resultado.tocouFatorRisco) {
    sessao.fatoresRiscoTocados += 1;
  }
  if (resultado.isolouFatorPrincipal) {
    sessao.fatorPrincipalIsolado = true;
  }
  if (resultado.usouParafrase) {
    sessao.parafraseUsada = true;
  }
  if (resultado.usouMemoriaLinkada) {
    sessao.memoriaLinkadaUsada = true;
  }
  if (resultado.usouMaieuticaOuTeia) {
    sessao.maieuticaOuTeiaUsada = true;
  }
  if (resultado.perguntaSimples) {
    sessao.perguntasSimplesRespondidas += 1;
  }
  if (resultado.perguntaComplexa) {
    sessao.perguntasComplexasRespondidas += 1;
  }
  if (resultado.usouDesistenciaOuSaidaDigna) {
    sessao.desistenciaOuSaidaDignaUsada = true;
  }
  if (resultado.eventoNegativo) {
    sessao.vinculo = Math.max(0, sessao.vinculo - 1);
  }
  if (resultado.erroGrave) {
    sessao.vinculo = 0;
    sessao.fatoresProtecaoTocados = 0;
    sessao.fatoresRiscoTocados = 0;
    sessao.fatorPrincipalIsolado = false;
    sessao.parafraseUsada = false;
    sessao.memoriaLinkadaUsada = false;
    sessao.maieuticaOuTeiaUsada = false;
    sessao.perguntasSimplesRespondidas = 0;
    sessao.perguntasComplexasRespondidas = 0;
    sessao.desistenciaOuSaidaDignaUsada = false;
    sessao.errosGravesSessao.push({
      tipo: resultado.tipoErroGrave === 'nome_errado' ? 'nomeErrado' : 'palavrao',
      turno: sessao.historico.length,
    });
  }
}

/** Lógica de desfecho compartilhada entre enviarFala e enviarFalaAudio. */
function processarDesfechoTurno_(sessionId, sessao, falaPersonagem, status, camposExtra) {
  // Trava DURA do tempo mínimo por dificuldade — a instrução no prompt já pede
  // isso à IA, mas não é 100% confiável sozinha (um aluno muito eficiente pode
  // levar o modelo a encerrar cedo demais). Isso garante de verdade que uma
  // dificuldade "difícil" nunca feche em menos de ~8 minutos, por exemplo,
  // não importa o quão bem a conversa esteja indo.
  if (status === 'fim_positivo') {
    var config = configTempoDificuldade_(sessao.dificuldade);
    var vinculoInsuficiente = (sessao.vinculo || 0) < (config.vinculoMinimo || 1);
    // Trava de RIGOR por cobertura real dos 3 pilares da ficha — fator
    // principal sempre exigido, fatores de risco/proteção com mínimo que
    // cresce por dificuldade (ver CONFIG_TEMPO_DIFICULDADE_ e o bloco
    // VÍNCULO, FATORES E REGRA DE RIGOR em instrucaoTurno_). Sem isso, a IA
    // podia aceitar um desfecho positivo só com vínculo genérico, sem o
    // aluno ter de fato acertado os fatores do caso.
    var fatoresInsuficientes =
      !sessao.fatorPrincipalIsolado ||
      (sessao.fatoresProtecaoTocados || 0) < config.minProtecao ||
      (sessao.fatoresRiscoTocados || 0) < config.minRisco;
    // Trava de RIGOR por USO REAL DAS FERRAMENTAS de entrevista — não basta
    // achar os fatores, tem que ter usado praticamente todo o repertório
    // técnico da doutrina (paráfrase, memória linkada, maiêutica/teia,
    // mínimo de perguntas simples/complexas, desistência ou saída digna).
    // Cada exige* em CONFIG_TEMPO_DIFICULDADE_ é opcional conforme a
    // dificuldade — em "dificil" praticamente tudo é obrigatório.
    var ferramentasInsuficientes =
      (sessao.perguntasSimplesRespondidas || 0) < config.minSimples ||
      (sessao.perguntasComplexasRespondidas || 0) < config.minComplexas ||
      (config.exigeParafrase && !sessao.parafraseUsada) ||
      (config.exigeMemoriaLinkada && !sessao.memoriaLinkadaUsada) ||
      (config.exigeMaieuticaOuTeia && !sessao.maieuticaOuTeiaUsada) ||
      (config.exigeDesistenciaOuSaidaDigna && !sessao.desistenciaOuSaidaDignaUsada);
    if (segundosDecorridos_(sessao) < config.minimoAbsolutoSeg || vinculoInsuficiente || fatoresInsuficientes || ferramentasInsuficientes) {
      status = 'fim_positivo_adiado';
    }
  }

  // Trava DURA de TEMPO MÁXIMO — um aluno relatou uma abordagem passando de
  // 40 minutos em "dificil" (meta era 25). Além de perder o efeito
  // pedagógico (a essa altura a cena já deveria ter se resolvido de um jeito
  // ou de outro), cada minuto extra é mais chamadas à IA consumindo crédito.
  // Se a conversa ainda estiver em_andamento (ou tiver acabado de ser adiada
  // pelo gate de fim_positivo acima) e já passou do tempo-alvo máximo da
  // dificuldade, força o encerramento aqui — não deixa se arrastar
  // indefinidamente à espera de um desfecho "perfeito".
  if (status === 'em_andamento' || status === 'fim_positivo_adiado') {
    var configMax = configTempoDificuldade_(sessao.dificuldade);
    if (segundosDecorridos_(sessao) >= configMax.metaMaxSeg) {
      status = 'tempo_esgotado';
    }
  }

  var respostaFinal = Object.assign({ fala: falaPersonagem, status: status }, camposExtra);

  if (status === 'fim_positivo_adiado') {
    respostaFinal.status = 'em_andamento';
    salvarSessao_(sessionId, sessao);
  } else if (status === 'fim_positivo') {
    sessao.status = 'aguardando_avaliacao_positiva';
    salvarSessao_(sessionId, sessao);
    respostaFinal.mensagemSistema = 'FIM DA SIMULAÇÃO. DESISTÊNCIA ACEITA. TENTANTE EM SEGURANÇA.';
    // Avalia automaticamente aqui (igual já acontece no fim_negativo abaixo)
    // — antes disso, o aluno só via a avaliação se clicasse manualmente em
    // "Avaliar", o mesmo botão perigoso que também podia ser clicado sem
    // querer NO MEIO de uma abordagem em andamento e zerar tudo. A
    // avaliação de verdade só deve acontecer automaticamente, no fim real.
    try {
      respostaFinal.avaliacaoAutomatica = avaliarSessao(sessionId, false);
    } catch (erroAvaliacao) {
      respostaFinal.avaliacaoErro = String((erroAvaliacao && erroAvaliacao.message) || erroAvaliacao);
    }
  } else if (status === 'fim_negativo') {
    sessao.status = 'finalizado';
    salvarSessao_(sessionId, sessao);
    respostaFinal.mensagemSistema = 'FIM DA SIMULAÇÃO. VOCÊ NÃO CONSEGUIU TER ÊXITO NA ABORDAGEM. O TENTANTE CONSUMOU O ATO. TREINE MAIS.';
    // Nota forçada a zero: o tentante consumou o ato dentro da ficção — não
    // importa quantos itens de técnica tenham sido pontuados parcialmente,
    // o resultado central da abordagem foi um fracasso.
    try {
      respostaFinal.avaliacaoAutomatica = avaliarSessao(sessionId, false, true);
    } catch (erroAvaliacao) {
      respostaFinal.avaliacaoErro = String((erroAvaliacao && erroAvaliacao.message) || erroAvaliacao);
    }
  } else if (status === 'tempo_esgotado') {
    sessao.status = 'finalizado';
    salvarSessao_(sessionId, sessao);
    respostaFinal.mensagemSistema = 'FIM DA SIMULAÇÃO. TEMPO MÁXIMO DESTA DIFICULDADE ATINGIDO. A ABORDAGEM FOI ENCERRADA AUTOMATICAMENTE.';
    // Nota calculada normalmente (sem forçar zero) — o aluno pode ter feito
    // um bom trabalho técnico mesmo sem ter fechado a cena a tempo; só o
    // tempo em si é o problema aqui, não necessariamente a condução.
    try {
      respostaFinal.avaliacaoAutomatica = avaliarSessao(sessionId, false);
    } catch (erroAvaliacao) {
      respostaFinal.avaliacaoErro = String((erroAvaliacao && erroAvaliacao.message) || erroAvaliacao);
    }
  } else {
    salvarSessao_(sessionId, sessao);
  }

  return respostaFinal;
}

// ============================================================
// AVALIAÇÃO
// ============================================================

var ESQUEMA_AVALIACAO = {
  resultado: 'desistencia_aceita|em_andamento|interrompido',
  linhaEvolucao: [{ falaAluno: '...', reacao: '...' }],
  aproximacaoCalma: 'feito|nao_feito',
  silencioInicial: 'feito|nao_feito',
  apresentacaoPessoal: 'feito|nao_feito',
  respeitouPausas: 'feito|nao_feito',
  ouviuAtentamente: 'feito|parcial|nao_feito|nao_observavel',
  espacoDesabafo: 'feito|nao_feito',
  tomDeVoz: 'adequado|inadequado|nao_observavel',
  perguntasSimplesComplexas: 'feito|parcial|nao_feito',
  parafraseResumida: 'feito|nao_feito',
  memoriaLinkada: 'feito|nao_feito',
  maieuticaOuTeia: 'feito|nao_feito',
  desistenciaOuSaidaDigna: 'feito|nao_feito',
  dominouDialogoRateios: '0 (número inteiro — quantas vezes o aluno "rateou": falou besteira, perdeu o fio, cometeu um deslize claro na condução)',
  conduziuSolucao: 'feito|parcial|nao_feito',
  fatoresProtecaoIdentificados: '0 (número inteiro — quantos dos fatores de proteção da ficha o aluno de fato identificou/explorou na conversa)',
  fatoresRiscoIdentificados: '0 (número inteiro — quantos dos fatores de risco da ficha o aluno de fato identificou/isolou na conversa, sem insistir neles)',
  fatorPrincipal: 'encontrou_isolou|deslizes_leves|insistiu|nao_encontrou',
  errosGraves: {
    segurança: false,
    mentiuOuPrometeuImpossivel: false,
    riu: false,
    seduziu: false,
    perdeuContatoVisual: false,
    levouTerceirosACena: false,
    seguraçaEvidencia: 'trecho curto, se ocorreu',
    mentiuOuPrometeuImpossivelEvidencia: 'trecho curto — ex.: prometeu levar à delegacia/advogado (só é permitido prometer o hospital, para atendimento médico)',
    levouTerceirosACenaEvidencia: 'trecho curto — aceitou levar parente/conhecido até o local da ocorrência',
  },
  fatoresRevelados: 'quais fatores da ficha apareceram na conversa e quais ficaram ocultos',
  acertos: ['acerto concreto 1', 'acerto concreto 2', 'acerto concreto 3'],
  ajustes: [{ observacao: 'o que ajustar', exemploAlternativo: 'frase alternativa curta' }],
};

function avaliarSessao(sessionId, parcial, forcarNotaZero) {
  var sessao = carregarSessao_(sessionId);

  // Evita registrar a mesma tentativa duas vezes (clique duplo, ou avaliação
  // automática do fim negativo seguida de um clique manual em "Avaliar").
  if (!parcial && sessao.ultimoRelatorioFinal) {
    return sessao.ultimoRelatorioFinal;
  }

  var totalProtecao = (sessao.ficha.fatoresProtecao || []).length;
  var totalRisco = (sessao.ficha.fatoresRisco || []).length;

  var instrucao = instrucaoDoutrina_() +
    '\n\nFICHA INTERNA DO CASO:\n' + JSON.stringify(sessao.ficha) +
    '\n\nVocê agora é o AVALIADOR DIDÁTICO (saiu do papel de personagem). Analise TODA a conversa abaixo e ' +
    'classifique cada item da Ficha de Avaliação de Abordagem CATTS I/2026, baseado SOMENTE no que foi observado. ' +
    'Nunca invente condutas que não ocorreram. Em texto (sem vídeo/áudio), marque "nao_observavel" para itens de ' +
    'postura/contato visual que o aluno não descreveu explicitamente. Este caso tem ' + totalProtecao + ' fator(es) ' +
    'de proteção e ' + totalRisco + ' fator(es) de risco na ficha — conte quantos desses o aluno de fato ' +
    'identificou/explorou na conversa (não precisa achar todos pra pontuar parcialmente). ' +
    (parcial ? 'Esta é uma avaliação PARCIAL — a ocorrência não terminou. ' : '') +
    'Responda SOMENTE com um JSON no formato exato: ' + JSON.stringify(ESQUEMA_AVALIACAO);

  var turnos = sessao.historico.concat([{ papel: 'user', texto: 'AVALIAR' }]);
  var avaliacaoIA = chamarGeminiJson_(instrucao, turnos);

  var calculo = calcularNota_(avaliacaoIA, sessao.ficha, sessao.errosGravesSessao);
  // O detalhamento item a item continua real (mostra o que teria sido pontuado),
  // mas a nota final vai a zero — o tentante consumou o ato, então não há
  // pontuação parcial de técnica que compense o resultado central.
  if (forcarNotaZero) calculo.nota = 0;

  var relatorio = {
    resultado: parcial ? 'em_andamento (avaliação parcial)' : avaliacaoIA.resultado,
    nota: calculo.nota,
    detalhamento: calculo.detalhamento,
    errosDetectados: calculo.errosDetectados,
    linhaEvolucao: avaliacaoIA.linhaEvolucao || [],
    fatoresRevelados: avaliacaoIA.fatoresRevelados || '',
    fichaRevelada: sessao.ficha,
    acertos: avaliacaoIA.acertos || [],
    ajustes: avaliacaoIA.ajustes || [],
    tipoTentante: sessao.ficha.perfil,
    dificuldade: sessao.dificuldade,
  };

  if (!parcial) {
    var usuario = buscarUsuario_(sessao.email);
    registrarTentativa_({
      email: sessao.email,
      nome: usuario ? usuario.Nome : '',
      tipoTentante: sessao.ficha.perfil,
      dificuldade: sessao.dificuldade,
      resultado: relatorio.resultado,
      nota: calculo.nota,
      fatorPrincipal: sessao.ficha.fatorPrincipal,
      acertos: relatorio.acertos,
      ajustes: (relatorio.ajustes || []).map(function (a) { return a.observacao; }),
    });
    registrarTranscricao_({
      email: sessao.email,
      nome: usuario ? usuario.Nome : '',
      sessionId: sessionId,
      tipoTentante: sessao.ficha.perfil,
      dificuldade: sessao.dificuldade,
      resultado: relatorio.resultado,
      nota: calculo.nota,
      ficha: sessao.ficha,
      historico: sessao.historico,
    });
    sessao.status = 'finalizado';
    sessao.ultimoRelatorioFinal = relatorio;
    salvarSessao_(sessionId, sessao);
  }

  return relatorio;
}

function pausarEObterResumo(sessionId) {
  var sessao = carregarSessao_(sessionId);
  return { turnos: sessao.historico.length, dificuldade: sessao.dificuldade };
}

/**
 * Retoma uma sessão que já existia (ex.: a página recarregou por causa de um
 * erro de rede no meio da abordagem — sem isso, a conversa inteira se
 * perdia, mesmo com o servidor ainda tendo tudo salvo em cache). Devolve só o
 * necessário para reconstruir a tela do simulador: NÃO devolve a ficha
 * interna oculta nem as imagens (essas não ficam guardadas na sessão).
 */
function retomarSessao(sessionId, email) {
  var sessao = carregarSessao_(sessionId);
  if (normalizarEmail_(email) !== normalizarEmail_(sessao.email)) {
    throw new Error('Esta sessão pertence a outro aluno.');
  }
  return {
    status: sessao.status,
    dificuldade: sessao.dificuldade,
    historico: sessao.historico,
    segundosDecorridos: segundosDecorridos_(sessao),
    tempo: configTempoDificuldade_(sessao.dificuldade),
    voz: {
      genero: (sessao.ficha && sessao.ficha.genero) || 'masculino',
      faixaEtaria: (sessao.ficha && sessao.ficha.faixaEtaria) || 'adulto',
    },
  };
}
/**
 * PaginaPrincipal.gs — GERADO AUTOMATICAMENTE a partir de Index.html.
 * Não edite este arquivo à mão: edite Index.html e regenere.
 */

var PAGINA_PRINCIPAL_B64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sPgo8aGVhZD4KICA8YmFzZSB0YXJnZXQ9Il90b3AiPgogIDxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KICA8c3R5bGU+CiAgICA6cm9vdCB7CiAgICAgIC0tbWFyY2E6ICNjOWEyMjc7CiAgICAgIC0tbWFyY2EtZXNjdXJhOiAjOTY3ODFjOwogICAgICAtLXByZXRvOiAjMTIxMjEyOwogICAgICAtLWRvdXJhZG86ICNkOGJkN2E7CiAgICAgIC0tY2luemE6ICM0YTRkNTI7CiAgICAgIC0tY2luemEtY2xhcm86ICNmNGYzZjE7CiAgICAgIC0tYnJhbmNvOiAjZmZmZmZmOwogICAgICAtLXZlcmRlOiAjMmU3ZDRmOwogICAgICAtLXZlcmRlLWZ1bmRvOiAjZTdmNGVjOwogICAgICAtLWFsZXJ0YTogI2EzMjAyYzsKICAgICAgLS1hbGVydGEtZnVuZG86ICNmYmU4ZTk7CiAgICAgIGZvbnQtZmFtaWx5OiAtYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICJTZWdvZSBVSSIsIFJvYm90bywgSGVsdmV0aWNhLCBBcmlhbCwgc2Fucy1zZXJpZjsKICAgIH0KICAgICogeyBib3gtc2l6aW5nOiBib3JkZXItYm94OyB9CiAgICBpbnB1dFt0eXBlPWNoZWNrYm94XSB7IGFjY2VudC1jb2xvcjogdmFyKC0tbWFyY2EpOyB9CiAgICBib2R5IHsKICAgICAgbWFyZ2luOiAwOwogICAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jaW56YS1jbGFybyk7CiAgICAgIGNvbG9yOiB2YXIoLS1wcmV0byk7CiAgICB9CiAgICBoZWFkZXIgewogICAgICBiYWNrZ3JvdW5kOiBsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCAjMGEwYTBhLCB2YXIoLS1wcmV0bykgNjAlLCB2YXIoLS1tYXJjYS1lc2N1cmEpKTsKICAgICAgYm9yZGVyLWJvdHRvbTogM3B4IHNvbGlkIHZhcigtLW1hcmNhKTsKICAgICAgY29sb3I6IHZhcigtLWJyYW5jbyk7CiAgICAgIHBhZGRpbmc6IDE4cHggMjBweDsKICAgICAgZGlzcGxheTogZmxleDsKICAgICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgICAganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOwogICAgICBmbGV4LXdyYXA6IHdyYXA7CiAgICAgIGdhcDogOHB4OwogICAgfQogICAgaGVhZGVyIGgxIHsKICAgICAgbWFyZ2luOiAwOwogICAgICBmb250LXNpemU6IDIwcHg7CiAgICAgIGxldHRlci1zcGFjaW5nOiAwLjVweDsKICAgIH0KICAgIGhlYWRlciBoMSBzcGFuIHsgY29sb3I6IHZhcigtLWRvdXJhZG8pOyB9CiAgICBoZWFkZXIgLnN1YnRpdHVsbyB7IGZvbnQtc2l6ZTogMTJweDsgb3BhY2l0eTogMC44NTsgbWFyZ2luLXRvcDogMnB4OyB9CiAgICBoZWFkZXIgLmNvbnRhZG9yIHsKICAgICAgZm9udC1zaXplOiAxMnB4OwogICAgICBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LDAuMTIpOwogICAgICBwYWRkaW5nOiA2cHggMTJweDsKICAgICAgYm9yZGVyLXJhZGl1czogMjBweDsKICAgIH0KICAgIG1haW4gewogICAgICBtYXgtd2lkdGg6IDcyMHB4OwogICAgICBtYXJnaW46IDAgYXV0bzsKICAgICAgcGFkZGluZzogMjBweCAxNnB4IDYwcHg7CiAgICB9CiAgICAuY2FydGFvIHsKICAgICAgYmFja2dyb3VuZDogdmFyKC0tYnJhbmNvKTsKICAgICAgYm9yZGVyLXJhZGl1czogMTJweDsKICAgICAgcGFkZGluZzogMjBweDsKICAgICAgbWFyZ2luLWJvdHRvbTogMTZweDsKICAgICAgYm94LXNoYWRvdzogMCAxcHggM3B4IHJnYmEoMCwwLDAsMC4wOCk7CiAgICB9CiAgICBoMiB7IG1hcmdpbi10b3A6IDA7IGZvbnQtc2l6ZTogMTdweDsgfQogICAgaDMgeyBmb250LXNpemU6IDE0cHg7IGNvbG9yOiB2YXIoLS1tYXJjYS1lc2N1cmEpOyB9CiAgICBsYWJlbCB7IGRpc3BsYXk6IGJsb2NrOyBmb250LXNpemU6IDEzcHg7IGZvbnQtd2VpZ2h0OiA2MDA7IG1hcmdpbjogMTBweCAwIDRweDsgfQogICAgaW5wdXRbdHlwZT10ZXh0XSwgaW5wdXRbdHlwZT1lbWFpbF0sIHRleHRhcmVhLCBzZWxlY3QgewogICAgICB3aWR0aDogMTAwJTsKICAgICAgcGFkZGluZzogMTBweDsKICAgICAgYm9yZGVyOiAxcHggc29saWQgI2Q4ZDZkMjsKICAgICAgYm9yZGVyLXJhZGl1czogOHB4OwogICAgICBmb250LXNpemU6IDE0cHg7CiAgICAgIGZvbnQtZmFtaWx5OiBpbmhlcml0OwogICAgfQogICAgdGV4dGFyZWEgeyByZXNpemU6IHZlcnRpY2FsOyB9CiAgICBidXR0b24gewogICAgICBjdXJzb3I6IHBvaW50ZXI7CiAgICAgIGJvcmRlcjogbm9uZTsKICAgICAgYm9yZGVyLXJhZGl1czogOHB4OwogICAgICBwYWRkaW5nOiAxMXB4IDE2cHg7CiAgICAgIGZvbnQtc2l6ZTogMTRweDsKICAgICAgZm9udC13ZWlnaHQ6IDYwMDsKICAgICAgZm9udC1mYW1pbHk6IGluaGVyaXQ7CiAgICAgIC13ZWJraXQtdXNlci1zZWxlY3Q6IG5vbmU7CiAgICAgIHVzZXItc2VsZWN0OiBub25lOwogICAgICAtd2Via2l0LXRvdWNoLWNhbGxvdXQ6IG5vbmU7CiAgICB9CiAgICAuYnRuLXByaW1hcmlvIHsgYmFja2dyb3VuZDogdmFyKC0tbWFyY2EpOyBjb2xvcjogdmFyKC0tcHJldG8pOyB9CiAgICAuYnRuLXByaW1hcmlvOmhvdmVyIHsgYmFja2dyb3VuZDogdmFyKC0tbWFyY2EtZXNjdXJhKTsgY29sb3I6IHZhcigtLWJyYW5jbyk7IH0KICAgIC5idG4tc2VjdW5kYXJpbyB7IGJhY2tncm91bmQ6IHZhcigtLWNpbnphLWNsYXJvKTsgY29sb3I6IHZhcigtLXByZXRvKTsgYm9yZGVyOiAxcHggc29saWQgI2Q4ZDZkMjsgfQogICAgLmJ0bi1zZWN1bmRhcmlvOmhvdmVyIHsgYmFja2dyb3VuZDogI2ViZTllNTsgfQogICAgLmJ0bi1wZXJpZ28geyBiYWNrZ3JvdW5kOiAjN2ExYzFjOyBjb2xvcjogdmFyKC0tYnJhbmNvKTsgfQogICAgYnV0dG9uOmRpc2FibGVkIHsgb3BhY2l0eTogMC41OyBjdXJzb3I6IG5vdC1hbGxvd2VkOyB9CiAgICAubGluaGEtYm90b2VzIHsgZGlzcGxheTogZmxleDsgZ2FwOiA4cHg7IGZsZXgtd3JhcDogd3JhcDsgbWFyZ2luLXRvcDogMTJweDsgfQogICAgLmVzY29uZGlkbyB7IGRpc3BsYXk6IG5vbmUgIWltcG9ydGFudDsgfQogICAgLmF2aXNvIHsgYmFja2dyb3VuZDogI2ZmZjRlNTsgYm9yZGVyOiAxcHggc29saWQgI2YwYzk4NzsgcGFkZGluZzogMTBweCAxMnB4OyBib3JkZXItcmFkaXVzOiA4cHg7IGZvbnQtc2l6ZTogMTNweDsgbWFyZ2luLWJvdHRvbTogMTBweDsgfQogICAgLmVycm8geyBiYWNrZ3JvdW5kOiB2YXIoLS1hbGVydGEtZnVuZG8pOyBib3JkZXI6IDFweCBzb2xpZCAjZTZiM2I2OyBjb2xvcjogIzdhMWMxYzsgcGFkZGluZzogMTBweCAxMnB4OyBib3JkZXItcmFkaXVzOiA4cHg7IGZvbnQtc2l6ZTogMTNweDsgbWFyZ2luLXRvcDogMTBweDsgfQogICAgLnRlcm1vLXRleHRvIHsgbWF4LWhlaWdodDogMjYwcHg7IG92ZXJmbG93LXk6IGF1dG87IGJvcmRlcjogMXB4IHNvbGlkICNlMmUwZGM7IGJvcmRlci1yYWRpdXM6IDhweDsgcGFkZGluZzogMTJweDsgZm9udC1zaXplOiAxM3B4OyBsaW5lLWhlaWdodDogMS41OyBiYWNrZ3JvdW5kOiAjZmFmYWY4OyB9CiAgICAuY2hlY2tib3gtbGluaGEgeyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogZmxleC1zdGFydDsgZ2FwOiA4cHg7IG1hcmdpbi10b3A6IDEycHg7IGZvbnQtc2l6ZTogMTNweDsgfQogICAgLmNoZWNrYm94LWxpbmhhIGlucHV0IHsgbWFyZ2luLXRvcDogM3B4OyB9CiAgICAuc3RhdC1ncmlkIHsgZGlzcGxheTogZ3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiAxZnIgMWZyOyBnYXA6IDEwcHg7IG1hcmdpbjogMTJweCAwOyB9CiAgICAuc3RhdCB7IGJhY2tncm91bmQ6IHZhcigtLWNpbnphLWNsYXJvKTsgYm9yZGVyLXJhZGl1czogOHB4OyBwYWRkaW5nOiAxMHB4IDEycHg7IHRleHQtYWxpZ246IGNlbnRlcjsgfQogICAgLnN0YXQgLm51bSB7IGZvbnQtc2l6ZTogMjJweDsgZm9udC13ZWlnaHQ6IDcwMDsgY29sb3I6IHZhcigtLW1hcmNhLWVzY3VyYSk7IH0KICAgIC5zdGF0IC5sYmwgeyBmb250LXNpemU6IDExcHg7IGNvbG9yOiB2YXIoLS1jaW56YSk7IH0KICAgIC50aXBvLWJhZGdlIHsgZGlzcGxheTogaW5saW5lLWJsb2NrOyBwYWRkaW5nOiAzcHggOXB4OyBib3JkZXItcmFkaXVzOiAyMHB4OyBmb250LXNpemU6IDExcHg7IGZvbnQtd2VpZ2h0OiA3MDA7IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7IH0KICAgIC50aXBvLWFncmVzc2l2byB7IGJhY2tncm91bmQ6ICNmZGUzZTM7IGNvbG9yOiAjYTMyMDJjOyB9CiAgICAudGlwby1kZXByZXNzaXZvIHsgYmFja2dyb3VuZDogI2UzZTlmZDsgY29sb3I6ICMyNjQwOGY7IH0KICAgIC50aXBvLXBzaWNvdGljbyB7IGJhY2tncm91bmQ6ICNmMGUzZmQ7IGNvbG9yOiAjNmEyZmEzOyB9CiAgICAuY2hhdC1sb2cgeyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6IDEwcHg7IG1heC1oZWlnaHQ6IDUwdmg7IG92ZXJmbG93LXk6IGF1dG87IHBhZGRpbmc6IDRweCAycHg7IG1hcmdpbi1ib3R0b206IDEycHg7IH0KICAgIC5pbWFnZW0tY2VuYSB7IHdpZHRoOiAxMDAlOyBtYXgtaGVpZ2h0OiAyNjBweDsgb2JqZWN0LWZpdDogY292ZXI7IGJvcmRlci1yYWRpdXM6IDEwcHg7IG1hcmdpbi1ib3R0b206IDRweDsgfQogICAgLnN0YXR1cy1jb252ZXJzYSB7IHRleHQtYWxpZ246IGNlbnRlcjsgcGFkZGluZzogMzZweCAxNnB4OyBtYXJnaW4tYm90dG9tOiAxMnB4OyBiYWNrZ3JvdW5kOiB2YXIoLS1jaW56YS1jbGFybyk7IGJvcmRlci1yYWRpdXM6IDEycHg7IH0KICAgIC5zdGF0dXMtaWNvbmUgeyBmb250LXNpemU6IDQ2cHg7IG1hcmdpbi1ib3R0b206IDEwcHg7IH0KICAgIC5zdGF0dXMtaWNvbmUuZmFsYW5kbyB7IGFuaW1hdGlvbjogcHVsc2FyIDFzIGluZmluaXRlOyB9CiAgICAuc3RhdHVzLXRleHRvIHsgZm9udC1zaXplOiAxNXB4OyBmb250LXdlaWdodDogNjAwOyBjb2xvcjogdmFyKC0tY2luemEpOyB9CiAgICAuYm9saGEgeyBtYXgtd2lkdGg6IDg1JTsgcGFkZGluZzogMTBweCAxM3B4OyBib3JkZXItcmFkaXVzOiAxMnB4OyBmb250LXNpemU6IDE0cHg7IGxpbmUtaGVpZ2h0OiAxLjQ7IHdoaXRlLXNwYWNlOiBwcmUtd3JhcDsgfQogICAgLmJvbGhhLXNpc3RlbWEgeyBhbGlnbi1zZWxmOiBjZW50ZXI7IGJhY2tncm91bmQ6IHZhcigtLXByZXRvKTsgY29sb3I6IHZhcigtLWJyYW5jbyk7IGZvbnQtc2l6ZTogMTJweDsgdGV4dC1hbGlnbjogY2VudGVyOyBtYXgtd2lkdGg6IDEwMCU7IH0KICAgIC5ib2xoYS10ZW50YW50ZSB7IGFsaWduLXNlbGY6IGZsZXgtc3RhcnQ7IGJhY2tncm91bmQ6ICNlY2VhZTY7IGJvcmRlci1ib3R0b20tbGVmdC1yYWRpdXM6IDJweDsgfQogICAgLmJvbGhhLWFsdW5vIHsgYWxpZ24tc2VsZjogZmxleC1lbmQ7IGJhY2tncm91bmQ6IHZhcigtLXByZXRvKTsgY29sb3I6IHZhcigtLW1hcmNhKTsgYm9yZGVyLWJvdHRvbS1yaWdodC1yYWRpdXM6IDJweDsgfQogICAgLmJvbGhhLWZpbS1wb3NpdGl2byB7IGFsaWduLXNlbGY6IGNlbnRlcjsgYmFja2dyb3VuZDogdmFyKC0tdmVyZGUtZnVuZG8pOyBjb2xvcjogdmFyKC0tdmVyZGUpOyBmb250LXdlaWdodDogNzAwOyB0ZXh0LWFsaWduOiBjZW50ZXI7IG1heC13aWR0aDogMTAwJTsgYm9yZGVyOiAxcHggc29saWQgI2I4ZGZjNjsgfQogICAgLmJvbGhhLWZpbS1uZWdhdGl2byB7IGFsaWduLXNlbGY6IGNlbnRlcjsgYmFja2dyb3VuZDogdmFyKC0tYWxlcnRhLWZ1bmRvKTsgY29sb3I6ICM3YTFjMWM7IGZvbnQtd2VpZ2h0OiA3MDA7IHRleHQtYWxpZ246IGNlbnRlcjsgbWF4LXdpZHRoOiAxMDAlOyBib3JkZXI6IDFweCBzb2xpZCAjZTZiM2I2OyB9CiAgICAuZW50cmFkYS1jaGF0IHsgZGlzcGxheTogZmxleDsgZ2FwOiA4cHg7IH0KICAgIC5lbnRyYWRhLWNoYXQgdGV4dGFyZWEgeyBmbGV4OiAxOyBtaW4taGVpZ2h0OiA0NHB4OyB9CiAgICAuZW50cmFkYS1hdWRpbyB7IGRpc3BsYXk6IGZsZXg7IGdhcDogOHB4OyBhbGlnbi1pdGVtczogc3RyZXRjaDsgbWFyZ2luLWJvdHRvbTogOHB4OyB9CiAgICAuYmFycmEtZ3JhdmFyIHsKICAgICAgZmxleDogMTsKICAgICAgbWluLWhlaWdodDogNjJweDsKICAgICAgYmFja2dyb3VuZDogdmFyKC0tY2luemEtY2xhcm8pOwogICAgICBib3JkZXI6IDJweCBzb2xpZCAjZDhkNmQyOwogICAgICBib3JkZXItcmFkaXVzOiAxNnB4OwogICAgICBkaXNwbGF5OiBmbGV4OwogICAgICBhbGlnbi1pdGVtczogY2VudGVyOwogICAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsKICAgICAgZ2FwOiAxMHB4OwogICAgICBmb250LXdlaWdodDogNzAwOwogICAgICBmb250LXNpemU6IDE1cHg7CiAgICAgIGNvbG9yOiB2YXIoLS1jaW56YSk7CiAgICAgIHRvdWNoLWFjdGlvbjogbm9uZTsKICAgICAgLXdlYmtpdC11c2VyLXNlbGVjdDogbm9uZTsKICAgICAgdXNlci1zZWxlY3Q6IG5vbmU7CiAgICAgIC13ZWJraXQtdG91Y2gtY2FsbG91dDogbm9uZTsKICAgIH0KICAgIC5iYXJyYS1ncmF2YXIgLmJhcnJhLWljb25lIHsgZm9udC1zaXplOiAyMnB4OyB9CiAgICAuYmFycmEtZ3JhdmFyLmdyYXZhbmRvIHsgYmFja2dyb3VuZDogdmFyKC0tbWFyY2EpOyBjb2xvcjogdmFyKC0tcHJldG8pOyBib3JkZXItY29sb3I6IHZhcigtLW1hcmNhLWVzY3VyYSk7IH0KICAgIC5iYXJyYS1ncmF2YXIuY2FuY2VsYW5kbyB7IGJhY2tncm91bmQ6IHZhcigtLWFsZXJ0YSk7IGNvbG9yOiB2YXIoLS1icmFuY28pOyBib3JkZXItY29sb3I6ICM3YTFjMWM7IH0KICAgIC5iYXJyYS1ncmF2YXIuaW5kaXNwb25pdmVsIHsgb3BhY2l0eTogMC41NTsgfQogICAgI2J0bkRpZ2l0YXIgeyBmbGV4OiAwIDAgYXV0bzsgZm9udC1zaXplOiAyMHB4OyBwYWRkaW5nOiAwIDE2cHg7IH0KICAgIEBrZXlmcmFtZXMgcHVsc2FyIHsgMCUsMTAwJXtvcGFjaXR5OjE7fSA1MCV7b3BhY2l0eTowLjY7fSB9CiAgICB0YWJsZSB7IHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyBmb250LXNpemU6IDEzcHg7IG1hcmdpbi10b3A6IDhweDsgfQogICAgdGgsIHRkIHsgdGV4dC1hbGlnbjogbGVmdDsgcGFkZGluZzogN3B4IDhweDsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkICNlYWU4ZTQ7IH0KICAgIHRoIHsgY29sb3I6IHZhcigtLWNpbnphKTsgZm9udC1zaXplOiAxMXB4OyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyB9CiAgICAubm90YS1ncmFuZGUgeyBmb250LXNpemU6IDQ2cHg7IGZvbnQtd2VpZ2h0OiA4MDA7IGNvbG9yOiB2YXIoLS1tYXJjYS1lc2N1cmEpOyB0ZXh0LWFsaWduOiBjZW50ZXI7IH0KICAgIC5hYmFzIHsgZGlzcGxheTogZmxleDsgZ2FwOiA2cHg7IG1hcmdpbi1ib3R0b206IDEycHg7IGZsZXgtd3JhcDogd3JhcDsgfQogICAgLmFiYS1idG4geyBiYWNrZ3JvdW5kOiB2YXIoLS1jaW56YS1jbGFybyk7IGJvcmRlcjogMXB4IHNvbGlkICNkOGQ2ZDI7IHBhZGRpbmc6IDdweCAxMnB4OyBib3JkZXItcmFkaXVzOiAyMHB4OyBmb250LXNpemU6IDEycHg7IH0KICAgIC5hYmEtYnRuLmF0aXZhIHsgYmFja2dyb3VuZDogdmFyKC0tbWFyY2EpOyBjb2xvcjogdmFyKC0tcHJldG8pOyBib3JkZXItY29sb3I6IHZhcigtLW1hcmNhKTsgZm9udC13ZWlnaHQ6IDcwMDsgfQogICAgLmNhcnJlZ2FuZG8geyB0ZXh0LWFsaWduOiBjZW50ZXI7IHBhZGRpbmc6IDMwcHg7IGNvbG9yOiB2YXIoLS1jaW56YSk7IGZvbnQtc2l6ZTogMTNweDsgfQogICAgLml0ZW0tdmVyZGljdCB7IGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsgZm9udC1zaXplOiAxMnB4OyBwYWRkaW5nOiA0cHggMDsgYm9yZGVyLWJvdHRvbTogMXB4IGRhc2hlZCAjZWVlOyB9CiAgICAucG9udG9zLXBvcyB7IGNvbG9yOiB2YXIoLS12ZXJkZSk7IGZvbnQtd2VpZ2h0OiA3MDA7IH0KICAgIC5wb250b3MtbmVnIHsgY29sb3I6ICNhMzIwMmM7IGZvbnQtd2VpZ2h0OiA3MDA7IH0KICAgIC5wb250b3MtemVybyB7IGNvbG9yOiB2YXIoLS1jaW56YSk7IH0KICAgIC5saXN0YS1saWJlcmFkb3MtaXRlbSwgLmxpc3RhLWNhc29zLWl0ZW0geyBib3JkZXI6IDFweCBzb2xpZCAjZWFlOGU0OyBib3JkZXItcmFkaXVzOiA4cHg7IHBhZGRpbmc6IDEwcHg7IG1hcmdpbi1ib3R0b206IDhweDsgZm9udC1zaXplOiAxM3B4OyB9CiAgICAubGlzdGEtbGliZXJhZG9zLWl0ZW0gLnRvcG8sIC5saXN0YS1jYXNvcy1pdGVtIC50b3BvIHsgZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDsgfQogICAgLnJvZGFwZS1ub3RhIHsgZm9udC1zaXplOiAxMXB4OyBjb2xvcjogdmFyKC0tY2luemEpOyBtYXJnaW4tdG9wOiAzMHB4OyB0ZXh0LWFsaWduOiBjZW50ZXI7IH0KICA8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5PgoKPGhlYWRlcj4KICA8ZGl2PgogICAgPGgxPlRTRSDigJQgPHNwYW4+VHJlaW5hbWVudG8gU3VjZXNzb3JlcyBkZSDDiWxwaXM8L3NwYW4+PC9oMT4KICAgIDxkaXYgY2xhc3M9InN1YnRpdHVsbyI+U2ltdWxhZG9yIGRlIEFib3JkYWdlbSBUw6ljbmljYSBhIFRlbnRhdGl2YSBkZSBTdWljw61kaW8gwrcgQ0FUVFMgMjAyNiDCtyBDQk1FUko8L2Rpdj4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJjb250YWRvciIgaWQ9ImNvbnRhZG9yR2xvYmFsIj5jYXJyZWdhbmRvIGNvbnRhZG9y4oCmPC9kaXY+CjwvaGVhZGVyPgoKPG1haW4+CgogIDwhLS0gVEVMQTogTE9HSU4gLS0+CiAgPHNlY3Rpb24gaWQ9InRlbGEtbG9naW4iIGNsYXNzPSJjYXJ0YW8iPgogICAgPGgyPkVudHJhcjwvaDI+CiAgICA8cCBzdHlsZT0iZm9udC1zaXplOjEzcHg7Y29sb3I6dmFyKC0tY2luemEpIj5BY2Vzc28gcmVzdHJpdG8gYW9zIGFsdW5vcyBsaWJlcmFkb3MgaW5kaXZpZHVhbG1lbnRlIHBlbG8gaW5zdHJ1dG9yLiBTZSBzZXUgZS1tYWlsIGFpbmRhIG7Do28gZm9pIGxpYmVyYWRvLCBzb2xpY2l0ZSBhbyBpbnN0cnV0b3IgZG8gY3Vyc28uPC9wPgogICAgPGxhYmVsPk5vbWUgY29tcGxldG88L2xhYmVsPgogICAgPGlucHV0IHR5cGU9InRleHQiIGlkPSJsb2dpbk5vbWUiIHBsYWNlaG9sZGVyPSJTZXUgbm9tZSI+CiAgICA8bGFiZWw+TWF0csOtY3VsYSAob3BjaW9uYWwpPC9sYWJlbD4KICAgIDxpbnB1dCB0eXBlPSJ0ZXh0IiBpZD0ibG9naW5NYXRyaWN1bGEiIHBsYWNlaG9sZGVyPSJTdWEgbWF0csOtY3VsYS9SRSI+CiAgICA8bGFiZWw+RGlnaXRlIHVtIGUtbWFpbCBhdXRvcml6YWRvPC9sYWJlbD4KICAgIDxpbnB1dCB0eXBlPSJlbWFpbCIgaWQ9ImxvZ2luRW1haWwiIHBsYWNlaG9sZGVyPSJzZXVlbWFpbEBleGVtcGxvLmNvbSI+CiAgICA8ZGl2IGNsYXNzPSJsaW5oYS1ib3RvZXMiPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tcHJpbWFyaW8iIG9uY2xpY2s9InRlbnRhckVudHJhcigpIj5FbnRyYXI8L2J1dHRvbj4KICAgIDwvZGl2PgogICAgPGRpdiBpZD0ibG9naW5FcnJvIj48L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gVEVMQTogVEVSTU8gREUgQ09OU0VOVElNRU5UTyAtLT4KICA8c2VjdGlvbiBpZD0idGVsYS10ZXJtbyIgY2xhc3M9ImNhcnRhbyBlc2NvbmRpZG8iPgogICAgPGgyPlRlcm1vIGRlIENvbnNlbnRpbWVudG8gZSBSZXNwb25zYWJpbGlkYWRlPC9oMj4KICAgIDxkaXYgY2xhc3M9InRlcm1vLXRleHRvIj4KICAgICAgPHA+PHN0cm9uZz4xLiBOYXR1cmV6YSBkYSBmZXJyYW1lbnRhLjwvc3Ryb25nPiBPIFRTRSDigJQgVHJlaW5hbWVudG8gU3VjZXNzb3JlcyBkZSDDiWxwaXMgw6kgdW0gZXhlcmPDrWNpbyBmaWN0w61jaW8gZGUgdHJlaW5vIGRlIGNvbXVuaWNhw6fDo28gcGFyYSBhIEFib3JkYWdlbSBUw6ljbmljYSBhIFRlbnRhdGl2YSBkZSBTdWljw61kaW8gKENBVFRTIDIwMjYsIENCTUVSSikuIEFzIG9jb3Jyw6puY2lhcywgcGVyc29uYWdlbnMgZSBkacOhbG9nb3Mgc8OjbyBpbnRlaXJhbWVudGUgZ2VyYWRvcyBwb3IgaW50ZWxpZ8OqbmNpYSBhcnRpZmljaWFsIHBhcmEgZmlucyBkaWTDoXRpY29zLiBFc3RhIGZlcnJhbWVudGEgTsODTyDDqSBkb3V0cmluYSBvZmljaWFsLCBOw4NPIHN1YnN0aXR1aSBpbnN0cnV0b3JlcywgcHJvdG9jb2xvcyBvcGVyYWNpb25haXMgdmlnZW50ZXMsIHN1cGVydmlzw6NvIHByZXNlbmNpYWwsIGF0ZW5kaW1lbnRvIGNsw61uaWNvIG91IHBzaXF1acOhdHJpY28sIGUgYSBub3RhIGV4aWJpZGEgw6kgdW1hIGVzdGltYXRpdmEgZGlkw6F0aWNhLCBuw6NvIGEgbm90YSBvZmljaWFsIGRvIGN1cnNvLjwvcD4KICAgICAgPHA+PHN0cm9uZz4yLiBDb250ZcO6ZG8gc2Vuc8OtdmVsLjwvc3Ryb25nPiBPIHRlbWEgdHJhdGFkbyDDqSBncmF2ZSBlIHBvZGUgc2VyIGVtb2Npb25hbG1lbnRlIGRlc2dhc3RhbnRlLiBTZSBlbSBhbGd1bSBtb21lbnRvIHZvY8OqIHNlbnRpciBzb2ZyaW1lbnRvIGdlbnXDrW5vIChuw6NvIHJlbGFjaW9uYWRvIGFvIHBlcnNvbmFnZW0gZmljdMOtY2lvKSwgaW50ZXJyb21wYSBvIHVzbyBlIHByb2N1cmUgYXBvaW8g4oCUIENlbnRybyBkZSBWYWxvcml6YcOnw6NvIGRhIFZpZGEgKENWVik6IDE4OCwgbGlnYcOnw6NvIGUgY2hhdCBncmF0dWl0b3MsIDI0aCwgY3Z2Lm9yZy5ici48L3A+CiAgICAgIDxwPjxzdHJvbmc+My4gQ29uZmlkZW5jaWFsaWRhZGUgZSB1c28gcmVzdHJpdG8uPC9zdHJvbmc+IE8gYWNlc3NvIGEgZXN0YSBmZXJyYW1lbnRhIMOpIHBlc3NvYWwgZSBpbnRyYW5zZmVyw612ZWwsIGxpYmVyYWRvIGluZGl2aWR1YWxtZW50ZSBwZWxvIGluc3RydXRvci4gQW8gYWNlaXRhciBlc3RlIHRlcm1vLCB2b2PDqiBjb25jb3JkYSBlbTo8L3A+CiAgICAgIDx1bD4KICAgICAgICA8bGk+TsOjbyBjb21wYXJ0aWxoYXIgc2V1IGFjZXNzbywgbGluayBvdSBjcmVkZW5jaWFpcyBjb20gdGVyY2Vpcm9zOzwvbGk+CiAgICAgICAgPGxpPk7Do28gZGl2dWxnYXIsIHJlcHJvZHV6aXIgb3UgZGlzdHJpYnVpciBlc3RhIGZlcnJhbWVudGEsIHNldSBjb250ZcO6ZG8gb3Ugc2V1cyBtYXRlcmlhaXMgZGUgYXBvaW8gc2VtIGF1dG9yaXphw6fDo28gZXhwcmVzc2EgZG8gaW5zdHJ1dG9yOzwvbGk+CiAgICAgICAgPGxpPlV0aWxpemFyIGEgZmVycmFtZW50YSBleGNsdXNpdmFtZW50ZSBwYXJhIGZpbnMgZGUgdHJlaW5vIHBlc3NvYWwgbm8gw6JtYml0byBkbyBjdXJzbyBDQVRUUyAyMDI2LjwvbGk+CiAgICAgIDwvdWw+CiAgICAgIDxwPjxzdHJvbmc+NC4gRGFkb3MgYXJtYXplbmFkb3MuPC9zdHJvbmc+IE5vbWUsIG1hdHLDrWN1bGEsIGUtbWFpbCBlIG8gaGlzdMOzcmljbyBkZSBub3Rhcy9yZXN1bHRhZG9zIGRlIHN1YXMgc2ltdWxhw6fDtWVzIHPDo28gYXJtYXplbmFkb3MgcGFyYSBmaW5zIGRlIGFjb21wYW5oYW1lbnRvIHBlZGFnw7NnaWNvIGRvIGN1cnNvIGUgY8OhbGN1bG8gZGUgcmFua2luZy4gTyBkZXNjdW1wcmltZW50byBkZXN0ZSB0ZXJtbyBwb2RlIGxldmFyIMOgIHJldm9nYcOnw6NvIGRvIHNldSBhY2Vzc28uPC9wPgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJjaGVja2JveC1saW5oYSI+CiAgICAgIDxpbnB1dCB0eXBlPSJjaGVja2JveCIgaWQ9InRlcm1vQWNlaXRlIj4KICAgICAgPGxhYmVsIGZvcj0idGVybW9BY2VpdGUiIHN0eWxlPSJtYXJnaW46MDtmb250LXdlaWdodDo0MDAiPkxpIGUgY29uY29yZG8gY29tIG9zIHRlcm1vcyBhY2ltYS48L2xhYmVsPgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJsaW5oYS1ib3RvZXMiPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tcHJpbWFyaW8iIGlkPSJidG5BY2VpdGFyVGVybW8iIGRpc2FibGVkIG9uY2xpY2s9ImFjZWl0YXJUZXJtbygpIj5BY2VpdGFyIGUgY29udGludWFyPC9idXR0b24+CiAgICA8L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gVEVMQTogTUVOVSAtLT4KICA8c2VjdGlvbiBpZD0idGVsYS1tZW51IiBjbGFzcz0iY2FydGFvIGVzY29uZGlkbyI+CiAgICA8aDI+T2zDoSwgPHNwYW4gaWQ9Im1lbnVOb21lIj48L3NwYW4+PC9oMj4KICAgIDxkaXYgY2xhc3M9InN0YXQtZ3JpZCI+CiAgICAgIDxkaXYgY2xhc3M9InN0YXQiPjxkaXYgY2xhc3M9Im51bSIgaWQ9Im1lbnVUb3RhbEFib3JkYWdlbnMiPjA8L2Rpdj48ZGl2IGNsYXNzPSJsYmwiPnN1YXMgYWJvcmRhZ2VuczwvZGl2PjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJzdGF0Ij48ZGl2IGNsYXNzPSJudW0iIGlkPSJtZW51TWVsaG9yTm90YSI+4oCUPC9kaXY+PGRpdiBjbGFzcz0ibGJsIj5zdWEgbWVsaG9yIG5vdGE8L2Rpdj48L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0ibGluaGEtYm90b2VzIj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXByaW1hcmlvIiBvbmNsaWNrPSJtb3N0cmFyVGVsYSgndGVsYS1kaWZpY3VsZGFkZScpIj5Ob3ZhIEFib3JkYWdlbTwvYnV0dG9uPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tc2VjdW5kYXJpbyIgb25jbGljaz0iYWJyaXJSYW5raW5nKCkiPlJhbmtpbmc8L2J1dHRvbj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXNlY3VuZGFyaW8gZXNjb25kaWRvIiBpZD0iYnRuUGFpbmVsQWRtaW4iIG9uY2xpY2s9ImFicmlyQWRtaW4oKSI+UGFpbmVsIGRvIEluc3RydXRvcjwvYnV0dG9uPgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJsaW5oYS1ib3RvZXMiPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tc2VjdW5kYXJpbyIgb25jbGljaz0ic2FpcigpIj5TYWlyPC9idXR0b24+CiAgICA8L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gVEVMQTogRVNDT0xIRVIgRElGSUNVTERBREUgLS0+CiAgPHNlY3Rpb24gaWQ9InRlbGEtZGlmaWN1bGRhZGUiIGNsYXNzPSJjYXJ0YW8gZXNjb25kaWRvIj4KICAgIDxoMj5Ob3ZhIG9jb3Jyw6puY2lhPC9oMj4KICAgIDxwIHN0eWxlPSJmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1jaW56YSkiPk8gcGVyZmlsIGRvIHRlbnRhbnRlIChhZ3Jlc3Npdm8sIGRlcHJlc3Npdm8gb3UgcHNpY8OzdGljbykgw6kgc29ydGVhZG8gYXV0b21hdGljYW1lbnRlIGUgc8OzIHNlcsOhIHJldmVsYWRvIG5hIGF2YWxpYcOnw6NvIGZpbmFsLjwvcD4KICAgIDxsYWJlbD5EaWZpY3VsZGFkZTwvbGFiZWw+CiAgICA8c2VsZWN0IGlkPSJzZWxlY3REaWZpY3VsZGFkZSI+CiAgICAgIDxvcHRpb24gdmFsdWU9ImZhY2lsIj5Gw6FjaWw8L29wdGlvbj4KICAgICAgPG9wdGlvbiB2YWx1ZT0ibWVkaWEiIHNlbGVjdGVkPk3DqWRpYTwvb3B0aW9uPgogICAgICA8b3B0aW9uIHZhbHVlPSJkaWZpY2lsIj5EaWbDrWNpbDwvb3B0aW9uPgogICAgPC9zZWxlY3Q+CiAgICA8ZGl2IGNsYXNzPSJsaW5oYS1ib3RvZXMiPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tcHJpbWFyaW8iIG9uY2xpY2s9ImluaWNpYXJOb3ZvQ2FzbygpIj5Db21lw6dhcjwvYnV0dG9uPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tc2VjdW5kYXJpbyIgb25jbGljaz0ibW9zdHJhclRlbGEoJ3RlbGEtbWVudScpIj5Wb2x0YXI8L2J1dHRvbj4KICAgIDwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBURUxBOiBTSU1VTEFET1IgLS0+CiAgPHNlY3Rpb24gaWQ9InRlbGEtc2ltdWxhZG9yIiBjbGFzcz0iY2FydGFvIGVzY29uZGlkbyI+CiAgICA8aDI+T2NvcnLDqm5jaWEgZW0gYW5kYW1lbnRvPC9oMj4KICAgIDxkaXYgY2xhc3M9ImNoYXQtbG9nIiBpZD0iYnJpZWZpbmdDZW5hIj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImNoYXQtbG9nIGVzY29uZGlkbyIgaWQ9ImNoYXRMb2ciPjwvZGl2PgogICAgPGRpdiBjbGFzcz0ic3RhdHVzLWNvbnZlcnNhIGVzY29uZGlkbyIgaWQ9InN0YXR1c0NvbnZlcnNhIj4KICAgICAgPGRpdiBjbGFzcz0ic3RhdHVzLWljb25lIiBpZD0ic3RhdHVzSWNvbmUiPvCfjpnvuI88L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0ic3RhdHVzLXRleHRvIiBpZD0ic3RhdHVzVGV4dG8iPlN1YSB2ZXogZGUgZmFsYXI8L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0iZW50cmFkYS1hdWRpbyI+CiAgICAgIDxkaXYgY2xhc3M9ImJhcnJhLWdyYXZhciIgaWQ9ImJhcnJhR3JhdmFyIj4KICAgICAgICA8c3BhbiBjbGFzcz0iYmFycmEtaWNvbmUiIGlkPSJiYXJyYUljb25lIj7wn46kPC9zcGFuPgogICAgICAgIDxzcGFuIGNsYXNzPSJiYXJyYS10ZXh0byIgaWQ9ImJhcnJhVGV4dG8iPlNlZ3VyZSBwYXJhIGZhbGFyPC9zcGFuPgogICAgICA8L2Rpdj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXNlY3VuZGFyaW8iIGlkPSJidG5EaWdpdGFyIiBvbmNsaWNrPSJhbHRlcm5hck1vZG9EaWdpdGFyKCkiIHRpdGxlPSJEaWdpdGFyIGVtIHZleiBkZSBmYWxhciI+4oyo77iPPC9idXR0b24+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImVudHJhZGEtY2hhdCBlc2NvbmRpZG8iIGlkPSJlbnRyYWRhVGV4dG8iPgogICAgICA8dGV4dGFyZWEgaWQ9ImNhbXBvRmFsYSIgcGxhY2Vob2xkZXI9IkZhbGUgY29tbyBvIGFib3JkYWRvci4uLiIgb25rZXlkb3duPSJpZihldmVudC5rZXk9PT0nRW50ZXInJiYhZXZlbnQuc2hpZnRLZXkpe2V2ZW50LnByZXZlbnREZWZhdWx0KCk7ZW52aWFyRmFsYUFsdW5vKCk7fSI+PC90ZXh0YXJlYT4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXByaW1hcmlvIiBpZD0iYnRuRW52aWFyIiBvbmNsaWNrPSJlbnZpYXJGYWxhQWx1bm8oKSI+RW52aWFyPC9idXR0b24+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImxpbmhhLWJvdG9lcyI+CiAgICAgIDxsYWJlbCBzdHlsZT0iZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2ZvbnQtd2VpZ2h0OjQwMDtmb250LXNpemU6MTJweDttYXJnaW46MCI+CiAgICAgICAgPGlucHV0IHR5cGU9ImNoZWNrYm94IiBpZD0iY2hrVm96IiBjaGVja2VkIG9uY2hhbmdlPSJpZighdGhpcy5jaGVja2VkKSB3aW5kb3cuc3BlZWNoU3ludGhlc2lzICYmIHdpbmRvdy5zcGVlY2hTeW50aGVzaXMuY2FuY2VsKCk7Ij4g8J+UiiBWb3ogZG8gdGVudGFudGUKICAgICAgPC9sYWJlbD4KICAgICAgPGxhYmVsIHN0eWxlPSJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7Zm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4O21hcmdpbjowIj4KICAgICAgICA8aW5wdXQgdHlwZT0iY2hlY2tib3giIGlkPSJjaGtNb3N0cmFyVGV4dG8iIG9uY2hhbmdlPSJkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2hhdExvZycpLmNsYXNzTGlzdC50b2dnbGUoJ2VzY29uZGlkbycsICF0aGlzLmNoZWNrZWQpIj4g8J+Rge+4jyBNb3N0cmFyIHRleHRvIGRhIGNvbnZlcnNhCiAgICAgIDwvbGFiZWw+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImxpbmhhLWJvdG9lcyI+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1zZWN1bmRhcmlvIiBvbmNsaWNrPSJwZWRpckF2YWxpYWNhbyhmYWxzZSkiPkF2YWxpYXI8L2J1dHRvbj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXNlY3VuZGFyaW8iIG9uY2xpY2s9Im1vc3RyYXJUZWxhKCd0ZWxhLWRpZmljdWxkYWRlJykiPk5vdm8gQ2Vuw6FyaW88L2J1dHRvbj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXNlY3VuZGFyaW8iIG9uY2xpY2s9Im1vc3RyYXJUZWxhKCd0ZWxhLW1lbnUnKSI+Vm9sdGFyIGFvIE1lbnU8L2J1dHRvbj4KICAgIDwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBURUxBOiBSRUxBVMOTUklPIC0tPgogIDxzZWN0aW9uIGlkPSJ0ZWxhLXJlbGF0b3JpbyIgY2xhc3M9ImNhcnRhbyBlc2NvbmRpZG8iPgogICAgPGgyPkF2YWxpYcOnw6NvIGRhIGFib3JkYWdlbTwvaDI+CiAgICA8ZGl2IGlkPSJyZWxhdG9yaW9Db250ZXVkbyI+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJsaW5oYS1ib3RvZXMiPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tcHJpbWFyaW8iIG9uY2xpY2s9Im1vc3RyYXJUZWxhKCd0ZWxhLWRpZmljdWxkYWRlJykiPk5vdmEgQWJvcmRhZ2VtPC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1zZWN1bmRhcmlvIiBvbmNsaWNrPSJhYnJpclJhbmtpbmcoKSI+VmVyIFJhbmtpbmc8L2J1dHRvbj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXNlY3VuZGFyaW8iIG9uY2xpY2s9Im1vc3RyYXJUZWxhKCd0ZWxhLW1lbnUnKSI+Vm9sdGFyIGFvIE1lbnU8L2J1dHRvbj4KICAgIDwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBURUxBOiBSQU5LSU5HIC0tPgogIDxzZWN0aW9uIGlkPSJ0ZWxhLXJhbmtpbmciIGNsYXNzPSJjYXJ0YW8gZXNjb25kaWRvIj4KICAgIDxoMj5SYW5raW5nPC9oMj4KICAgIDxkaXYgY2xhc3M9ImFiYXMiIGlkPSJhYmFzUmFua2luZyI+CiAgICAgIDxidXR0b24gY2xhc3M9ImFiYS1idG4gYXRpdmEiIG9uY2xpY2s9ImNhcnJlZ2FyUmFua2luZygnZ2VyYWwnLCB0aGlzKSI+R2VyYWw8L2J1dHRvbj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYWJhLWJ0biIgb25jbGljaz0iY2FycmVnYXJSYW5raW5nKCdhZ3Jlc3Npdm8nLCB0aGlzKSI+QWdyZXNzaXZvPC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImFiYS1idG4iIG9uY2xpY2s9ImNhcnJlZ2FyUmFua2luZygnZGVwcmVzc2l2bycsIHRoaXMpIj5EZXByZXNzaXZvPC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImFiYS1idG4iIG9uY2xpY2s9ImNhcnJlZ2FyUmFua2luZygncHNpY290aWNvJywgdGhpcykiPlBzaWPDs3RpY288L2J1dHRvbj4KICAgIDwvZGl2PgogICAgPGRpdiBpZD0icmFua2luZ0NvbnRldWRvIiBjbGFzcz0iY2FycmVnYW5kbyI+Y2FycmVnYW5kb+KApjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibGluaGEtYm90b2VzIj48YnV0dG9uIGNsYXNzPSJidG4tc2VjdW5kYXJpbyIgb25jbGljaz0ibW9zdHJhclRlbGEoJ3RlbGEtbWVudScpIj5Wb2x0YXI8L2J1dHRvbj48L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gVEVMQTogQURNSU4gLS0+CiAgPHNlY3Rpb24gaWQ9InRlbGEtYWRtaW4iIGNsYXNzPSJjYXJ0YW8gZXNjb25kaWRvIj4KICAgIDxoMj5QYWluZWwgZG8gSW5zdHJ1dG9yPC9oMj4KCiAgICA8aDM+TGliZXJhciBhY2Vzc288L2gzPgogICAgPGxhYmVsPkUtbWFpbCBkbyBhbHVubzwvbGFiZWw+CiAgICA8aW5wdXQgdHlwZT0iZW1haWwiIGlkPSJhZG1pbk5vdm9FbWFpbCIgcGxhY2Vob2xkZXI9ImFsdW5vQGV4ZW1wbG8uY29tIj4KICAgIDxsYWJlbD5PYnNlcnZhw6fDo28gKG9wY2lvbmFsKTwvbGFiZWw+CiAgICA8aW5wdXQgdHlwZT0idGV4dCIgaWQ9ImFkbWluT2JzZXJ2YWNhbyIgcGxhY2Vob2xkZXI9IkV4OiB0dXJtYSA1LCBwZWxvdMOjbyBYIj4KICAgIDxkaXYgY2xhc3M9ImxpbmhhLWJvdG9lcyI+PGJ1dHRvbiBjbGFzcz0iYnRuLXByaW1hcmlvIiBvbmNsaWNrPSJsaWJlcmFyTm92b0VtYWlsKCkiPkxpYmVyYXIgZS1tYWlsPC9idXR0b24+PC9kaXY+CiAgICA8ZGl2IGlkPSJsaXN0YUxpYmVyYWRvcyIgc3R5bGU9Im1hcmdpbi10b3A6MTJweCI+PC9kaXY+CgogICAgPGgzIHN0eWxlPSJtYXJnaW4tdG9wOjI0cHgiPkNhc29zIHJlYWlzICh1c28gaW50ZXJubyk8L2gzPgogICAgPHAgc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWNpbnphKSI+TyByZWxhdG8gY29tcGxldG8gZmljYSBzw7MgbmVzdGUgcGFpbmVsLiBBICJsacOnw6NvIHJlc3VtaWRhIiAoasOhIGFub25pbWl6YWRhIHBvciB2b2PDqikgcG9kZSBzZXIgdXNhZGEgcGVsYSBJQSBwYXJhIG1lbGhvcmFyIGZ1dHVyYXMgc2ltdWxhw6fDtWVzLCBzZSBtYXJjYWRhIGNvbW8gYXRpdmEuPC9wPgogICAgPGxhYmVsPlTDrXR1bG88L2xhYmVsPgogICAgPGlucHV0IHR5cGU9InRleHQiIGlkPSJjYXNvVGl0dWxvIiBwbGFjZWhvbGRlcj0iRXg6IEFib3JkYWdlbSBlbSB2aWFkdXRvIC0gZmF0b3IgcHJpbmNpcGFsIGFtYsOtZ3VvIj4KICAgIDxsYWJlbD5SZWxhdG8gaW50ZXJubyAobsOjbyB2YWkgcGFyYSBhIElBKTwvbGFiZWw+CiAgICA8dGV4dGFyZWEgaWQ9ImNhc29SZWxhdG8iIHJvd3M9IjMiIHBsYWNlaG9sZGVyPSJSZWxhdG8gZGV0YWxoYWRvIGRvIGNhc28gcmVhbCI+PC90ZXh0YXJlYT4KICAgIDxsYWJlbD5MacOnw6NvIHJlc3VtaWRhIGUgYW5vbmltaXphZGEgKHBvZGUgaXIgcGFyYSBhIElBLCBzZSBhdGl2YSk8L2xhYmVsPgogICAgPHRleHRhcmVhIGlkPSJjYXNvTGljYW8iIHJvd3M9IjIiIHBsYWNlaG9sZGVyPSJFeDogcXVhbmRvIG8gZmF0b3IgZGUgcmlzY28gw6kgWCwgcGVyc29uYWdlbnMgdGVuZGVtIGEgcmVhZ2lyIGNvbS4uLiI+PC90ZXh0YXJlYT4KICAgIDxkaXYgY2xhc3M9ImNoZWNrYm94LWxpbmhhIj4KICAgICAgPGlucHV0IHR5cGU9ImNoZWNrYm94IiBpZD0iY2Fzb0F0aXZvIj4KICAgICAgPGxhYmVsIGZvcj0iY2Fzb0F0aXZvIiBzdHlsZT0ibWFyZ2luOjA7Zm9udC13ZWlnaHQ6NDAwIj5Vc2FyIGVzdGEgbGnDp8OjbyBuYXMgcHLDs3hpbWFzIHNpbXVsYcOnw7VlczwvbGFiZWw+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImxpbmhhLWJvdG9lcyI+PGJ1dHRvbiBjbGFzcz0iYnRuLXByaW1hcmlvIiBvbmNsaWNrPSJhZGljaW9uYXJDYXNvKCkiPlNhbHZhciBjYXNvPC9idXR0b24+PC9kaXY+CiAgICA8ZGl2IGlkPSJsaXN0YUNhc29zIiBzdHlsZT0ibWFyZ2luLXRvcDoxMnB4Ij48L2Rpdj4KCiAgICA8ZGl2IGNsYXNzPSJsaW5oYS1ib3RvZXMiIHN0eWxlPSJtYXJnaW4tdG9wOjIwcHgiPjxidXR0b24gY2xhc3M9ImJ0bi1zZWN1bmRhcmlvIiBvbmNsaWNrPSJtb3N0cmFyVGVsYSgndGVsYS1tZW51JykiPlZvbHRhcjwvYnV0dG9uPjwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPGRpdiBjbGFzcz0icm9kYXBlLW5vdGEiPlRTRSDigJQgVHJlaW5hbWVudG8gU3VjZXNzb3JlcyBkZSDDiWxwaXMgwrcgZmVycmFtZW50YSBkaWTDoXRpY2EgZmljdMOtY2lhIMK3IENBVFRTIDIwMjYgwrcgZW0gY2FzbyBkZSBzb2ZyaW1lbnRvIHJlYWwsIGxpZ3VlIDE4OCAoQ1ZWKTwvZGl2PgoKPC9tYWluPgoKPHNjcmlwdD4KICB2YXIgc2Vzc2FvQXR1YWwgPSB7IGVtYWlsOiAnJywgbm9tZTogJycsIG1hdHJpY3VsYTogJycsIGFkbWluOiBmYWxzZSB9OwogIHZhciBjYXNvQXR1YWwgPSB7IHNlc3Npb25JZDogbnVsbCwgZGlmaWN1bGRhZGU6ICdtZWRpYScsIHZvejogbnVsbCB9OwoKICAvLyAtLS0tLS0tLS0tLS0tLS0tIFZPWiBETyBURU5UQU5URSAoVGV4dC10by1TcGVlY2gpIC0tLS0tLS0tLS0tLS0tLS0KICB2YXIgdm96ZXNEaXNwb25pdmVpcyA9IFtdOwogIHZhciBOT01FU19WT1pfRkVNSU5JTkEgPSBbJ2x1Y2lhbmEnLCAnam9hbmEnLCAndml0w7NyaWEnLCAndml0b3JpYScsICdjYW1pbGEnLCAnZmVybmFuZGEnLCAnZmVtYWxlJywgJ211bGhlciddOwogIHZhciBOT01FU19WT1pfTUFTQ1VMSU5BID0gWydmZWxpcGUnLCAnZGFuaWVsJywgJ3JpY2FyZG8nLCAncm9kcmlnbycsICdtYWxlJywgJ2hvbWVtJ107CgogIGZ1bmN0aW9uIGNhcnJlZ2FyVm96ZXNEaXNwb25pdmVpcygpIHsKICAgIGlmICghKCdzcGVlY2hTeW50aGVzaXMnIGluIHdpbmRvdykpIHJldHVybjsKICAgIHZvemVzRGlzcG9uaXZlaXMgPSB3aW5kb3cuc3BlZWNoU3ludGhlc2lzLmdldFZvaWNlcygpLmZpbHRlcihmdW5jdGlvbiAodikgeyByZXR1cm4gL3B0KC18Xyk/YnIvaS50ZXN0KHYubGFuZykgfHwgL3B0KC18Xyk/cHQvaS50ZXN0KHYubGFuZyk7IH0pOwogIH0KICBpZiAoJ3NwZWVjaFN5bnRoZXNpcycgaW4gd2luZG93KSB7CiAgICBjYXJyZWdhclZvemVzRGlzcG9uaXZlaXMoKTsKICAgIHdpbmRvdy5zcGVlY2hTeW50aGVzaXMub252b2ljZXNjaGFuZ2VkID0gY2FycmVnYXJWb3plc0Rpc3Bvbml2ZWlzOwogIH0KCiAgZnVuY3Rpb24gcHJlcGFyYXJWb3oodm96KSB7CiAgICBjYXNvQXR1YWwudm96ID0gdm96IHx8IHsgZ2VuZXJvOiAnbWFzY3VsaW5vJywgZmFpeGFFdGFyaWE6ICdhZHVsdG8nIH07CiAgfQoKICAvLyBFc2NvbGhlIGEgdm96IGRvIE5BUlJBRE9SIGUgYSB2b3ogZG8gVEVOVEFOVEUgZGUgcHJvcMOzc2l0byBkaXN0aW50YXMgdW1hIGRhCiAgLy8gb3V0cmEsIHF1YW5kbyBvIGFwYXJlbGhvIHRpdmVyIG1haXMgZGUgdW1hIHZveiBwdC1CUiBpbnN0YWxhZGEuCiAgZnVuY3Rpb24gZXNjb2xoZXJWb3pOYXZlZ2Fkb3JfKGdlbmVybywgZXZpdGFyVm96KSB7CiAgICBpZiAoIXZvemVzRGlzcG9uaXZlaXMubGVuZ3RoKSByZXR1cm4gbnVsbDsKICAgIHZhciBsaXN0YSA9IGdlbmVybyA9PT0gJ2ZlbWluaW5vJyA/IE5PTUVTX1ZPWl9GRU1JTklOQSA6IE5PTUVTX1ZPWl9NQVNDVUxJTkE7CiAgICB2YXIgY2FuZGlkYXRhcyA9IHZvemVzRGlzcG9uaXZlaXMuZmlsdGVyKGZ1bmN0aW9uICh2KSB7IHJldHVybiB2ICE9PSBldml0YXJWb3o7IH0pOwogICAgaWYgKCFjYW5kaWRhdGFzLmxlbmd0aCkgY2FuZGlkYXRhcyA9IHZvemVzRGlzcG9uaXZlaXM7CiAgICB2YXIgYWNoYWRhID0gY2FuZGlkYXRhcy5maW5kKGZ1bmN0aW9uICh2KSB7CiAgICAgIHZhciBub21lID0gdi5uYW1lLnRvTG93ZXJDYXNlKCk7CiAgICAgIHJldHVybiBsaXN0YS5zb21lKGZ1bmN0aW9uIChjaGF2ZSkgeyByZXR1cm4gbm9tZS5pbmRleE9mKGNoYXZlKSA+PSAwOyB9KTsKICAgIH0pOwogICAgcmV0dXJuIGFjaGFkYSB8fCBjYW5kaWRhdGFzW2NhbmRpZGF0YXMubGVuZ3RoIC0gMV07CiAgfQoKICB2YXIgdm96VXNhZGFQZWxvTmFycmFkb3JfID0gbnVsbDsKCiAgZnVuY3Rpb24gZmFsYXJDb21vVGVudGFudGUodGV4dG9Db21wbGV0bywgYW9Db21lY2FyLCBhb1Rlcm1pbmFyKSB7CiAgICBpZiAoISgnc3BlZWNoU3ludGhlc2lzJyBpbiB3aW5kb3cpIHx8ICFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2hrVm96JykuY2hlY2tlZCkgewogICAgICBpZiAoYW9UZXJtaW5hcikgYW9UZXJtaW5hcigpOwogICAgICByZXR1cm47CiAgICB9CiAgICB2YXIgdGV4dG8gPSB0ZXh0b0NvbXBsZXRvLnJlcGxhY2UoL1woW14pXSpcKS9nLCAnJykudHJpbSgpOyAvLyByZW1vdmUgc2luYWlzIGVudHJlIHBhcsOqbnRlc2VzIGRhIGZhbGEKICAgIGlmICghdGV4dG8pIHsgaWYgKGFvVGVybWluYXIpIGFvVGVybWluYXIoKTsgcmV0dXJuOyB9CiAgICB3aW5kb3cuc3BlZWNoU3ludGhlc2lzLmNhbmNlbCgpOwogICAgdmFyIHV0dGVyID0gbmV3IFNwZWVjaFN5bnRoZXNpc1V0dGVyYW5jZSh0ZXh0byk7CiAgICB1dHRlci5sYW5nID0gJ3B0LUJSJzsKICAgIHZhciB2b3ogPSBjYXNvQXR1YWwudm96IHx8IHsgZ2VuZXJvOiAnbWFzY3VsaW5vJywgZmFpeGFFdGFyaWE6ICdhZHVsdG8nIH07CiAgICB2YXIgdm96TmF2ZWdhZG9yID0gZXNjb2xoZXJWb3pOYXZlZ2Fkb3JfKHZvei5nZW5lcm8sIHZvelVzYWRhUGVsb05hcnJhZG9yXyk7CiAgICBpZiAodm96TmF2ZWdhZG9yKSB1dHRlci52b2ljZSA9IHZvek5hdmVnYWRvcjsKICAgIC8vIGFqdXN0YSB0b20vdmVsb2NpZGFkZSBwYXJhIHN1Z2VyaXIgZ8OqbmVybyBlIGZhaXhhIGV0w6FyaWEgbWVzbW8gcXVhbmRvIHPDsyBow6EgMSB2b3ogcHQtQlIgZGlzcG9uw612ZWwKICAgIC8vIGUgcGFyYSBzb2FyIGNsYXJhbWVudGUgZGlmZXJlbnRlIGRhIHZveiBtYWlzIGdyYXZlIGUgbmV1dHJhIGRvIG5hcnJhZG9yCiAgICB2YXIgcGl0Y2ggPSB2b3ouZ2VuZXJvID09PSAnZmVtaW5pbm8nID8gMS4zIDogMC45NTsKICAgIHZhciByYXRlID0gMS4wMjsKICAgIGlmICh2b3ouZmFpeGFFdGFyaWEgPT09ICdqb3ZlbV9hZHVsdG8nKSB7IHBpdGNoICs9IDAuMTI7IHJhdGUgPSAxLjA4OyB9CiAgICBpZiAodm96LmZhaXhhRXRhcmlhID09PSAnaWRvc28nKSB7IHBpdGNoIC09IDAuMTg7IHJhdGUgPSAwLjg4OyB9CiAgICB1dHRlci5waXRjaCA9IE1hdGgubWF4KDAuNSwgTWF0aC5taW4oMiwgcGl0Y2gpKTsKICAgIHV0dGVyLnJhdGUgPSByYXRlOwogICAgaWYgKGFvQ29tZWNhcikgdXR0ZXIub25zdGFydCA9IGFvQ29tZWNhcjsKICAgIHV0dGVyLm9uZW5kID0gYW9UZXJtaW5hciB8fCBudWxsOwogICAgdXR0ZXIub25lcnJvciA9IGFvVGVybWluYXIgfHwgbnVsbDsKICAgIHdpbmRvdy5zcGVlY2hTeW50aGVzaXMuc3BlYWsodXR0ZXIpOwogIH0KCiAgLyoqIE5hcnJhIGEgaW50cm9kdcOnw6NvL2Rlc3BhY2hvIGNvbSB2b3ogbmV1dHJhIGUgZ3JhdmUgZGUgbmFycmFkb3IgKG51bmNhIGEgdm96IGRvIHBlcnNvbmFnZW0pLiAqLwogIGZ1bmN0aW9uIG5hcnJhcl8odGV4dG8sIGFvVGVybWluYXIpIHsKICAgIGlmICghKCdzcGVlY2hTeW50aGVzaXMnIGluIHdpbmRvdykgfHwgIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjaGtWb3onKS5jaGVja2VkKSB7CiAgICAgIGlmIChhb1Rlcm1pbmFyKSBhb1Rlcm1pbmFyKCk7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHZhciBsaW1wbyA9IHRleHRvLnJlcGxhY2UoL1woW14pXSpcKS9nLCAnJykudHJpbSgpOwogICAgaWYgKCFsaW1wbykgeyBpZiAoYW9UZXJtaW5hcikgYW9UZXJtaW5hcigpOyByZXR1cm47IH0KICAgIHdpbmRvdy5zcGVlY2hTeW50aGVzaXMuY2FuY2VsKCk7CiAgICB2YXIgdXR0ZXIgPSBuZXcgU3BlZWNoU3ludGhlc2lzVXR0ZXJhbmNlKGxpbXBvKTsKICAgIHV0dGVyLmxhbmcgPSAncHQtQlInOwogICAgLy8gcHJlZmVyZSBhIMOaTFRJTUEgdm96IGRhIGxpc3RhIChvIHRlbnRhbnRlIHByaW9yaXphIGEgcHJpbWVpcmEgcXVlIGNhc2FyIGNvbSBvCiAgICAvLyBnw6puZXJvLCBlbnTDo28gdXNhciBhIHBvbnRhIG9wb3N0YSBqw6EgYWp1ZGEgYSBzb2FyZW0gZGlmZXJlbnRlcyBwb3IgcGFkcsOjbykKICAgIHZvelVzYWRhUGVsb05hcnJhZG9yXyA9IHZvemVzRGlzcG9uaXZlaXMubGVuZ3RoID8gdm96ZXNEaXNwb25pdmVpc1t2b3plc0Rpc3Bvbml2ZWlzLmxlbmd0aCAtIDFdIDogbnVsbDsKICAgIGlmICh2b3pVc2FkYVBlbG9OYXJyYWRvcl8pIHV0dGVyLnZvaWNlID0gdm96VXNhZGFQZWxvTmFycmFkb3JfOwogICAgdXR0ZXIucGl0Y2ggPSAwLjg7CiAgICB1dHRlci5yYXRlID0gMC45NTsKICAgIHV0dGVyLm9uZW5kID0gYW9UZXJtaW5hciB8fCBudWxsOwogICAgdXR0ZXIub25lcnJvciA9IGFvVGVybWluYXIgfHwgbnVsbDsKICAgIHdpbmRvdy5zcGVlY2hTeW50aGVzaXMuc3BlYWsodXR0ZXIpOwogIH0KCiAgLy8gLS0tLS0tLS0tLS0tLS0tLSBGQUxBIERPIEFMVU5PIChTcGVlY2gtdG8tVGV4dCkg4oCUIHNlZ3VyYXIgZSBhcnJhc3RhciAtLS0tLS0tLS0tLS0tLS0tCiAgdmFyIFJlY29uaGVjaW1lbnRvVm96ID0gd2luZG93LlNwZWVjaFJlY29nbml0aW9uIHx8IHdpbmRvdy53ZWJraXRTcGVlY2hSZWNvZ25pdGlvbjsKICB2YXIgcmVjb25oZWNpbWVudG8gPSBudWxsOwogIHZhciBncmF2YW5kbyA9IGZhbHNlOwogIHZhciBjYW5jZWxhckVudmlvQXVkaW8gPSBmYWxzZTsKICB2YXIgeEluaWNpYWxQcmVzc2FvXyA9IDA7CiAgdmFyIHRyYW5zY3JpY2FvQWN1bXVsYWRhXyA9ICcnOwogIHZhciBiYXJyYUdyYXZhckVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhcnJhR3JhdmFyJyk7CgogIGZ1bmN0aW9uIGF0dWFsaXphckJhcnJhXyhlc3RhZG8pIHsKICAgIHZhciBpY29uZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdiYXJyYUljb25lJyk7CiAgICB2YXIgdGV4dG8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmFycmFUZXh0bycpOwogICAgYmFycmFHcmF2YXJFbC5jbGFzc0xpc3QucmVtb3ZlKCdncmF2YW5kbycsICdjYW5jZWxhbmRvJyk7CiAgICBpZiAoZXN0YWRvID09PSAnZ3JhdmFuZG8nKSB7CiAgICAgIGJhcnJhR3JhdmFyRWwuY2xhc3NMaXN0LmFkZCgnZ3JhdmFuZG8nKTsKICAgICAgaWNvbmUudGV4dENvbnRlbnQgPSAn8J+UtCc7CiAgICAgIHRleHRvLnRleHRDb250ZW50ID0gJ0dyYXZhbmRvLi4uIHNvbHRlIHBhcmEgZW52aWFyJzsKICAgIH0gZWxzZSBpZiAoZXN0YWRvID09PSAnY2FuY2VsYW5kbycpIHsKICAgICAgYmFycmFHcmF2YXJFbC5jbGFzc0xpc3QuYWRkKCdjYW5jZWxhbmRvJyk7CiAgICAgIGljb25lLnRleHRDb250ZW50ID0gJ+KdjCc7CiAgICAgIHRleHRvLnRleHRDb250ZW50ID0gJ1NvbHRlIHBhcmEgY2FuY2VsYXInOwogICAgfSBlbHNlIHsKICAgICAgaWNvbmUudGV4dENvbnRlbnQgPSAn8J+OpCc7CiAgICAgIHRleHRvLnRleHRDb250ZW50ID0gJ1NlZ3VyZSBwYXJhIGZhbGFyJzsKICAgIH0KICB9CgogIGlmIChSZWNvbmhlY2ltZW50b1ZveikgewogICAgcmVjb25oZWNpbWVudG8gPSBuZXcgUmVjb25oZWNpbWVudG9Wb3ooKTsKICAgIHJlY29uaGVjaW1lbnRvLmxhbmcgPSAncHQtQlInOwogICAgcmVjb25oZWNpbWVudG8uY29udGludW91cyA9IHRydWU7CiAgICByZWNvbmhlY2ltZW50by5pbnRlcmltUmVzdWx0cyA9IHRydWU7CiAgICByZWNvbmhlY2ltZW50by5tYXhBbHRlcm5hdGl2ZXMgPSAxOwogICAgcmVjb25oZWNpbWVudG8ub25yZXN1bHQgPSBmdW5jdGlvbiAoZXZlbnRvKSB7CiAgICAgIHZhciB0ZXh0byA9ICcnOwogICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGV2ZW50by5yZXN1bHRzLmxlbmd0aDsgaSsrKSB0ZXh0byArPSBldmVudG8ucmVzdWx0c1tpXVswXS50cmFuc2NyaXB0OwogICAgICB0cmFuc2NyaWNhb0FjdW11bGFkYV8gPSB0ZXh0bzsKICAgIH07CiAgICByZWNvbmhlY2ltZW50by5vbmVuZCA9IGZ1bmN0aW9uICgpIHsKICAgICAgZ3JhdmFuZG8gPSBmYWxzZTsKICAgICAgYXR1YWxpemFyQmFycmFfKCdvY2lvc28nKTsKICAgICAgaWYgKCFjYW5jZWxhckVudmlvQXVkaW8gJiYgdHJhbnNjcmljYW9BY3VtdWxhZGFfLnRyaW0oKSkgewogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYW1wb0ZhbGEnKS52YWx1ZSA9IHRyYW5zY3JpY2FvQWN1bXVsYWRhXy50cmltKCk7CiAgICAgICAgZW52aWFyRmFsYUFsdW5vKCk7CiAgICAgIH0KICAgICAgdHJhbnNjcmljYW9BY3VtdWxhZGFfID0gJyc7CiAgICB9OwogICAgcmVjb25oZWNpbWVudG8ub25lcnJvciA9IGZ1bmN0aW9uICgpIHsKICAgICAgZ3JhdmFuZG8gPSBmYWxzZTsKICAgICAgYXR1YWxpemFyQmFycmFfKCdvY2lvc28nKTsKICAgICAgdHJhbnNjcmljYW9BY3VtdWxhZGFfID0gJyc7CiAgICB9OwogIH0gZWxzZSB7CiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIGZ1bmN0aW9uICgpIHsKICAgICAgYmFycmFHcmF2YXJFbC5jbGFzc0xpc3QuYWRkKCdpbmRpc3Bvbml2ZWwnKTsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhcnJhVGV4dG8nKS50ZXh0Q29udGVudCA9ICdWb3ogaW5kaXNwb27DrXZlbCBuZXN0ZSBuYXZlZ2Fkb3Ig4oCUIHVzZSBvIHRlY2xhZG8nOwogICAgICBiYXJyYUdyYXZhckVsLnN0eWxlLnBvaW50ZXJFdmVudHMgPSAnbm9uZSc7CiAgICAgIGFsdGVybmFyTW9kb0RpZ2l0YXIodHJ1ZSk7CiAgICB9KTsKICB9CgogIGZ1bmN0aW9uIGluaWNpYXJQcmVzc2FvQXVkaW9fKGUpIHsKICAgIGlmICghcmVjb25oZWNpbWVudG8gfHwgZ3JhdmFuZG8pIHJldHVybjsKICAgIGUucHJldmVudERlZmF1bHQoKTsKICAgIHhJbmljaWFsUHJlc3Nhb18gPSBlLmNsaWVudFg7CiAgICBjYW5jZWxhckVudmlvQXVkaW8gPSBmYWxzZTsKICAgIGdyYXZhbmRvID0gdHJ1ZTsKICAgIHRyYW5zY3JpY2FvQWN1bXVsYWRhXyA9ICcnOwogICAgYXR1YWxpemFyQmFycmFfKCdncmF2YW5kbycpOwogICAgdHJ5IHsgcmVjb25oZWNpbWVudG8uc3RhcnQoKTsgfSBjYXRjaCAoZXJyKSB7fQogIH0KCiAgZnVuY3Rpb24gbW92ZXJQcmVzc2FvQXVkaW9fKGUpIHsKICAgIGlmICghZ3JhdmFuZG8pIHJldHVybjsKICAgIHZhciBkeCA9IGUuY2xpZW50WCAtIHhJbmljaWFsUHJlc3Nhb187CiAgICBpZiAoZHggPCAtNzAgJiYgIWNhbmNlbGFyRW52aW9BdWRpbykgewogICAgICBjYW5jZWxhckVudmlvQXVkaW8gPSB0cnVlOwogICAgICBhdHVhbGl6YXJCYXJyYV8oJ2NhbmNlbGFuZG8nKTsKICAgIH0gZWxzZSBpZiAoZHggPj0gLTcwICYmIGNhbmNlbGFyRW52aW9BdWRpbykgewogICAgICBjYW5jZWxhckVudmlvQXVkaW8gPSBmYWxzZTsKICAgICAgYXR1YWxpemFyQmFycmFfKCdncmF2YW5kbycpOwogICAgfQogIH0KCiAgZnVuY3Rpb24gc29sdGFyUHJlc3Nhb0F1ZGlvXygpIHsKICAgIGlmICghZ3JhdmFuZG8pIHJldHVybjsKICAgIHRyeSB7IHJlY29uaGVjaW1lbnRvLnN0b3AoKTsgfSBjYXRjaCAoZXJyKSB7fQogIH0KCiAgaWYgKGJhcnJhR3JhdmFyRWwpIHsKICAgIGJhcnJhR3JhdmFyRWwuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCBpbmljaWFyUHJlc3Nhb0F1ZGlvXyk7CiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcm1vdmUnLCBtb3ZlclByZXNzYW9BdWRpb18pOwogICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIHNvbHRhclByZXNzYW9BdWRpb18pOwogICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJjYW5jZWwnLCBzb2x0YXJQcmVzc2FvQXVkaW9fKTsKICB9CgogIGZ1bmN0aW9uIGFsdGVybmFyTW9kb0RpZ2l0YXIoZm9yY2FyRGlnaXRhcikgewogICAgdmFyIG1vc3RyYXJUZXh0byA9IGZvcmNhckRpZ2l0YXIgPT09IHRydWUgfHwgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VudHJhZGFUZXh0bycpLmNsYXNzTGlzdC5jb250YWlucygnZXNjb25kaWRvJyk7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW50cmFkYVRleHRvJykuY2xhc3NMaXN0LnRvZ2dsZSgnZXNjb25kaWRvJywgIW1vc3RyYXJUZXh0byk7CiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuZW50cmFkYS1hdWRpbycpLmNsYXNzTGlzdC50b2dnbGUoJ2VzY29uZGlkbycsIG1vc3RyYXJUZXh0byk7CiAgfQoKICBmdW5jdGlvbiBtb3N0cmFyVGVsYShpZCkgewogICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnbWFpbiA+IHNlY3Rpb24nKS5mb3JFYWNoKGZ1bmN0aW9uIChzKSB7IHMuY2xhc3NMaXN0LmFkZCgnZXNjb25kaWRvJyk7IH0pOwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpLmNsYXNzTGlzdC5yZW1vdmUoJ2VzY29uZGlkbycpOwogIH0KCiAgZnVuY3Rpb24gY2FycmVnYXJDb250YWRvcigpIHsKICAgIGdvb2dsZS5zY3JpcHQucnVuLndpdGhTdWNjZXNzSGFuZGxlcihmdW5jdGlvbiAobikgewogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY29udGFkb3JHbG9iYWwnKS50ZXh0Q29udGVudCA9IG4gKyAnIGFib3JkYWdlbShucykgcmVhbGl6YWRhKHMpIG5vIHRvdGFsJzsKICAgIH0pLm9idGVyQ29udGFkb3JHbG9iYWwoKTsKICB9CgogIC8vIC0tLS0tLS0tLS0tLS0tLS0gTE9HSU4gLS0tLS0tLS0tLS0tLS0tLQogIHdpbmRvdy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7CiAgICBjYXJyZWdhckNvbnRhZG9yKCk7CiAgICB2YXIgc2Fsdm8gPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgndHBlX3Nlc3NhbycpOwogICAgaWYgKHNhbHZvKSB7CiAgICAgIHRyeSB7CiAgICAgICAgdmFyIHMgPSBKU09OLnBhcnNlKHNhbHZvKTsKICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9naW5Ob21lJykudmFsdWUgPSBzLm5vbWUgfHwgJyc7CiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvZ2luTWF0cmljdWxhJykudmFsdWUgPSBzLm1hdHJpY3VsYSB8fCAnJzsKICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9naW5FbWFpbCcpLnZhbHVlID0gcy5lbWFpbCB8fCAnJzsKICAgICAgfSBjYXRjaCAoZSkge30KICAgIH0KICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0ZXJtb0FjZWl0ZScpLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J0bkFjZWl0YXJUZXJtbycpLmRpc2FibGVkID0gIXRoaXMuY2hlY2tlZDsKICAgIH0pOwogIH07CgogIGZ1bmN0aW9uIHRlbnRhckVudHJhcigpIHsKICAgIHZhciBlbWFpbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2dpbkVtYWlsJykudmFsdWUudHJpbSgpOwogICAgdmFyIG5vbWUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9naW5Ob21lJykudmFsdWUudHJpbSgpOwogICAgdmFyIG1hdHJpY3VsYSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2dpbk1hdHJpY3VsYScpLnZhbHVlLnRyaW0oKTsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2dpbkVycm8nKS5pbm5lckhUTUwgPSAnJzsKICAgIGlmICghZW1haWwgfHwgIW5vbWUpIHsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvZ2luRXJybycpLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJlcnJvIj5QcmVlbmNoYSBub21lIGUgZS1tYWlsLjwvZGl2Pic7CiAgICAgIHJldHVybjsKICAgIH0KICAgIGdvb2dsZS5zY3JpcHQucnVuCiAgICAgIC53aXRoU3VjY2Vzc0hhbmRsZXIoZnVuY3Rpb24gKHJlc3ApIHsKICAgICAgICBpZiAoIXJlc3AubGliZXJhZG8pIHsKICAgICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2dpbkVycm8nKS5pbm5lckhUTUwgPQogICAgICAgICAgICAnPGRpdiBjbGFzcz0iZXJybyI+RXN0ZSBlLW1haWwgYWluZGEgbsOjbyBmb2kgbGliZXJhZG8gcGVsbyBpbnN0cnV0b3IuICcgKwogICAgICAgICAgICAnU29saWNpdGUgYSBsaWJlcmHDp8OjbzogPGEgaHJlZj0ibWFpbHRvOl9fQURNSU5fRU1BSUxfXyI+X19BRE1JTl9FTUFJTF9fPC9hPjwvZGl2Pic7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIHNlc3Nhb0F0dWFsID0geyBlbWFpbDogZW1haWwsIG5vbWU6IHJlc3Aubm9tZSB8fCBub21lLCBtYXRyaWN1bGE6IHJlc3AubWF0cmljdWxhIHx8IG1hdHJpY3VsYSwgYWRtaW46IHJlc3AuYWRtaW4gfTsKICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgndHBlX3Nlc3NhbycsIEpTT04uc3RyaW5naWZ5KHNlc3Nhb0F0dWFsKSk7CiAgICAgICAgaWYgKHJlc3AucHJlY2lzYUNvbnNlbnRpbWVudG8pIHsKICAgICAgICAgIG1vc3RyYXJUZWxhKCd0ZWxhLXRlcm1vJyk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIGVudHJhck5vTWVudShyZXNwKTsKICAgICAgICB9CiAgICAgIH0pCiAgICAgIC53aXRoRmFpbHVyZUhhbmRsZXIobW9zdHJhckVycm9HZW5lcmljbykKICAgICAgLmVudHJhcihlbWFpbCwgbm9tZSwgbWF0cmljdWxhKTsKICB9CgogIGZ1bmN0aW9uIGFjZWl0YXJUZXJtbygpIHsKICAgIGdvb2dsZS5zY3JpcHQucnVuCiAgICAgIC53aXRoU3VjY2Vzc0hhbmRsZXIoZnVuY3Rpb24gKCkgeyBlbnRyYXJOb01lbnUoeyB0b3RhbEFib3JkYWdlbnM6IDAsIG1lbGhvck5vdGE6ICcnIH0pOyB9KQogICAgICAud2l0aEZhaWx1cmVIYW5kbGVyKG1vc3RyYXJFcnJvR2VuZXJpY28pCiAgICAgIC5yZWdpc3RyYXJDb25zZW50aW1lbnRvKHNlc3Nhb0F0dWFsLmVtYWlsKTsKICB9CgogIGZ1bmN0aW9uIGVudHJhck5vTWVudShyZXNwKSB7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWVudU5vbWUnKS50ZXh0Q29udGVudCA9IHNlc3Nhb0F0dWFsLm5vbWU7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWVudVRvdGFsQWJvcmRhZ2VucycpLnRleHRDb250ZW50ID0gcmVzcC50b3RhbEFib3JkYWdlbnMgfHwgMDsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdtZW51TWVsaG9yTm90YScpLnRleHRDb250ZW50ID0gcmVzcC5tZWxob3JOb3RhICE9PSAnJyAmJiByZXNwLm1lbGhvck5vdGEgIT09IHVuZGVmaW5lZCA/IE51bWJlcihyZXNwLm1lbGhvck5vdGEpLnRvRml4ZWQoMikgOiAn4oCUJzsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidG5QYWluZWxBZG1pbicpLmNsYXNzTGlzdC50b2dnbGUoJ2VzY29uZGlkbycsICFzZXNzYW9BdHVhbC5hZG1pbik7CiAgICBtb3N0cmFyVGVsYSgndGVsYS1tZW51Jyk7CiAgICBjYXJyZWdhckNvbnRhZG9yKCk7CiAgfQoKICBmdW5jdGlvbiBzYWlyKCkgewogICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oJ3RwZV9zZXNzYW8nKTsKICAgIGxvY2F0aW9uLnJlbG9hZCgpOwogIH0KCiAgZnVuY3Rpb24gbW9zdHJhckVycm9HZW5lcmljbyhlcnJvKSB7CiAgICBhbGVydCgnT2NvcnJldSB1bSBlcnJvOiAnICsgKGVycm8gJiYgZXJyby5tZXNzYWdlID8gZXJyby5tZXNzYWdlIDogZXJybykpOwogIH0KCiAgLy8gLS0tLS0tLS0tLS0tLS0tLSBTSU1VTEFET1IgLS0tLS0tLS0tLS0tLS0tLQoKICAvLyBEZXNibG9xdWVpYSBvIMOhdWRpbyBubyBpT1MvU2FmYXJpOiBwcmVjaXNhIHNlciBjaGFtYWRvIERFTlRSTyBkZSB1bSB0b3F1ZQogIC8vIHJlYWwgZG8gdXN1w6FyaW8gKG7Do28gZGVwb2lzIGRlIHVtYSByZXNwb3N0YSBhc3PDrW5jcm9uYSBkbyBzZXJ2aWRvcikuCiAgZnVuY3Rpb24gZGVzYmxvcXVlYXJBdWRpb18oKSB7CiAgICBpZiAoISgnc3BlZWNoU3ludGhlc2lzJyBpbiB3aW5kb3cpKSByZXR1cm47CiAgICB0cnkgewogICAgICB2YXIgdXR0ZXIgPSBuZXcgU3BlZWNoU3ludGhlc2lzVXR0ZXJhbmNlKCcgJyk7CiAgICAgIHV0dGVyLnZvbHVtZSA9IDAuMDE7CiAgICAgIHdpbmRvdy5zcGVlY2hTeW50aGVzaXMuc3BlYWsodXR0ZXIpOwogICAgfSBjYXRjaCAoZSkge30KICB9CgogIGZ1bmN0aW9uIGF0dWFsaXphclN0YXR1cyhpY29uZSwgdGV4dG8sIGZhbGFuZG8pIHsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzdGF0dXNJY29uZScpLnRleHRDb250ZW50ID0gaWNvbmU7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3RhdHVzSWNvbmUnKS5jbGFzc0xpc3QudG9nZ2xlKCdmYWxhbmRvJywgISFmYWxhbmRvKTsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzdGF0dXNUZXh0bycpLnRleHRDb250ZW50ID0gdGV4dG87CiAgfQoKICBmdW5jdGlvbiBpbmljaWFyTm92b0Nhc28oKSB7CiAgICBkZXNibG9xdWVhckF1ZGlvXygpOyAvLyBwcmVjaXNhIHNlciBzw61uY3Jvbm8gY29tIG8gY2xpcXVlLCBwb3IgaXNzbyB2ZW0gcHJpbWVpcm8KICAgIGNhc29BdHVhbC5kaWZpY3VsZGFkZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWxlY3REaWZpY3VsZGFkZScpLnZhbHVlOwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JyaWVmaW5nQ2VuYScpLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJjYXJyZWdhbmRvIj5HZXJhbmRvIG9jb3Jyw6puY2lh4oCmPC9kaXY+JzsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjaGF0TG9nJykuaW5uZXJIVE1MID0gJyc7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3RhdHVzQ29udmVyc2EnKS5jbGFzc0xpc3QuYWRkKCdlc2NvbmRpZG8nKTsKICAgIG1vc3RyYXJUZWxhKCd0ZWxhLXNpbXVsYWRvcicpOwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J0bkVudmlhcicpLmRpc2FibGVkID0gdHJ1ZTsKICAgIGdvb2dsZS5zY3JpcHQucnVuCiAgICAgIC53aXRoU3VjY2Vzc0hhbmRsZXIoZnVuY3Rpb24gKHJlc3ApIHsKICAgICAgICBjYXNvQXR1YWwuc2Vzc2lvbklkID0gcmVzcC5zZXNzaW9uSWQ7CiAgICAgICAgcHJlcGFyYXJWb3oocmVzcC52b3opOwogICAgICAgIHZhciBicmllZmluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdicmllZmluZ0NlbmEnKTsKICAgICAgICBicmllZmluZy5pbm5lckhUTUwgPSAnJzsKICAgICAgICBpZiAocmVzcC5pbWFnZW1DZW5hKSB7CiAgICAgICAgICB2YXIgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJyk7CiAgICAgICAgICBpbWcuc3JjID0gcmVzcC5pbWFnZW1DZW5hOwogICAgICAgICAgaW1nLmFsdCA9ICdJbHVzdHJhw6fDo28gZG8gbG9jYWwgZGEgb2NvcnLDqm5jaWEnOwogICAgICAgICAgaW1nLmNsYXNzTmFtZSA9ICdpbWFnZW0tY2VuYSc7CiAgICAgICAgICBicmllZmluZy5hcHBlbmRDaGlsZChpbWcpOwogICAgICAgIH0KICAgICAgICB2YXIgZGl2SW50cm8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsKICAgICAgICBkaXZJbnRyby5jbGFzc05hbWUgPSAnYm9saGEgYm9saGEtc2lzdGVtYSc7CiAgICAgICAgZGl2SW50cm8uc3R5bGUubWF4V2lkdGggPSAnMTAwJSc7CiAgICAgICAgZGl2SW50cm8udGV4dENvbnRlbnQgPSByZXNwLmludHJvZHVjYW87CiAgICAgICAgYnJpZWZpbmcuYXBwZW5kQ2hpbGQoZGl2SW50cm8pOwoKICAgICAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjaGtNb3N0cmFyVGV4dG8nKS5jaGVja2VkKSB7CiAgICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2hhdExvZycpLmNsYXNzTGlzdC5hZGQoJ2VzY29uZGlkbycpOwogICAgICAgIH0KICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3RhdHVzQ29udmVyc2EnKS5jbGFzc0xpc3QucmVtb3ZlKCdlc2NvbmRpZG8nKTsKICAgICAgICBhdHVhbGl6YXJTdGF0dXMoJ/Cfk7snLCAnTmFycmFuZG8gYSBvY29ycsOqbmNpYS4uLicsIHRydWUpOwogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidG5FbnZpYXInKS5kaXNhYmxlZCA9IGZhbHNlOwogICAgICAgIG5hcnJhcl8ocmVzcC5pbnRyb2R1Y2FvLCBmdW5jdGlvbiAoKSB7CiAgICAgICAgICBhdHVhbGl6YXJTdGF0dXMoJ/CfjpnvuI8nLCAnU3VhIHZleiBkZSBmYWxhcicsIGZhbHNlKTsKICAgICAgICB9KTsKICAgICAgfSkKICAgICAgLndpdGhGYWlsdXJlSGFuZGxlcihmdW5jdGlvbiAoZSkgeyBtb3N0cmFyRXJyb0dlbmVyaWNvKGUpOyBtb3N0cmFyVGVsYSgndGVsYS1kaWZpY3VsZGFkZScpOyB9KQogICAgICAuaW5pY2lhckNhc28oc2Vzc2FvQXR1YWwuZW1haWwsIGNhc29BdHVhbC5kaWZpY3VsZGFkZSk7CiAgfQoKICBmdW5jdGlvbiBhZGljaW9uYXJCb2xoYSh0aXBvLCB0ZXh0bykgewogICAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOwogICAgZGl2LmNsYXNzTmFtZSA9ICdib2xoYSBib2xoYS0nICsgdGlwbzsKICAgIGRpdi50ZXh0Q29udGVudCA9IHRleHRvOwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NoYXRMb2cnKS5hcHBlbmRDaGlsZChkaXYpOwogICAgZGl2LnNjcm9sbEludG9WaWV3KHsgYmVoYXZpb3I6ICdzbW9vdGgnLCBibG9jazogJ2VuZCcgfSk7CiAgfQoKICBmdW5jdGlvbiBlbnZpYXJGYWxhQWx1bm8oKSB7CiAgICB2YXIgY2FtcG8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FtcG9GYWxhJyk7CiAgICB2YXIgdGV4dG8gPSBjYW1wby52YWx1ZS50cmltKCk7CiAgICBpZiAoIXRleHRvIHx8ICFjYXNvQXR1YWwuc2Vzc2lvbklkKSByZXR1cm47CiAgICBhZGljaW9uYXJCb2xoYSgnYWx1bm8nLCB0ZXh0byk7CiAgICBjYW1wby52YWx1ZSA9ICcnOwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J0bkVudmlhcicpLmRpc2FibGVkID0gdHJ1ZTsKICAgIGF0dWFsaXphclN0YXR1cygn4o+zJywgJ0FndWFyZGFuZG8gYSByZWHDp8OjbyBkbyB0ZW50YW50ZS4uLicsIGZhbHNlKTsKICAgIGdvb2dsZS5zY3JpcHQucnVuCiAgICAgIC53aXRoU3VjY2Vzc0hhbmRsZXIoZnVuY3Rpb24gKHJlc3ApIHsKICAgICAgICBhZGljaW9uYXJCb2xoYSgndGVudGFudGUnLCByZXNwLmZhbGEpOwogICAgICAgIGZhbGFyQ29tb1RlbnRhbnRlKHJlc3AuZmFsYSwgZnVuY3Rpb24gKCkgewogICAgICAgICAgYXR1YWxpemFyU3RhdHVzKCfwn5SKJywgJ1RlbnRhbnRlIGZhbGFuZG8uLi4nLCB0cnVlKTsKICAgICAgICB9LCBmdW5jdGlvbiAoKSB7CiAgICAgICAgICBhdHVhbGl6YXJTdGF0dXMoJ/CfjpnvuI8nLCAnU3VhIHZleiBkZSBmYWxhcicsIGZhbHNlKTsKICAgICAgICB9KTsKICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnRuRW52aWFyJykuZGlzYWJsZWQgPSBmYWxzZTsKICAgICAgICBpZiAocmVzcC5zdGF0dXMgPT09ICdmaW1fcG9zaXRpdm8nKSB7CiAgICAgICAgICBhZGljaW9uYXJCb2xoYSgnZmltLXBvc2l0aXZvJywgcmVzcC5tZW5zYWdlbVNpc3RlbWEpOwogICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NoYXRMb2cnKS5jbGFzc0xpc3QucmVtb3ZlKCdlc2NvbmRpZG8nKTsKICAgICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzdGF0dXNDb252ZXJzYScpLmNsYXNzTGlzdC5hZGQoJ2VzY29uZGlkbycpOwogICAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J0bkVudmlhcicpLmRpc2FibGVkID0gdHJ1ZTsKICAgICAgICB9IGVsc2UgaWYgKHJlc3Auc3RhdHVzID09PSAnZmltX25lZ2F0aXZvJykgewogICAgICAgICAgYWRpY2lvbmFyQm9saGEoJ2ZpbS1uZWdhdGl2bycsIHJlc3AubWVuc2FnZW1TaXN0ZW1hKTsKICAgICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjaGF0TG9nJykuY2xhc3NMaXN0LnJlbW92ZSgnZXNjb25kaWRvJyk7CiAgICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3RhdHVzQ29udmVyc2EnKS5jbGFzc0xpc3QuYWRkKCdlc2NvbmRpZG8nKTsKICAgICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidG5FbnZpYXInKS5kaXNhYmxlZCA9IHRydWU7CiAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHsgbW9zdHJhclJlbGF0b3JpbyhyZXNwLmF2YWxpYWNhb0F1dG9tYXRpY2EpOyB9LCAxMjAwKTsKICAgICAgICB9CiAgICAgIH0pCiAgICAgIC53aXRoRmFpbHVyZUhhbmRsZXIoZnVuY3Rpb24gKGUpIHsgbW9zdHJhckVycm9HZW5lcmljbyhlKTsgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J0bkVudmlhcicpLmRpc2FibGVkID0gZmFsc2U7IGF0dWFsaXphclN0YXR1cygn8J+Ome+4jycsICdTdWEgdmV6IGRlIGZhbGFyJywgZmFsc2UpOyB9KQogICAgICAuZW52aWFyRmFsYShjYXNvQXR1YWwuc2Vzc2lvbklkLCB0ZXh0byk7CiAgfQoKICBmdW5jdGlvbiBwZWRpckF2YWxpYWNhbyhwYXJjaWFsKSB7CiAgICBpZiAoIWNhc29BdHVhbC5zZXNzaW9uSWQpIHJldHVybjsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjaGF0TG9nJykuaW5zZXJ0QWRqYWNlbnRIVE1MKCdiZWZvcmVlbmQnLCAnPGRpdiBjbGFzcz0iY2FycmVnYW5kbyI+QXZhbGlhbmRv4oCmPC9kaXY+Jyk7CiAgICBnb29nbGUuc2NyaXB0LnJ1bgogICAgICAud2l0aFN1Y2Nlc3NIYW5kbGVyKG1vc3RyYXJSZWxhdG9yaW8pCiAgICAgIC53aXRoRmFpbHVyZUhhbmRsZXIobW9zdHJhckVycm9HZW5lcmljbykKICAgICAgLmF2YWxpYXJTZXNzYW8oY2Fzb0F0dWFsLnNlc3Npb25JZCwgcGFyY2lhbCk7CiAgfQoKICBmdW5jdGlvbiBtb3N0cmFyUmVsYXRvcmlvKHJlbCkgewogICAgdmFyIGh0bWwgPSAnJzsKICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9Im5vdGEtZ3JhbmRlIj4nICsgTnVtYmVyKHJlbC5ub3RhKS50b0ZpeGVkKDIpICsgJyAvIDEwPC9kaXY+JzsKICAgIGh0bWwgKz0gJzxwIHN0eWxlPSJ0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1jaW56YSkiPlJlc3VsdGFkbzogPHN0cm9uZz4nICsgcmVsLnJlc3VsdGFkbyArICc8L3N0cm9uZz4gwrcgUGVyZmlsOiA8c3BhbiBjbGFzcz0idGlwby1iYWRnZSB0aXBvLScgKyByZWwudGlwb1RlbnRhbnRlICsgJyI+JyArIHJlbC50aXBvVGVudGFudGUgKyAnPC9zcGFuPjwvcD4nOwoKICAgIGh0bWwgKz0gJzxoMz5GaWNoYSByZXZlbGFkYSBkbyBjYXNvPC9oMz4nOwogICAgaHRtbCArPSAnPHAgc3R5bGU9ImZvbnQtc2l6ZToxM3B4Ij48c3Ryb25nPkZhdG9yIHByaW5jaXBhbDo8L3N0cm9uZz4gJyArIChyZWwuZmljaGFSZXZlbGFkYS5mYXRvclByaW5jaXBhbCB8fCAn4oCUJykgKyAnPC9wPic7CiAgICBodG1sICs9ICc8cCBzdHlsZT0iZm9udC1zaXplOjEzcHgiPjxzdHJvbmc+RmF0b3JlcyBkZSByaXNjbzo8L3N0cm9uZz4gJyArICgocmVsLmZpY2hhUmV2ZWxhZGEuZmF0b3Jlc1Jpc2NvIHx8IFtdKS5qb2luKCc7ICcpKSArICc8L3A+JzsKICAgIGh0bWwgKz0gJzxwIHN0eWxlPSJmb250LXNpemU6MTNweCI+PHN0cm9uZz5GYXRvcmVzIGRlIHByb3Rlw6fDo286PC9zdHJvbmc+ICcgKyAoKHJlbC5maWNoYVJldmVsYWRhLmZhdG9yZXNQcm90ZWNhbyB8fCBbXSkuam9pbignOyAnKSkgKyAnPC9wPic7CiAgICBpZiAocmVsLmZhdG9yZXNSZXZlbGFkb3MpIGh0bWwgKz0gJzxwIHN0eWxlPSJmb250LXNpemU6MTNweCI+PHN0cm9uZz5PIHF1ZSBhcGFyZWNldSBuYSBjb252ZXJzYTo8L3N0cm9uZz4gJyArIHJlbC5mYXRvcmVzUmV2ZWxhZG9zICsgJzwvcD4nOwoKICAgIGh0bWwgKz0gJzxoMz5Qb250dWHDp8OjbyBpdGVtIGEgaXRlbTwvaDM+JzsKICAgIChyZWwuZGV0YWxoYW1lbnRvIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChkKSB7CiAgICAgIHZhciBjbGFzc2UgPSBkLnBvbnRvcyA+IDAgPyAncG9udG9zLXBvcycgOiAoZC5wb250b3MgPCAwID8gJ3BvbnRvcy1uZWcnIDogJ3BvbnRvcy16ZXJvJyk7CiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9Iml0ZW0tdmVyZGljdCI+PHNwYW4+JyArIGQuaXRlbSArICcgPGVtIHN0eWxlPSJjb2xvcjp2YXIoLS1jaW56YSkiPignICsgZC52ZXJkaWN0LnJlcGxhY2UoL18vZywgJyAnKSArICcpPC9lbT48L3NwYW4+PHNwYW4gY2xhc3M9IicgKyBjbGFzc2UgKyAnIj4nICsgKGQucG9udG9zID4gMCA/ICcrJyA6ICcnKSArIGQucG9udG9zLnRvRml4ZWQoMikgKyAnPC9zcGFuPjwvZGl2Pic7CiAgICB9KTsKICAgIGlmIChyZWwuZXJyb3NEZXRlY3RhZG9zICYmIHJlbC5lcnJvc0RldGVjdGFkb3MubGVuZ3RoKSB7CiAgICAgIGh0bWwgKz0gJzxoMz5FcnJvcyBncmF2ZXMgZGV0ZWN0YWRvczwvaDM+JzsKICAgICAgcmVsLmVycm9zRGV0ZWN0YWRvcy5mb3JFYWNoKGZ1bmN0aW9uIChlcikgewogICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9Iml0ZW0tdmVyZGljdCI+PHNwYW4+JyArIGVyLml0ZW0gKyAoZXIuZXZpZGVuY2lhID8gJyDigJQgIicgKyBlci5ldmlkZW5jaWEgKyAnIicgOiAnJykgKyAnPC9zcGFuPjxzcGFuIGNsYXNzPSJwb250b3MtbmVnIj4nICsgZXIucG9udG9zICsgJzwvc3Bhbj48L2Rpdj4nOwogICAgICB9KTsKICAgIH0KCiAgICBpZiAocmVsLmFjZXJ0b3MgJiYgcmVsLmFjZXJ0b3MubGVuZ3RoKSB7CiAgICAgIGh0bWwgKz0gJzxoMz5BY2VydG9zIG1haXMgcmVsZXZhbnRlczwvaDM+PHVsIHN0eWxlPSJmb250LXNpemU6MTNweCI+JyArIHJlbC5hY2VydG9zLm1hcChmdW5jdGlvbiAoYSkgeyByZXR1cm4gJzxsaT4nICsgYSArICc8L2xpPic7IH0pLmpvaW4oJycpICsgJzwvdWw+JzsKICAgIH0KICAgIGlmIChyZWwuYWp1c3RlcyAmJiByZWwuYWp1c3Rlcy5sZW5ndGgpIHsKICAgICAgaHRtbCArPSAnPGgzPkFqdXN0ZXMgc3VnZXJpZG9zPC9oMz48dWwgc3R5bGU9ImZvbnQtc2l6ZToxM3B4Ij4nICsgcmVsLmFqdXN0ZXMubWFwKGZ1bmN0aW9uIChhKSB7IHJldHVybiAnPGxpPicgKyBhLm9ic2VydmFjYW8gKyAoYS5leGVtcGxvQWx0ZXJuYXRpdm8gPyAnPGJyPjxlbT5FeGVtcGxvOiAiJyArIGEuZXhlbXBsb0FsdGVybmF0aXZvICsgJyI8L2VtPicgOiAnJykgKyAnPC9saT4nOyB9KS5qb2luKCcnKSArICc8L3VsPic7CiAgICB9CgogICAgaWYgKHJlbC5saW5oYUV2b2x1Y2FvICYmIHJlbC5saW5oYUV2b2x1Y2FvLmxlbmd0aCkgewogICAgICBodG1sICs9ICc8aDM+TGluaGEgZGUgZXZvbHXDp8OjbzwvaDM+JzsKICAgICAgcmVsLmxpbmhhRXZvbHVjYW8uZm9yRWFjaChmdW5jdGlvbiAobCkgewogICAgICAgIGh0bWwgKz0gJzxwIHN0eWxlPSJmb250LXNpemU6MTJweDttYXJnaW46NHB4IDAiPjxzdHJvbmc+Vm9jw6o6PC9zdHJvbmc+ICInICsgbC5mYWxhQWx1bm8gKyAnIiDihpIgPGVtPicgKyBsLnJlYWNhbyArICc8L2VtPjwvcD4nOwogICAgICB9KTsKICAgIH0KCiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVsYXRvcmlvQ29udGV1ZG8nKS5pbm5lckhUTUwgPSBodG1sOwogICAgbW9zdHJhclRlbGEoJ3RlbGEtcmVsYXRvcmlvJyk7CiAgICBjYXJyZWdhckNvbnRhZG9yKCk7CiAgfQoKICAvLyAtLS0tLS0tLS0tLS0tLS0tIFJBTktJTkcgLS0tLS0tLS0tLS0tLS0tLQogIGZ1bmN0aW9uIGFicmlyUmFua2luZygpIHsKICAgIG1vc3RyYXJUZWxhKCd0ZWxhLXJhbmtpbmcnKTsKICAgIGNhcnJlZ2FyUmFua2luZygnZ2VyYWwnLCBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjYWJhc1JhbmtpbmcgLmFiYS1idG4nKSk7CiAgfQoKICBmdW5jdGlvbiBjYXJyZWdhclJhbmtpbmcodGlwbywgYm90YW8pIHsKICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNhYmFzUmFua2luZyAuYWJhLWJ0bicpLmZvckVhY2goZnVuY3Rpb24gKGIpIHsgYi5jbGFzc0xpc3QucmVtb3ZlKCdhdGl2YScpOyB9KTsKICAgIGlmIChib3RhbykgYm90YW8uY2xhc3NMaXN0LmFkZCgnYXRpdmEnKTsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyYW5raW5nQ29udGV1ZG8nKS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz0iY2FycmVnYW5kbyI+Y2FycmVnYW5kb+KApjwvZGl2Pic7CiAgICBnb29nbGUuc2NyaXB0LnJ1bgogICAgICAud2l0aFN1Y2Nlc3NIYW5kbGVyKGZ1bmN0aW9uIChsaXN0YSkgewogICAgICAgIGlmICghbGlzdGEubGVuZ3RoKSB7CiAgICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmFua2luZ0NvbnRldWRvJykuaW5uZXJIVE1MID0gJzxwIHN0eWxlPSJmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1jaW56YSkiPkFpbmRhIG7Do28gaMOhIGF2YWxpYcOnw7VlcyByZWdpc3RyYWRhcy48L3A+JzsKICAgICAgICAgIHJldHVybjsKICAgICAgICB9CiAgICAgICAgdmFyIGh0bWwgPSAnPHRhYmxlPjx0cj48dGg+IzwvdGg+PHRoPkFsdW5vPC90aD48dGg+VGlwbzwvdGg+PHRoPk5vdGE8L3RoPjwvdHI+JzsKICAgICAgICBsaXN0YS5mb3JFYWNoKGZ1bmN0aW9uIChyLCBpKSB7CiAgICAgICAgICBodG1sICs9ICc8dHI+PHRkPicgKyAoaSArIDEpICsgJzwvdGQ+PHRkPicgKyByLm5vbWUgKyAnPC90ZD48dGQ+PHNwYW4gY2xhc3M9InRpcG8tYmFkZ2UgdGlwby0nICsgci50aXBvVGVudGFudGUgKyAnIj4nICsgci50aXBvVGVudGFudGUgKyAnPC9zcGFuPjwvdGQ+PHRkPjxzdHJvbmc+JyArIE51bWJlcihyLm5vdGEpLnRvRml4ZWQoMikgKyAnPC9zdHJvbmc+PC90ZD48L3RyPic7CiAgICAgICAgfSk7CiAgICAgICAgaHRtbCArPSAnPC90YWJsZT4nOwogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyYW5raW5nQ29udGV1ZG8nKS5pbm5lckhUTUwgPSBodG1sOwogICAgICB9KQogICAgICAud2l0aEZhaWx1cmVIYW5kbGVyKG1vc3RyYXJFcnJvR2VuZXJpY28pCiAgICAgIC5vYnRlclJhbmtpbmcodGlwbyk7CiAgfQoKICAvLyAtLS0tLS0tLS0tLS0tLS0tIEFETUlOIC0tLS0tLS0tLS0tLS0tLS0KICBmdW5jdGlvbiBhYnJpckFkbWluKCkgewogICAgbW9zdHJhclRlbGEoJ3RlbGEtYWRtaW4nKTsKICAgIGNhcnJlZ2FyTGlzdGFMaWJlcmFkb3MoKTsKICAgIGNhcnJlZ2FyTGlzdGFDYXNvcygpOwogIH0KCiAgZnVuY3Rpb24gY2FycmVnYXJMaXN0YUxpYmVyYWRvcygpIHsKICAgIGdvb2dsZS5zY3JpcHQucnVuCiAgICAgIC53aXRoU3VjY2Vzc0hhbmRsZXIoZnVuY3Rpb24gKGxpc3RhKSB7CiAgICAgICAgdmFyIGh0bWwgPSBsaXN0YS5tYXAoZnVuY3Rpb24gKGwpIHsKICAgICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz0ibGlzdGEtbGliZXJhZG9zLWl0ZW0iPjxkaXYgY2xhc3M9InRvcG8iPjxzdHJvbmc+JyArIGwuZW1haWwgKyAnPC9zdHJvbmc+JyArCiAgICAgICAgICAgICc8YnV0dG9uIGNsYXNzPSJidG4tc2VjdW5kYXJpbyIgc3R5bGU9InBhZGRpbmc6NHB4IDEwcHg7Zm9udC1zaXplOjExcHgiIG9uY2xpY2s9InJlbW92ZXJFbWFpbChcJycgKyBsLmVtYWlsICsgJ1wnKSI+UmVtb3ZlcjwvYnV0dG9uPjwvZGl2PicgKwogICAgICAgICAgICAnPGRpdiBzdHlsZT0iZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tY2luemEpIj4nICsgKGwub2JzZXJ2YWNhbyB8fCAnJykgKyAnIMK3IGxpYmVyYWRvIGVtICcgKyBuZXcgRGF0ZShsLmRhdGFMaWJlcmFjYW8pLnRvTG9jYWxlRGF0ZVN0cmluZygncHQtQlInKSArICc8L2Rpdj48L2Rpdj4nOwogICAgICAgIH0pLmpvaW4oJycpIHx8ICc8cCBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tY2luemEpIj5OZW5odW0gZS1tYWlsIGxpYmVyYWRvIGFpbmRhLjwvcD4nOwogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsaXN0YUxpYmVyYWRvcycpLmlubmVySFRNTCA9IGh0bWw7CiAgICAgIH0pCiAgICAgIC53aXRoRmFpbHVyZUhhbmRsZXIobW9zdHJhckVycm9HZW5lcmljbykKICAgICAgLmxpc3RhckxpYmVyYWRvcyhzZXNzYW9BdHVhbC5lbWFpbCk7CiAgfQoKICBmdW5jdGlvbiBsaWJlcmFyTm92b0VtYWlsKCkgewogICAgdmFyIGVtYWlsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluTm92b0VtYWlsJykudmFsdWUudHJpbSgpOwogICAgdmFyIG9icyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbk9ic2VydmFjYW8nKS52YWx1ZS50cmltKCk7CiAgICBpZiAoIWVtYWlsKSByZXR1cm47CiAgICBnb29nbGUuc2NyaXB0LnJ1bgogICAgICAud2l0aFN1Y2Nlc3NIYW5kbGVyKGZ1bmN0aW9uICgpIHsKICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW5Ob3ZvRW1haWwnKS52YWx1ZSA9ICcnOwogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbk9ic2VydmFjYW8nKS52YWx1ZSA9ICcnOwogICAgICAgIGNhcnJlZ2FyTGlzdGFMaWJlcmFkb3MoKTsKICAgICAgfSkKICAgICAgLndpdGhGYWlsdXJlSGFuZGxlcihtb3N0cmFyRXJyb0dlbmVyaWNvKQogICAgICAubGliZXJhckVtYWlsKHNlc3Nhb0F0dWFsLmVtYWlsLCBlbWFpbCwgb2JzKTsKICB9CgogIGZ1bmN0aW9uIHJlbW92ZXJFbWFpbChlbWFpbCkgewogICAgaWYgKCFjb25maXJtKCdSZW1vdmVyIGFjZXNzbyBkZSAnICsgZW1haWwgKyAnPycpKSByZXR1cm47CiAgICBnb29nbGUuc2NyaXB0LnJ1bi53aXRoU3VjY2Vzc0hhbmRsZXIoY2FycmVnYXJMaXN0YUxpYmVyYWRvcykud2l0aEZhaWx1cmVIYW5kbGVyKG1vc3RyYXJFcnJvR2VuZXJpY28pLnJlbW92ZXJMaWJlcmFkbyhzZXNzYW9BdHVhbC5lbWFpbCwgZW1haWwpOwogIH0KCiAgZnVuY3Rpb24gY2FycmVnYXJMaXN0YUNhc29zKCkgewogICAgZ29vZ2xlLnNjcmlwdC5ydW4KICAgICAgLndpdGhTdWNjZXNzSGFuZGxlcihmdW5jdGlvbiAobGlzdGEpIHsKICAgICAgICB2YXIgaHRtbCA9IGxpc3RhLm1hcChmdW5jdGlvbiAoYykgewogICAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPSJsaXN0YS1jYXNvcy1pdGVtIj48ZGl2IGNsYXNzPSJ0b3BvIj48c3Ryb25nPicgKyBjLnRpdHVsbyArICc8L3N0cm9uZz4nICsKICAgICAgICAgICAgJzxidXR0b24gY2xhc3M9ImJ0bi1zZWN1bmRhcmlvIiBzdHlsZT0icGFkZGluZzo0cHggMTBweDtmb250LXNpemU6MTFweCIgb25jbGljaz0icmVtb3ZlckNhc28oXCcnICsgYy5pZCArICdcJykiPlJlbW92ZXI8L2J1dHRvbj48L2Rpdj4nICsKICAgICAgICAgICAgJzxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxMnB4O21hcmdpbi10b3A6NHB4Ij4nICsgKGMubGljYW9SZXN1bWlkYSB8fCAnJykgKyAnPC9kaXY+JyArCiAgICAgICAgICAgICc8ZGl2IHN0eWxlPSJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1jaW56YSk7bWFyZ2luLXRvcDo0cHgiPicgKyAoYy5hdGl2byA/ICfinIUgYXRpdmEgbmEgSUEnIDogJ+KblCBpbmF0aXZhJykgKyAnPC9kaXY+PC9kaXY+JzsKICAgICAgICB9KS5qb2luKCcnKSB8fCAnPHAgc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWNpbnphKSI+TmVuaHVtIGNhc28gY2FkYXN0cmFkbyBhaW5kYS48L3A+JzsKICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbGlzdGFDYXNvcycpLmlubmVySFRNTCA9IGh0bWw7CiAgICAgIH0pCiAgICAgIC53aXRoRmFpbHVyZUhhbmRsZXIobW9zdHJhckVycm9HZW5lcmljbykKICAgICAgLmxpc3RhckNhc29zUmVhaXMoc2Vzc2FvQXR1YWwuZW1haWwpOwogIH0KCiAgZnVuY3Rpb24gYWRpY2lvbmFyQ2FzbygpIHsKICAgIHZhciBkYWRvcyA9IHsKICAgICAgdGl0dWxvOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2Fzb1RpdHVsbycpLnZhbHVlLnRyaW0oKSwKICAgICAgcmVsYXRvOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2Fzb1JlbGF0bycpLnZhbHVlLnRyaW0oKSwKICAgICAgbGljYW9SZXN1bWlkYTogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Nhc29MaWNhbycpLnZhbHVlLnRyaW0oKSwKICAgICAgYXRpdm86IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXNvQXRpdm8nKS5jaGVja2VkLAogICAgfTsKICAgIGlmICghZGFkb3MudGl0dWxvKSByZXR1cm47CiAgICBnb29nbGUuc2NyaXB0LnJ1bgogICAgICAud2l0aFN1Y2Nlc3NIYW5kbGVyKGZ1bmN0aW9uICgpIHsKICAgICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2Fzb1RpdHVsbycpLnZhbHVlID0gJyc7CiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Nhc29SZWxhdG8nKS52YWx1ZSA9ICcnOwogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXNvTGljYW8nKS52YWx1ZSA9ICcnOwogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXNvQXRpdm8nKS5jaGVja2VkID0gZmFsc2U7CiAgICAgICAgY2FycmVnYXJMaXN0YUNhc29zKCk7CiAgICAgIH0pCiAgICAgIC53aXRoRmFpbHVyZUhhbmRsZXIobW9zdHJhckVycm9HZW5lcmljbykKICAgICAgLmFkaWNpb25hckNhc29SZWFsKHNlc3Nhb0F0dWFsLmVtYWlsLCBkYWRvcyk7CiAgfQoKICBmdW5jdGlvbiByZW1vdmVyQ2FzbyhpZCkgewogICAgaWYgKCFjb25maXJtKCdSZW1vdmVyIGVzdGUgY2Fzbz8nKSkgcmV0dXJuOwogICAgZ29vZ2xlLnNjcmlwdC5ydW4ud2l0aFN1Y2Nlc3NIYW5kbGVyKGNhcnJlZ2FyTGlzdGFDYXNvcykud2l0aEZhaWx1cmVIYW5kbGVyKG1vc3RyYXJFcnJvR2VuZXJpY28pLnJlbW92ZXJDYXNvUmVhbChzZXNzYW9BdHVhbC5lbWFpbCwgaWQpOwogIH0KPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";

function obterPaginaPrincipalHtml_() {
  return Utilities.newBlob(Utilities.base64Decode(PAGINA_PRINCIPAL_B64), 'text/plain', 'x').getDataAsString('UTF-8');
}

