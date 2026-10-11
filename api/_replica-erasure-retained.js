// Deleting one AI does not authorize deleting shared account state. This is
// the complete inventory retained by every per-replica erasure caller, not an
// exemption from owner export or a claim that account erasure is implemented.
// relcheck must prove these tables are neither explicitly deleted nor reached
// by a replica cascade. Any addition needs its own ownership justification.
export const REPLICA_ERASURE_RETAINED_ACCOUNT_TABLES = Object.freeze({
  vy_creator_payout: "Account-wide payout history spans the owner's replicas; deleting one AI does not authorize deleting that financial history.",
  vy_creator_payout_account: "The owner's payout destination is shared across replicas; deleting one AI does not authorize removing the account's payout configuration.",
  vy_creator_invite: "redeemed_by_user_id records account admission, not ownership of one replica; deleting one AI does not revoke or erase that admission.",
  vy_org_member: "Organization membership belongs to the owner account and can support other replicas; deleting one AI does not authorize ending that membership.",
  vy_operator_push_subscription: "Operator notification credentials belong to the account's operator role across replicas; deleting one AI does not authorize removing them.",
  vy_creator_push_subscription: "Creator notification credentials belong to the account across replicas; deleting one AI does not authorize removing them.",
});
