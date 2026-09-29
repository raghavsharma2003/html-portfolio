# GPU authorization: startup credits only

Latest owner instruction: GPU use is approved, provided startup grant credits
pay for it and the owner is not charged personally. Do not ask for GPU-use
approval again. The earlier generic activation question is superseded by this
explicit condition.

The owner then checked and reported that approximately the full $5,000 remains,
with only a small amount used. Record this as an approximate current owner
report. A subsequent API read still reports both spending limits Off and status
LimitRemoved. The unanswered item is availability/restoration of credit-only
spending protection; do not ask for GPU-use permission or repeat the balance
question without new evidence requiring a refresh.

## Actual Azure readback, September 29

GPU and staged CPU resource subscription:
`c60a32f6-c812-4c0e-bc42-b6431ee90b8f`.

| Field | Observed result |
| --- | --- |
| Subscription state | Enabled |
| Subscription quota | Sponsored_2016-01-01 |
| Subscription spending limit | Off |
| Billing agreement/type | Microsoft Customer Agreement, Benefit subscription |
| Billing profile spending limit | Off |
| Sponsorship type | StartupSponsorship |
| Initial amount in spending-limit record | USD 5,000; not a remaining balance |
| Record start | 8 July 2026 |
| Record end | 4 April 2027 |
| Spending-limit record status | LimitRemoved |
| Billing profile read with current service identity | HTTP 403 Forbidden |
| Credit-lots read at the exact returned billing profile | HTTP 401 |

The subscription's billing-property endpoint was readable, so these fields are
actual provider metadata. The current remaining balance was not returned.
Do not turn a permission error into a zero balance or a positive credit claim.

No billing setting, resource, budget, watchdog or GPU activation was changed
during this verification. Current preview and staged CPU remain as recorded in
[RELEASE.md](RELEASE.md). New private voice generation is still disabled.

## What is needed from the billing owner

Use a personal device, not this employer laptop:

1. In Azure Portal, select subscription
   `c60a32f6-c812-4c0e-bc42-b6431ee90b8f` under Subscriptions.
2. Check whether **Turn on spending limit** is available. Restore credit-only
   spending protection if the offer supports it. Do not select an upgrade or
   removal of the limit.
3. In Cost Management + Billing, open the linked billing profile's Credits
   view and check the actual remaining startup-credit amount and expiry.
   Older sponsorship accounts may expose this in the Sponsorship portal.
4. If the credit-only limit cannot be restored, the billing owner must obtain
   an applicable provider-side stop/no-paid-continuation arrangement from Azure
   Billing Support. An app budget or cost alert is not that arrangement.

The assistant asked for the remaining balance and whether the limit can be
turned on, through the text question. No key, password, card details or personal
Microsoft browser login here is requested.

Suggested support text, if needed; it has NOT been sent:

> For subscription c60a32f6-c812-4c0e-bc42-b6431ee90b8f, billing metadata shows
> StartupSponsorship with initial amount USD 5,000 and end date 4 April 2027,
> but both spending-limit fields are Off and the record status is LimitRemoved.
> I authorize startup-credit-funded usage only, with no paid continuation.
> Please confirm the remaining usable startup credits and restore or identify
> provider-enforced protection that stops eligible usage before personal charges.
> I am not requesting a pay-as-you-go upgrade or a spending-limit removal.

## Operator safeguards

The ignored `rebuild29-voice-activation.py` now reads both provider spending-limit
fields before any mutation mode or one-use intent. Off/unknown refuses before
budget insertion, job creation, runtime enablement or watchdog start. Read-only
plan/observe modes remain available. This conservative refusal is not itself a
complete future credit-monitoring solution: current balance, expiry, workload
eligibility and the applicable no-paid-continuation terms still need verification.

Once the condition is verified, use the already prepared activation sequence,
fresh source/heartbeat readbacks and a fresh own-voice attestation. Keep GPU
minReplicas=0 and never replay the expired retained-owner diagnostic. Existing
keys are available through authorized APIs; do not ask the owner to paste them.

## Evidence and official references

Content-free receipts in original checkout `scratchpad/expert-tools`:

- `CREDIT-ONLY-VERIFY-1790667711923364100.json`
- `CREDIT-ONLY-PROFILE-1790667830376650500.json`
- `CREDIT-ONLY-BILLING-GUARD-1790667898019703300.json`

The preliminary balances endpoint returned a non-JSON 404; a status-aware
reader recorded that failure. The exact MCA billing-profile credit-lots
endpoint then returned 401. No undocumented billing write was attempted.

Microsoft's [sponsorship offer terms](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0036p/)
describe conversion to paid usage at the usage cap or end date, unless an
applicable exception exists. Microsoft's [spending-limit documentation](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit)
describes credit-linked stopping behavior and exclusions. The [billing-property API](https://learn.microsoft.com/en-us/rest/api/billing/billing-property/get?view=rest-billing-2024-04-01)
defines the exact returned limit, type and status fields. These general pages
do not override the owner's specific offer or establish its remaining balance.
