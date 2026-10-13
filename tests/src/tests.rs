use ckb_testtool::{
    ckb_hash::blake2b_256,
    ckb_types::{
        bytes::Bytes,
        core::{TransactionBuilder, TransactionView},
        packed::*,
        prelude::*,
    },
    context::Context,
};

use crate::verify_and_dump_failed_tx;

const MAX_CYCLES: u64 = 10_000_000;

// ============================================================
// Helpers
// ============================================================

/// Deploy the compiled `hash-lock` binary and build a lock script
/// with the given args.
fn deploy_lock_script(context: &mut Context, args: Vec<u8>) -> Script {
    let out_point = context.deploy_cell_by_name("hash-lock");
    context
        .build_script(&out_point, Bytes::from(args))
        .expect("build lock script")
}

/// Build a transaction that spends one cell locked by `lock_script`.
/// If `preimage` is `Some`, it goes into the witness's `input_type` slot.
fn build_spend_tx(
    context: &mut Context,
    lock_script: Script,
    preimage: Option<&[u8]>,
) -> TransactionView {
    // ----- Input cell: locked by our script -----
    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );
    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    // ----- Output cell: arbitrarily locked with the same script -----
    let output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(lock_script)
        .build();

    // ----- Witness: contains the preimage in `input_type`, or is empty -----
    let witness = match preimage {
        Some(p) => {
            let witness_args = WitnessArgs::new_builder()
                .input_type(Some(Bytes::from(p.to_vec())).pack())
                .build();
            witness_args.as_bytes().pack()
        }
        None => Bytes::new().pack(),
    };

    // ----- Assemble the transaction -----
    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .outputs_data(vec![Bytes::new()].pack())
        .witness(witness)
        .build();

    context.complete_tx(tx)
}

// ============================================================
// Test 1: Happy path — correct secret unlocks the cell
// ============================================================

#[test]
fn test_unlock_with_correct_preimage() {
    let mut context = Context::default();

    // The secret and its hash (must match what the script computes)
    let secret: &[u8] = b"my-secret";
    let hash = blake2b_256(secret);

    // Deploy our script with the hash as args
    let lock_script = deploy_lock_script(&mut context, hash.to_vec());

    // Build a transaction that provides the secret in the witness
    let tx = build_spend_tx(&mut context, lock_script, Some(secret));

    // Run the script in the CKB-VM
    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("correct preimage should pass");
    println!("consume cycles: {}", cycles);
}

// ============================================================
// Test 2: Wrong secret should be rejected
// ============================================================

#[test]
fn test_unlock_with_wrong_preimage() {
    let mut context = Context::default();

    let secret: &[u8] = b"my-secret";
    let wrong: &[u8] = b"not-the-secret";
    let hash = blake2b_256(secret);

    let lock_script = deploy_lock_script(&mut context, hash.to_vec());
    let tx = build_spend_tx(&mut context, lock_script, Some(wrong));

    let result = verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES);
    assert!(result.is_err(), "wrong preimage should fail");
}

// ============================================================
// Test 3: No witness at all — script should fail
// ============================================================

#[test]
fn test_unlock_without_witness() {
    let mut context = Context::default();

    let secret: &[u8] = b"my-secret";
    let hash = blake2b_256(secret);

    let lock_script = deploy_lock_script(&mut context, hash.to_vec());
    let tx = build_spend_tx(&mut context, lock_script, None);

    let result = verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES);
    assert!(result.is_err(), "missing witness should fail");
}

// ============================================================
// Test 4: Args are not 32 bytes — script should fail early
// ============================================================

#[test]
fn test_unlock_with_invalid_args_length() {
    let mut context = Context::default();

    let secret: &[u8] = b"my-secret";
    let bad_args = vec![0u8; 16]; // 16 bytes instead of 32

    let lock_script = deploy_lock_script(&mut context, bad_args);
    let tx = build_spend_tx(&mut context, lock_script, Some(secret));

    let result = verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES);
    assert!(result.is_err(), "invalid args length should fail");
}