-- Rastreio de acessos dos links. Sem IP nem identificação do visitante.
create table public.acessos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  link text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  cidade text,
  uf text
);
create index acessos_link_criado_em on public.acessos (link, criado_em desc);

-- Sem políticas: só o servidor, com a chave secreta, lê e grava.
alter table public.acessos enable row level security;
revoke all on public.acessos from anon, authenticated;
grant select, insert on public.acessos to service_role;

-- Totais de um link. Datas no horário de Brasília, as duas incluídas; nulo = sem limite.
create function public.resumo_acessos(p_link text, p_de date default null, p_ate date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with base as (
    select a.*, a.criado_em at time zone 'America/Sao_Paulo' as local
    from public.acessos a
    where a.link = p_link
      and (p_de is null or a.criado_em >= p_de::timestamp at time zone 'America/Sao_Paulo')
      and (p_ate is null or a.criado_em < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'horas', coalesce((select jsonb_agg(jsonb_build_object('hora', h, 'n', n) order by h)
      from (select extract(hour from local)::int h, count(*) n from base group by 1) x), '[]'),
    'utms', coalesce((select jsonb_agg(to_jsonb(x) order by x.n desc)
      from (select utm_source, utm_medium, utm_campaign, utm_content, utm_term, count(*) n
            from base group by 1,2,3,4,5 order by n desc limit 50) x), '[]'),
    'cidades', coalesce((select jsonb_agg(to_jsonb(x) order by x.n desc)
      from (select cidade, uf, count(*) n from base group by 1,2 order by n desc limit 50) x), '[]'),
    'ultimos', coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc)
      from (select criado_em, utm_source, utm_medium, utm_campaign, utm_content, utm_term, cidade, uf
            from base order by criado_em desc limit 50) x), '[]')
  );
$$;
revoke execute on function public.resumo_acessos(text, date, date) from public, anon, authenticated;
grant execute on function public.resumo_acessos(text, date, date) to service_role;
