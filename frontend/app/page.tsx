"use client";

import { useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import ConnectWallet from "@/components/ConnectWallet";
import { lockFunds, unlockFunds, findLockedCells } from "@/lib/hashLock";

export default function Home() {
  const signer = ccc.useSigner();

  const [secret, setSecret] = useState("");
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState<{
    kind: "idle" | "info" | "error" | "success";
    message: string;
  }>({ kind: "idle", message: "" });

  const isConnected = !!signer;

  // ────────────────────────────────────────────────────────
  // Lock: hash the secret, create a locked cell
  // ────────────────────────────────────────────────────────
  async function handleLock() {
    if (!signer) return;
    setStatus({ kind: "info", message: "Locking funds..." });
    try {
      const amountNum = Number(amount);
      if (!amountNum || amountNum <= 0) throw new Error("Invalid amount");
      if (!secret) throw new Error("Secret cannot be empty");

      const txHash = await lockFunds(signer, secret, amountNum);
      setStatus({
        kind: "success",
        message: `Locked! Tx: ${txHash.slice(0, 12)}...`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });

      console.log("Client URL:", signer.client.url);

    }
  }

  // ────────────────────────────────────────────────────────
  // Unlock: consume the locked cell using the secret
  // ────────────────────────────────────────────────────────
  async function handleUnlock() {
    if (!signer) return;
    setStatus({ kind: "info", message: "Unlocking..." });
    try {
      if (!secret) throw new Error("Secret cannot be empty");

      const txHash = await unlockFunds(signer, secret);
      setStatus({
        kind: "success",
        message: `Unlocked! Tx: ${txHash.slice(0, 12)}...`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ────────────────────────────────────────────────────────
  // Check: how many cells are locked with this secret?
  // ────────────────────────────────────────────────────────
  async function handleCheck() {
    if (!signer) return;
    setStatus({ kind: "info", message: "Searching..." });
    try {
      if (!secret) throw new Error("Secret cannot be empty");

      const cells = await findLockedCells(signer.client, secret);
      if (cells.length === 0) {
        setStatus({ kind: "info", message: "No locked cells found." });
      } else {
        const total = cells.reduce(
          (sum, c) => sum + BigInt(c.cellOutput.capacity),
          0n,
        );
        setStatus({
          kind: "success",
          message: `Found ${cells.length} cell(s) totaling ${ccc.fixedPointToString(total)} CKB`,
        });
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="min-h-screen p-8 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="max-w-2xl mx-auto flex flex-col gap-8">
        <header className="flex flex-col items-center gap-4">
          <h1 className="text-4xl font-bold">Hash Lock dApp</h1>
          <p className="text-sm opacity-70">
            Lock CKB with a secret. Unlock it later by proving you know the
            secret.
          </p>
          <ConnectWallet />
        </header>

        <section className="border border-white/20 rounded-2xl p-6 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Secret</span>
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter a secret phrase"
              className="bg-black/30 border border-white/20 rounded-lg px-4 py-2 font-mono"
            />
            <span className="text-xs opacity-60">
              Anyone who knows this secret can unlock the funds.
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Amount (CKB)</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
              className="bg-black/30 border border-white/20 rounded-lg px-4 py-2 font-mono"
            />
            <span className="text-xs opacity-60">
              Only used when locking. Ignored on unlock.
            </span>
          </label>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleLock}
              disabled={!isConnected}
              className="rounded-lg px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Lock
            </button>
            <button
              onClick={handleUnlock}
              disabled={!isConnected}
              className="rounded-lg px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Unlock
            </button>
            <button
              onClick={handleCheck}
              disabled={!isConnected}
              className="rounded-lg px-5 py-2 border border-white/20 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Check
            </button>
          </div>

          {!isConnected && (
            <p className="text-xs opacity-60">
              Connect your wallet to lock or unlock funds.
            </p>
          )}
        </section>

        {status.kind !== "idle" && (
          <section
            className={
              "rounded-xl p-4 border text-sm font-mono break-all " +
              (status.kind === "success"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : status.kind === "error"
                  ? "border-red-500/50 bg-red-500/10 text-red-300"
                  : "border-white/20 bg-white/5")
            }
          >
            {status.message}
          </section>
        )}
      </main>
    </div>
  );
}