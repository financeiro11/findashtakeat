-- Passagens virou aba do Radar de compras (14/09/2026): /facilities/passagens
-- passou a ser /facilities/radar/passagens. A rota antiga continua redirecionando
-- no front, mas o sino lê a rota da SÉRIE — e é dela que sai o "abrir" do aviso.
update public.sinal_serie
   set rota = '/facilities/radar/passagens'
 where serie = 'passagens.abaixo_do_teto'
   and rota = '/facilities/passagens';
