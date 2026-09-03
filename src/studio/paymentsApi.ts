// paymentsApi.ts - fetch wrapper for /api/payments, roomPublishApi.ts's own
// pattern, one file over.
import { replicaRequest } from "./replicaApi";

export interface RoomPrice {
  room_id: string;
  follower_price_inr: number;
  currency: string;
  platform_take_bp: number;
  updated_at: string | null;
}

export interface RoomPayout {
  payout_id: string;
  period_start: string;
  period_end: string;
  gross_inr: number;
  take_inr: number;
  net_inr: number;
  tds_inr: number;
  state: "pending" | "paid";
}

export interface RoomRevenue {
  subscribers: number;
  churned_this_month: number;
  gross_this_month_inr: number;
  platform_take_this_month_inr: number;
  creator_share_this_month_inr: number;
  latest_payout: RoomPayout | null;
}

export class PaymentsApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(token: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await replicaRequest<T>(token, "/api/payments", { method: "POST", body: JSON.stringify(body) });
  } catch (e: any) {
    throw new PaymentsApiError(typeof e?.data?.error === "string" ? e.data.error : (e?.message || "payments_failure"), Number(e?.status || 500));
  }
}

export async function readRoomPayments(
  token: string,
  replicaId: string,
): Promise<{ price: RoomPrice | null; revenue: RoomRevenue } | null> {
  try {
    return await replicaRequest<{ price: RoomPrice | null; revenue: RoomRevenue }>(
      token,
      `/api/payments?replica_id=${encodeURIComponent(replicaId)}`,
    );
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function setRoomPriceInr(token: string, replicaId: string, priceInr: number): Promise<RoomPrice> {
  const data = await call<{ price: RoomPrice }>(token, { op: "set_price", replica_id: replicaId, price_inr: priceInr });
  return data.price;
}
