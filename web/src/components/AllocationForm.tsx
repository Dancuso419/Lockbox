import { useState } from "react";
import { isAddress } from "viem";
import { bytesToHex } from "viem";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TeeClient } from "@/lib/teeClient";
import { encryptToTee } from "@/lib/ecies";
import { parseHumanAmount } from "@/lib/amount";

interface Row {
  recipient: string;
  amount: string;
}

interface Props {
  pool: `0x${string}`;
  /** Decimals of the pool's asset - 18 for native C2FLR, 6 for FXRP. */
  decimals?: number;
  ticker?: string;
  /** Fired when the enclave confirms the allocation, so the stepper can move on. */
  onSubmitted?: (count: number) => void;
}

export default function AllocationForm({ pool, decimals = 18, ticker = "C2FLR", onSubmitted }: Props) {
  const [rows, setRows] = useState<Row[]>([{ recipient: "", amount: "" }]);
  const [csvText, setCsvText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submittedCount, setSubmittedCount] = useState<number | null>(null);

  function addRow() {
    setRows((prev) => [...prev, { recipient: "", amount: "" }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
    setErrors([]);
    setSubmittedCount(null);
  }

  function applyCSV() {
    const newRows: Row[] = [];
    const errs: string[] = [];
    csvText.trim().split("\n").forEach((line, i) => {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 2) { errs.push(`Line ${i + 1}: expected addr,amount`); return; }
      newRows.push({ recipient: parts[0], amount: parts[1] });
    });
    if (errs.length) { toast.error(errs.join("; ")); return; }
    setRows(newRows);
    setCsvText("");
    setErrors([]);
    setSubmittedCount(null);
  }

  function validate(): boolean {
    const errs: string[] = [];
    rows.forEach((r, i) => {
      if (!isAddress(r.recipient)) errs.push(`Row ${i + 1}: invalid address`);
      if (parseHumanAmount(r.amount, decimals) === null) {
        errs.push(
          `Row ${i + 1}: enter an amount greater than zero, at most ${decimals} decimal places`
        );
      }
    });
    setErrors(errs);
    return errs.length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    setSubmitting(true);
    setSubmittedCount(null);
    try {
      const state = await TeeClient.state();

      // Build allocation JSON — amounts as base-unit decimal strings
      // The enclave and the contract both work in base units; the organizer
      // types the amount they mean. Convert once, here.
      const table = {
        allocations: rows.map((r) => ({
          recipient: r.recipient,
          amount: parseHumanAmount(r.amount, decimals)!.toString(),
        })),
      };

      // Encrypt client-side BEFORE sending to BFF — BFF never sees plaintext
      const plaintext = new TextEncoder().encode(JSON.stringify(table));
      const ct = encryptToTee(state.signerPubKey, plaintext);
      const ciphertextHex = "0x" + bytesToHex(ct).replace(/^0x/, "");

      const { count } = await TeeClient.submitAllocation(pool, ciphertextHex);
      setSubmittedCount(count);
      onSubmitted?.(count);
      toast.success(`Allocation submitted — ${count} recipient(s) registered.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.length > 160 ? msg.slice(0, 160) + "…" : msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        Amounts are in <strong className="text-foreground">{ticker}</strong> — type{" "}
        <span className="font-mono">2.5</span> for two and a half. Each row echoes the exact
        base-unit value that gets sealed to the enclave.
      </div>

      {/* Allocation table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="text-left pb-1 pr-2">Recipient address</th>
              <th className="text-left pb-1 pr-2 w-52">Amount ({ticker})</th>
              <th className="pb-1 w-8"></th>
            </tr>
          </thead>
          <tbody className="space-y-1">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="pr-2 pb-1">
                  <Input value={r.recipient} placeholder="0x…" className="font-mono text-xs"
                    onChange={(e) => updateRow(i, "recipient", e.target.value)} />
                </td>
                <td className="pr-2 pb-1">
                  <Input value={r.amount} placeholder="0.0" className="font-mono text-xs tabular-nums"
                    onChange={(e) => updateRow(i, "amount", e.target.value)} />
                  {parseHumanAmount(r.amount, decimals) !== null && (
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      = {parseHumanAmount(r.amount, decimals)!.toString()} base units
                    </p>
                  )}
                </td>
                <td className="pb-1">
                  <Button size="sm" variant="ghost" className="px-1 text-destructive hover:text-destructive/80"
                    onClick={() => removeRow(i)} disabled={rows.length === 1}>×</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" onClick={addRow}>+ Add row</Button>

      {errors.length > 0 && (
        <div className="space-y-0.5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {/* CSV paste */}
      <details className="group">
        <summary className="cursor-pointer select-none text-sm text-glow hover:underline">
          Paste CSV (addr,amount per line)
        </summary>
        <div className="mt-2 space-y-2">
          <textarea
            className="w-full h-28 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={"0xAbc...,2.5\n0xDef...,1"}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={applyCSV} disabled={!csvText.trim()}>
            Apply CSV
          </Button>
        </div>
      </details>

      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting ? "Encrypting & submitting…" : "Submit allocation"}
      </Button>

      {submittedCount !== null && (
        <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          TEE confirmed <strong>{submittedCount}</strong> recipient(s) allocated.
        </div>
      )}
    </div>
  );
}
