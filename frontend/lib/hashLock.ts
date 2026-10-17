import { ccc } from "@ckb-ccc/connector-react";

export const HASH_LOCK_CODE_HASH =
    "0x7a5ded487b9d3e1d3b0e32cbdfe551503145f615ccde0601c5ab5f816d5eeb25";

export const HASH_LOCK_HASH_TYPE = "data2";

export const HASH_LOCK_CELL_DEP = ccc.CellDep.from({
    outPoint: {
        txHash:
            "0x4e3475ee95b4ccb25f3c191a3d83fc0358db8033f5af2a9f42a493e213c9acea",
        index: 0,
    },
    depType: "code",
});

// ──────────────────────────────────────────────────────────
// Build a lock script for a given secret.
// Uses blake2b-256 — the same hash the Rust script verifies.
// ──────────────────────────────────────────────────────────
export function buildHashLockScript(secret: string) {
    // Converts the input secret (a string) into a Uint8Array of UTF-8 bytes.
    // For example, "hello" becomes Uint8Array([104, 101, 108, 108, 111])
    const secretBytes = new TextEncoder().encode(secret);
    const hash = ccc.hashCkb(secretBytes);

    return new ccc.Script(HASH_LOCK_CODE_HASH, HASH_LOCK_HASH_TYPE, hash);
}


// ──────────────────────────────────────────────────────────
// lockFunds — creates a cell locked by our hash-lock script
// ──────────────────────────────────────────────────────────
//
// This is the "lock" half of the dApp:
//   1. Take a secret from the user
//   2. Hash it to 32 bytes
//   3. Build a transaction that creates a new cell
//      whose lock script is { our code, the hash as args }
//   4. Sign and send

export async function lockFunds(
    signer: ccc.Signer,
    secret: string,
    amountInCKB: number
): Promise<string> {
    const lockScript = buildHashLockScript(secret);
    // Convert CKB to shannons (1 CKB = 100_000_000 shannons)
    const capacity = ccc.fixedPointFrom(amountInCKB);

    // Build an empty transaction from the signer's address
    // (this fills in a change output for the sender)

    // const { script: changeLock } = await signer.getRecommendedAddressObj();

    const tx = ccc.Transaction.from({
        outputs: [
            {
                lock: lockScript,
                capacity,
            },
        ],
        outputsData: ["0x"],
    });

    // Add the hash-lock code cell as a dependency
    tx.addCellDeps(HASH_LOCK_CELL_DEP);

    // Let CCC find the inputs needed to pay for this output,
    // add a change output, calculate fees, and complete the tx
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000); // 1000 shannons/KB fee rate

    // Sign and send
    const txHash = await signer.sendTransaction(tx);
    return txHash;
}

// ──────────────────────────────────────────────────────────
// findLockedCells — scans the chain for cells locked by our script
// ──────────────────────────────────────────────────────────
//
// Returns every cell whose lock script is:
//   { code_hash: HASH_LOCK_CODE_HASH,
//     hash_type: HASH_LOCK_HASH_TYPE,
//     args: blake2b_256(secret) }


export async function findLockedCells(client: ccc.Client, secret: string,): Promise<ccc.Cell[]> {
    const lockScript = buildHashLockScript(secret);

    const cells: ccc.Cell[] = [];
    for await (const cell of client.findCellsByLock(lockScript)) {
        cells.push(cell);
    }
    return cells;
}

// ──────────────────────────────────────────────────────────
// unlockFunds — consumes a locked cell by proving the secret
// ──────────────────────────────────────────────────────────
//
// This is the "unlock" half of the dApp:
//   1. Find the locked cell(s) by script
//   2. Build a transaction consuming them
//   3. Put the preimage in witness.input_type
//   4. Send the CKB to the signer's own address
//   5. Sign and send

export async function unlockFunds(
    signer: ccc.Signer,
    secret: string,
): Promise<string> {

    // const lockScript = buildHashLockScript(secret);


    // ----- 1. Find the locked cell(s) -----
    const cells = await findLockedCells(signer.client, secret);

    if (cells.length === 0) {
        throw new Error(
            "No locked cells found for this secret. Are you sure it's correct?",
        );
    }

    // Total CKB in the locked cells
    const totalCapacity = cells.reduce(
        (sum, cell) => sum + BigInt(cell.cellOutput.capacity),
        0n,
    );

    // ----- 2. Build the transaction -----
    // Inputs: the locked cells
    // Output: a new cell sent to the signer's own address
    const { script: signerLock } = await signer.getRecommendedAddressObj();

    const tx = ccc.Transaction.from({
        inputs: cells.map((cell) => ({ previousOutput: cell.outPoint })),
        outputs: [
            {
                lock: signerLock,
                capacity: totalCapacity, // send everything back to signer
            },
        ],
        outputsData: ["0x"],
    });

    // ----- 3. Add the preimage to the witness -----
    // CKB groups witnesses by input. Input 0's witness must contain
    // the preimage in its `inputType` slot — this is what our script reads.
    const witnessArgs = ccc.WitnessArgs.from({
        inputType: ccc.hexFrom(new TextEncoder().encode(secret)),
    });
    tx.witnesses = [ccc.hexFrom(witnessArgs.toBytes())];

    // ----- 4. Add the code cell dependency -----
    tx.addCellDeps(HASH_LOCK_CELL_DEP);

    // ----- 5. Complete inputs and fees -----
    // (The locked cells cover the output, but we need a bit extra
    //  for fees; the signer tops it up with their own cells.)
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000);

    // ----- 6. Sign and send -----
    const txHash = await signer.sendTransaction(tx);
    return txHash;
}