// O Express 4 não captura erros de funções async: este wrapper os encaminha
// para o tratador de erros (resposta 500 em JSON).
function handle(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { handle };
