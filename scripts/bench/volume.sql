-- Synthetic volume for scripts/bench/queue.ts. Run only against a throwaway
-- database (createdb nexo_assist_bench; migrate; psql -f this file).
-- 2.000 employees, 20 analysts, 150k closed conversations over two years,
-- 400 live conversations and 8 messages per conversation (~1.2M rows).
insert into users (email, name, role, department)
select 'emp' || g || '@bench.local', 'Funcionário ' || g, 'employee', 'Operações'
from generate_series(1, 2000) g;
insert into users (email, name, role, department, support_level)
select 'an' || g || '@bench.local', 'Analista ' || g, 'analyst', 'TI', 'Suporte N1'
from generate_series(1, 20) g;
insert into conversations (employee_id, state, created_at, last_activity_at, updated_at, closed_at, last_message_preview)
select u.id, 'closed', tt.t, tt.t, tt.t, tt.t, 'mensagem antiga ' || g
from generate_series(1, 150000) g
cross join lateral (select now() - (random() * 730 || ' days')::interval as t) tt
join lateral (select id from users where role = 'employee' offset (g % 2000) limit 1) u on true;
insert into conversations (employee_id, state, last_activity_at, last_message_preview)
select id,
  (array['agent_active', 'waiting_analyst', 'analyst_active'])[1 + (row_number() over ()) % 3]::conversation_state,
  now() - random() * interval '2 days', 'aberta'
from users where role = 'employee' limit 400;
update conversations set assigned_analyst_id = (select id from users where role = 'analyst' limit 1)
where state = 'analyst_active';
insert into messages (conversation_id, kind, content, created_at)
select c.id, 'employee', 'texto da mensagem número ' || g || ' sobre vpn e impressora', c.last_activity_at
from conversations c, generate_series(1, 8) g;
analyze conversations;
analyze messages;
