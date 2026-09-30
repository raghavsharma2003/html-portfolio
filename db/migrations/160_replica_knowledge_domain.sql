alter table vy_replica_claim
  drop constraint if exists vy_replica_claim_domain_check,
  add constraint vy_replica_claim_domain_check check (domain in (
    'identity','biography','event','relationship','preference','knowledge',
    'value','boundary','habit','language','delivery','visual'
  ));
