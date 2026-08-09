import { CONFIG } from "../config";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(CONFIG.bffUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.text()) || `TEE error ${r.status}`);
  return r.json() as Promise<T>;
}

export const TeeClient = {
  state: () =>
    fetch(CONFIG.bffUrl + "/api/state").then(
      (r) => r.json() as Promise<{ signerAddress: string; signerPubKey: string }>
    ),
  submitAllocation: (pool: string, ciphertext: string) =>
    post<{ ok: boolean; count: number }>("/api/submit-allocation", { pool, ciphertext }),
  claimVerify: (b: {
    pool: string;
    recipientPubHex: string;
    challengeSig: string;
    claimAddress: string;
  }) => post<{ voucher: string }>("/api/claim-verify", b),
  complianceReport: (pool: string) =>
    post<{ totalAllocated: string; recipientCount: number; signature: string }>(
      "/api/compliance-report",
      { pool }
    ),
  unclaimedReport: (b: { pool: string; organizerPubHex: string; challengeSig: string }) =>
    post<{ report: string }>("/api/unclaimed-report", b),
};
