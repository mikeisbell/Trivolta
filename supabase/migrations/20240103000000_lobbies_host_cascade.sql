-- Allow deleting a user who is a lobby host by cascading the delete
alter table public.lobbies
  drop constraint lobbies_host_id_fkey,
  add constraint lobbies_host_id_fkey
    foreign key (host_id) references public.profiles(id) on delete cascade;
