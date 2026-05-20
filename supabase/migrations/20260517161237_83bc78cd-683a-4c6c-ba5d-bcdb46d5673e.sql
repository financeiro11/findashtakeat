
-- Remove sufixo /!ut/p/... dos links BNDES (token de sessão IBM WebSphere)
UPDATE public.editais
SET link = regexp_replace(link, '/!ut/p/[^?#]*', '', 'i')
WHERE link ~* '/!ut/p/';

-- Remove reticências finais e sufixos "- BNDES" / "- Finep" dos títulos
UPDATE public.editais
SET titulo = regexp_replace(regexp_replace(titulo, '\s*\.{3,}\s*$', ''), '\s+-\s+(BNDES|Finep|Sebrae|EMBRAPII|FAPES|InovAtiva|Gov\.br)\s*$', '', 'i')
WHERE titulo ~ '\.{3,}\s*$' OR titulo ~* '\s+-\s+(BNDES|Finep|Sebrae|EMBRAPII|FAPES|InovAtiva|Gov\.br)\s*$';
