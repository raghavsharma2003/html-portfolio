// The forget receipt, pulled out of RoomApp.tsx into its own file (WS-R139)
// so it can be `React.lazy`-loaded — WS-R27 law 3's own point: it is shown
// here, on the "gone" phase, and NOWHERE else (there is nothing to look a
// forgotten follower's receipt up by later), which makes it exactly the
// kind of rarely-reached screen the brief calls out. Reached only after a
// real erasure (`DataMenu.tsx`'s own confirm flow), so almost no visit ever
// mounts this component's code at all.
//
// A DEFAULT export: `React.lazy(() => import("./ForgetReceipt"))` requires
// one.
import type { RoomCopy } from "./copy";
import type { RoomForgetReceipt } from "./roomApi";

export default function ForgetReceipt({ copy, receipt }: { copy: RoomCopy; receipt: RoomForgetReceipt }) {
  return (
    <div className="room-receipt">
      <h3>{copy.menu.receiptTitle}</h3>
      <p className="room-fine">{copy.menu.receiptBody}</p>
      <button
        type="button"
        className="room-btn"
        onClick={() => {
          const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "forget-receipt.json";
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        {copy.menu.receiptSave}
      </button>
    </div>
  );
}
