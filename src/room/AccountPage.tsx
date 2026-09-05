/* THE FOLLOWER'S OWN PAGE (WS-R39).
 *
 * Everything a follower can decide about themselves, in one screen, reached
 * from the Room's header. Every decision here is made through an op this
 * product already ships — `api/_room-surface.js`'s own header names the
 * wall this file's data comes from: `roomSettings` composes six existing
 * reads into one round trip; every WRITE below (memory consent, channel
 * toggles, locale, subscribe, export, forget) is the SAME op the scattered
 * controls this page consolidates already called.
 *
 * `DataMenu`'s shape (`RoomApp.tsx`), one level up: `role="dialog"`,
 * `.room-menu`/`.room-btn`/`.room-fine`, so a reader who knows one dialog in
 * this app knows this one. Owns no decision itself — every rule that decides
 * WHETHER a write succeeds lives server side, where the offline suite can
 * reach it.
 */
import { useCallback, useEffect, useState } from "react";
import type { StudioSession } from "../studio/types";
import type { RoomCopy, RoomLocale } from "./copy";
import { LocalizedName, LocalizedDisclosure } from "./Localized";
import { withPrice, withDuration, dormancyDurationLabel } from "./copy";
import {
  RoomApiError,
  exportRoomData,
  followerFlags,
  forgetRoomData,
  markSettingsReviewed,
  pushSubscribe,
  pushUnsubscribe,
  unflagReply,
  whatsappOptIn,
  whatsappStop,
  roomSettings as fetchRoomSettings,
  roomReferralLink,
  type RoomFlag,
  type RoomForgetReceipt,
  type RoomSettings,
} from "./roomApi";
import { listCheckinDesignsAndPushKey, setTelegramCheckins } from "./roomCheckinsApi";
import { paymentStatus, type RoomPaymentStatus } from "./roomPayApi";
import { activateOnKey, LanguageSwitch } from "./RoomApp";
import { useDialogInView } from "./useDialogInView";

/** RFC 4648 base64url, both directions — `CheckinsPanel.tsx`'s own pair,
 *  reused verbatim rather than re-typed: the same encoding a browser
 *  `PushSubscription` and the VAPID public key share whichever screen asks
 *  for one. */
function b64uToUint8Array(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const base64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bufToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function formatDate(iso: string, locale: RoomLocale): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

interface Props {
  session: string;
  copy: RoomCopy;
  locale: RoomLocale;
  name: string;
  auth: StudioSession | null;
  remembers: boolean;
  memoryBusy: boolean;
  onMemoryChange: (next: boolean) => void;
  localeBusy: boolean;
  onSwitchLocale: (next: RoomLocale) => void;
  payBusy: boolean;
  payError: string;
  onSubscribe: () => void;
  onReviewed: (at: string | null) => void;
  onClose: () => void;
  onForgotten: (receipt: RoomForgetReceipt | null) => void;
  /** The layout gate's own seam — no network, `RoomApp.tsx`'s `fixtureOpen`
   *  precedent one component over. */
  fixtureSettings?: RoomSettings;
  fixturePayment?: RoomPaymentStatus;
  /** WS-R86 (migration 123). The layout gate's own seam, one control over -
   *  no network reaches `roomReferralLink` from the fixture, so this
   *  supplies the "Bring a friend" card's own state directly, the same
   *  way `fixtureSettings` already does for the rest of this page. Without
   *  it the card would never render under the layout gate at all, which
   *  is exactly the trap `context/rejected.md`'s own published-Share-tab
   *  entry names: an unrendered screen state hides its real strings from
   *  the glyph pass. */
  fixtureReferralUrl?: string;
}

export default function AccountPage({
  session,
  copy,
  locale,
  name,
  auth,
  remembers,
  memoryBusy,
  onMemoryChange,
  localeBusy,
  onSwitchLocale,
  payBusy,
  payError,
  onSubscribe,
  onReviewed,
  onClose,
  onForgotten,
  fixtureSettings,
  fixturePayment,
  fixtureReferralUrl,
}: Props) {
  const [settings, setSettings] = useState<RoomSettings | null>(fixtureSettings ?? null);
  const [payment, setPayment] = useState<RoomPaymentStatus | null>(fixturePayment ?? null);
  // `api/checkins.js`'s `designs` op is the ONE server-driven source of the
  // VAPID public key (`CheckinsPanel.tsx`'s own precedent) — asked for here
  // rather than folded into `roomSettings`, since a second copy of that value
  // is a second place it could drift from the deployment's own
  // `ROOM_PUSH_VAPID_PUBLIC`. `null` means unset: the push control below
  // renders nothing, never shown-and-disabled.
  const [pushKey, setPushKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingForget, setConfirmingForget] = useState(false);
  // WS-R67 (migration 116). This follower's own flags, this Room only -
  // `followerFlags`'s own read joins the AI's reply text back in from the
  // creator's content-free lane, so this page never has to keep its own
  // copy of it.
  const [flags, setFlags] = useState<RoomFlag[]>([]);
  const [withdrawingHash, setWithdrawingHash] = useState<string | null>(null);
  // WS-R86 (migration 123). "Bring a friend" - the server mints the hash,
  // this page only ever displays the RELATIVE path it returns, prefixed
  // with the browser's own origin (`RoomApp.tsx`'s own `shareUrl`
  // precedent one field over, `roomReferralLink`'s own header on why the
  // server never composes an absolute URL itself).
  const [referralUrl, setReferralUrl] = useState<string | null>(fixtureReferralUrl ?? null);
  const [referralCopied, setReferralCopied] = useState(false);

  // WS-R63: scroll into view, focus in, Escape closes, focus returns to the
  // opener on close - `useDialogInView`'s own header.
  const dialogRef = useDialogInView(onClose);

  // WS-R39: one composed read, once, when the page opens — never on a fixture
  // (the layout gate has no network at all, `RoomApp.tsx`'s own rule for
  // every effect in this file). The reviewed write rides along, best effort:
  // a follower who opened this page looked at it whether or not the write
  // lands, so a failed mark must never block the page from rendering.
  useEffect(() => {
    if (fixtureSettings) return;
    let live = true;
    (async () => {
      try {
        const [s, p, dp] = await Promise.all([
          fetchRoomSettings(session),
          paymentStatus(session).catch(() => null),
          listCheckinDesignsAndPushKey(session).catch(() => null),
        ]);
        if (!live) return;
        setSettings(s);
        setPayment(p);
        setPushKey(dp?.push_public_key ?? null);
      } catch {
        if (live) setError(copy.errors.generic);
      }
    })();
    void markSettingsReviewed(session)
      .then((r) => onReviewed(r.settings_reviewed_at))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [session, fixtureSettings]);

  // WS-R67. Never on a fixture, the settings effect's own rule restated.
  useEffect(() => {
    if (fixtureSettings) return;
    let live = true;
    followerFlags(session)
      .then((result) => { if (live) setFlags(result.flags); })
      .catch(() => {});
    return () => { live = false; };
  }, [session, fixtureSettings]);

  // WS-R86. Never on a fixture, the flags effect's own rule restated - a
  // failed mint simply leaves the card absent (`referralUrl` stays null),
  // never a page-wide error for a growth feature.
  useEffect(() => {
    if (fixtureSettings) return;
    let live = true;
    roomReferralLink(session)
      .then((r) => { if (live) setReferralUrl(r.url); })
      .catch(() => {});
    return () => { live = false; };
  }, [session, fixtureSettings]);

  const copyReferralLink = useCallback(async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard?.writeText(`${window.location.origin}${referralUrl}`);
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2000);
    } catch {
      // Honest silence, `switchLocale`'s own posture: nothing to undo, the
      // next tap tries again.
    }
  }, [referralUrl]);

  const withdrawFlag = useCallback(async (replySha256: string) => {
    setWithdrawingHash(replySha256);
    setError("");
    try {
      await unflagReply(session, replySha256);
      setFlags((prev) => prev.filter((f) => f.reply_sha256 !== replySha256));
    } catch {
      setError(copy.errors.generic);
    } finally {
      setWithdrawingHash(null);
    }
  }, [session, copy]);

  const [pushOn, setPushOn] = useState(false);
  const [waOn, setWaOn] = useState(false);
  const [waPhoneMasked, setWaPhoneMasked] = useState<string | null>(null);
  const [waPhone, setWaPhone] = useState("");
  const [tgOn, setTgOn] = useState(false);
  const [tgStopped, setTgStopped] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setPushOn(settings.channels.push.subscribed);
    setWaOn(settings.channels.whatsapp.subscribed);
    setWaPhoneMasked(settings.channels.whatsapp.phone_masked);
    setTgOn(settings.channels.telegram.checkins_enabled);
    setTgStopped(settings.channels.telegram.stopped);
  }, [settings]);

  const togglePush = useCallback(async () => {
    if (fixtureSettings) return;
    setBusy("push");
    setError("");
    try {
      if (pushOn) {
        const registration = await navigator.serviceWorker.getRegistration("/room-sw.js");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await pushUnsubscribe(session, subscription.endpoint);
          await subscription.unsubscribe();
        }
        setPushOn(false);
      } else {
        if (!pushKey) return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("push_unsupported");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("push_denied");
        const registration = await navigator.serviceWorker.register("/room-sw.js");
        await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64uToUint8Array(pushKey),
          }));
        const endpoint = subscription.endpoint;
        const p256dh = bufToB64u(subscription.getKey("p256dh"));
        const auth256 = bufToB64u(subscription.getKey("auth"));
        await pushSubscribe(session, endpoint, p256dh, auth256);
        setPushOn(true);
      }
    } catch {
      setError(copy.checkins.pushError);
    } finally {
      setBusy(null);
    }
  }, [fixtureSettings, pushOn, pushKey, session, copy]);

  const saveWhatsapp = useCallback(async () => {
    if (fixtureSettings) return;
    setBusy("whatsapp");
    setError("");
    try {
      const result = await whatsappOptIn(session, waPhone.trim());
      setWaOn(true);
      setWaPhoneMasked(result.phone_masked);
      setWaPhone("");
    } catch (e) {
      setError(
        e instanceof RoomApiError && e.code === "room_whatsapp_phone_invalid"
          ? copy.checkins.waPhoneInvalid
          : copy.checkins.waError,
      );
    } finally {
      setBusy(null);
    }
  }, [fixtureSettings, session, waPhone, copy]);

  const disableWhatsapp = useCallback(async () => {
    if (fixtureSettings) return;
    setBusy("whatsapp");
    setError("");
    try {
      await whatsappStop(session);
      setWaOn(false);
      setWaPhoneMasked(null);
    } catch {
      setError(copy.checkins.waError);
    } finally {
      setBusy(null);
    }
  }, [fixtureSettings, session, copy]);

  const toggleTelegram = useCallback(async () => {
    if (fixtureSettings) return;
    setBusy("telegram");
    setError("");
    try {
      const result = await setTelegramCheckins(session, !tgOn);
      setTgOn(result.checkins_enabled);
      if (result.checkins_enabled) setTgStopped(false);
    } catch {
      setError(copy.checkins.tgError);
    } finally {
      setBusy(null);
    }
  }, [fixtureSettings, session, tgOn, copy]);

  const download = useCallback(async () => {
    if (!auth || fixtureSettings) return;
    setBusy("export");
    setError("");
    try {
      const dump = await exportRoomData(session, auth.accessToken);
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "your-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(copy.errors.generic);
    } finally {
      setBusy(null);
    }
  }, [auth, fixtureSettings, session, copy]);

  const confirmForget = useCallback(async () => {
    if (!auth || fixtureSettings) return;
    setBusy("forget");
    setError("");
    try {
      const result = await forgetRoomData(session, auth.accessToken);
      onForgotten(result.receipt ?? null);
    } catch {
      setError(copy.errors.generic);
    } finally {
      setBusy(null);
    }
  }, [auth, fixtureSettings, session, copy, onForgotten]);

  const priceLabel =
    settings?.price != null
      ? `₹${settings.price.price_inr}`
      : null;

  const subscriptionState = payment?.subscription?.state ?? null;
  const subscriptionSentence = subscriptionState
    ? copy.account.subscriptionStates[subscriptionState as keyof typeof copy.account.subscriptionStates] ??
      copy.account.subscriptionStates.active
    : copy.account.subscriptionFree;

  return (
    <section
      className="room-menu room-account"
      role="dialog"
      aria-modal="true"
      aria-label={copy.account.title}
      ref={dialogRef}
    >
      <h2>{copy.account.title}</h2>
      {error && <p className="room-error">{error}</p>}

      {/* THE DISCLOSURE, REPEATED — the same bytes the Room's own top-of-thread
          card renders, never paraphrased. WS-R39 law 1: this page names nothing
          about another follower or the creator's material beyond what that
          card already says on every screen. */}
      <h3 className="room-checkins-subhead">{copy.account.disclosureTitle}</h3>
      <div className="room-card" role="note">
        {/* WS-R79: same reasoning as `RoomApp.tsx`'s own three disclosure
            renders — tagged from its own characters, never from this page's
            document `lang`. */}
        <LocalizedDisclosure text={settings?.disclosure || ""} />
      </div>

      {/* WS-R86 (migration 123). "Bring a friend" - under the disclosure,
          this workstream's own law 3. Absent (never shown-and-disabled)
          until the server has actually minted a link, honest empty state,
          `pushKey`'s own "renders nothing when unset" posture one control
          up. */}
      {referralUrl && (
        <>
          <h3 className="room-checkins-subhead">{copy.referral.title}</h3>
          <p className="room-fine">{copy.referral.note}</p>
          <div className="room-actions">
            <p className="room-fine room-referral-url">{`${window.location.origin}${referralUrl}`}</p>
            <button
              type="button"
              className="room-btn"
              onPointerDown={() => void copyReferralLink()}
              onKeyDown={activateOnKey(() => void copyReferralLink())}
            >
              {referralCopied ? copy.referral.copied : copy.referral.copy}
            </button>
          </div>
        </>
      )}

      <h3 className="room-checkins-subhead">{copy.account.memoryTitle}</h3>
      <p className="room-fine">{remembers ? copy.account.memoryOn : copy.account.memoryOff}</p>
      <div className="room-actions">
        <button
          type="button"
          className="room-btn"
          disabled={memoryBusy || !auth}
          onPointerDown={() => onMemoryChange(!remembers)}
          onKeyDown={activateOnKey(() => onMemoryChange(!remembers))}
        >
          {memoryBusy ? copy.pay.working : remembers ? copy.account.memoryDisable : copy.account.memoryEnable}
        </button>
      </div>

      <h3 className="room-checkins-subhead">{copy.account.localeTitle}</h3>
      <LanguageSwitch locale={locale} busy={localeBusy} onSwitch={onSwitchLocale} />

      <h3 className="room-checkins-subhead">{copy.account.channelsTitle}</h3>
      <p className="room-fine">{copy.account.channelsNote}</p>
      {pushKey && (
        <div className="room-checkins-push">
          <p className="room-fine">{pushOn ? copy.checkins.pushOnCopy : copy.checkins.pushOffCopy}</p>
          <button
            type="button"
            className="room-btn"
            disabled={busy === "push"}
            onPointerDown={() => void togglePush()}
            onKeyDown={activateOnKey(() => void togglePush())}
          >
            {busy === "push" ? copy.pay.working : pushOn ? copy.checkins.pushDisable : copy.checkins.pushEnable}
          </button>
        </div>
      )}
      {settings?.channels.whatsapp.available && (
        <div className="room-checkins-push room-checkins-wa">
          <h4 className="room-checkins-subhead">{copy.checkins.waTitle}</h4>
          <p className="room-fine">
            {waOn && waPhoneMasked ? copy.checkins.waOnCopy.replace("{phone}", waPhoneMasked) : copy.checkins.waOffCopy}
          </p>
          {waOn ? (
            <button
              type="button"
              className="room-btn"
              disabled={busy === "whatsapp"}
              onPointerDown={() => void disableWhatsapp()}
              onKeyDown={activateOnKey(() => void disableWhatsapp())}
            >
              {busy === "whatsapp" ? copy.pay.working : copy.checkins.waDisable}
            </button>
          ) : (
            <div className="room-checkins-wa-form">
              <label className="room-fine">
                {copy.checkins.waPhoneLabel}
                <input
                  type="tel"
                  value={waPhone}
                  placeholder={copy.checkins.waPhonePlaceholder}
                  onChange={(e) => setWaPhone(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="room-btn"
                disabled={busy === "whatsapp" || !waPhone.trim()}
                onPointerDown={() => void saveWhatsapp()}
                onKeyDown={activateOnKey(() => void saveWhatsapp())}
              >
                {busy === "whatsapp" ? copy.pay.working : copy.checkins.waSave}
              </button>
            </div>
          )}
        </div>
      )}
      {settings?.channels.telegram.connected && (
        <div className="room-checkins-push room-checkins-tg">
          <h4 className="room-checkins-subhead">{copy.checkins.tgTitle}</h4>
          <p className="room-fine">
            {tgStopped ? copy.checkins.tgStoppedCopy : tgOn ? copy.checkins.tgOnCopy : copy.checkins.tgOffCopy}
          </p>
          <button
            type="button"
            className="room-btn"
            disabled={busy === "telegram"}
            onPointerDown={() => void toggleTelegram()}
            onKeyDown={activateOnKey(() => void toggleTelegram())}
          >
            {busy === "telegram" ? copy.pay.working : tgOn ? copy.checkins.tgDisable : copy.checkins.tgEnable}
          </button>
        </div>
      )}

      <h3 className="room-checkins-subhead">{copy.account.subscriptionTitle}</h3>
      <p className="room-fine">{subscriptionSentence}</p>
      {/* WS-R43: `room-num` (room.css) marks a figure a follower actually
          reads as a number — a price, a date — so its digits stay tabular. */}
      {priceLabel && (
        <p className="room-fine room-num">{withPrice(copy.account.subscriptionPrice, priceLabel)}</p>
      )}
      {payment?.subscription?.current_period_end && (
        <p className="room-fine room-num">
          {copy.account.subscriptionRenews.split("{date}").join(formatDate(payment.subscription.current_period_end, locale))}
        </p>
      )}
      {payment?.tier === "free" ? (
        <div className="room-actions">
          <button
            type="button"
            className="room-btn primary"
            disabled={payBusy}
            onPointerDown={onSubscribe}
            onKeyDown={activateOnKey(onSubscribe)}
          >
            {payBusy ? copy.pay.working : copy.pay.cta}
          </button>
          {payError && <p className="room-error">{payError}</p>}
        </div>
      ) : (
        // WS-R37's cancel op may not be in this tree yet — an honest state,
        // never a dead button (`context/rejected.md#a-step-is-never-silently-blocked`).
        <p className="room-fine">{copy.account.subscriptionNoCancel}</p>
      )}

      <h3 className="room-checkins-subhead">{copy.flag.accountTitle}</h3>
      {flags.length === 0 ? (
        <p className="room-fine">{copy.flag.accountEmpty}</p>
      ) : (
        <ul className="room-checkins-list">
          {flags.map((f) => (
            <li key={f.reply_sha256} className="room-checkins-row room-checkins-row--pickable">
              <p className="room-fine">{f.reply_text}</p>
              <p className="room-fine">{copy.flag.reasons[f.reason]}</p>
              <p className="room-fine">{formatDate(f.created_at, locale)}</p>
              <button
                type="button"
                className="room-btn"
                disabled={withdrawingHash === f.reply_sha256}
                onPointerDown={() => void withdrawFlag(f.reply_sha256)}
                onKeyDown={activateOnKey(() => void withdrawFlag(f.reply_sha256))}
              >
                {withdrawingHash === f.reply_sha256 ? copy.flag.withdrawing : copy.flag.withdraw}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* WS-R75 (migration 119). Nothing renders when the creator has never
          turned dormancy on - `settings.room.dormancy_days` is null in that
          case, the same "null means off" contract the database column
          itself carries. */}
      {settings != null && settings.room.dormancy_days != null && (
        <p className="room-fine">
          {withDuration(copy.dormancy.note, dormancyDurationLabel(settings.room.dormancy_days, locale))}
        </p>
      )}

      <h3 className="room-checkins-subhead">{copy.account.dataTitle}</h3>
      <div className="room-actions">
        <button
          type="button"
          className="room-btn"
          disabled={busy === "export" || !auth}
          onPointerDown={() => void download()}
          onKeyDown={activateOnKey(() => void download())}
        >
          {busy === "export" ? copy.pay.working : copy.menu.download}
        </button>
        <p className="room-fine">{copy.menu.downloadNote}</p>

        {!confirmingForget ? (
          <button
            type="button"
            className="room-btn danger"
            onPointerDown={() => setConfirmingForget(true)}
            onKeyDown={activateOnKey(() => setConfirmingForget(true))}
          >
            {copy.menu.forget}
          </button>
        ) : (
          <>
            <p className="room-fine">
              <LocalizedName template={copy.menu.forgetNote} name={name} />
            </p>
            <button
              type="button"
              className="room-btn danger"
              disabled={busy === "forget" || !auth}
              onPointerDown={() => void confirmForget()}
              onKeyDown={activateOnKey(() => void confirmForget())}
            >
              {busy === "forget" ? copy.pay.working : copy.menu.forgetConfirm}
            </button>
            <button
              type="button"
              className="room-btn"
              onPointerDown={() => setConfirmingForget(false)}
              onKeyDown={activateOnKey(() => setConfirmingForget(false))}
            >
              {copy.menu.forgetCancel}
            </button>
          </>
        )}

        <button type="button" className="room-btn" onPointerDown={onClose} onKeyDown={activateOnKey(onClose)}>
          {copy.account.close}
        </button>
      </div>
    </section>
  );
}
