#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_hash::blake2b_256;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::Entity,
    debug,
    high_level::{load_script, load_witness_args},
};

const HASH_LEN: usize = 32;

#[derive(Debug, Clone, Copy)]
#[repr(i8)]
enum Error {
    ArgsMissing = 1,
    ArgsInvalidLength = 2,
    WitnessMissing = 3,
    PreImageMissing = 4,
    HashMismatch = 5,
}

// ============================================================
// program_entry — the CKB-VM entry point
// ============================================================
// CKB-VM calls this function and interprets the i8 return:
//   0    = success (transaction allowed)
//   != 0 = failure (transaction rejected)

pub fn program_entry() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(err) => {
            debug!("Hash lock failed with error: {:?}", err as i8);
            err as i8
        }
    }
}

// ============================================================
// run — the actual logic, using Result for clean error flow
// ============================================================
// By returning Result<(), Error>, we can use the `?` operator
// to propagate errors without nested matches. program_entry
// converts Result into the i8 code CKB-VM expects.
fn run() -> Result<(), Error> {
    // ----- 1. Load our own script and read its args -----
    let script = load_script().map_err(|_| Error::ArgsMissing)?;
    let args = script.args().raw_data();
    let args_slice: &[u8] = args.as_ref();

    debug!("args len = {}", args_slice.len());

    if args_slice.len() != HASH_LEN {
        return Err(Error::ArgsInvalidLength);
    }

    // ----- 2. Load witness args from the first input -----
    let witness_args = load_witness_args(0, Source::Input).map_err(|_| Error::WitnessMissing)?;

    // ----- 3. Extract the preimage from input_type -----
    let preimage = match witness_args.input_type().to_opt() {
        Some(bytes) => bytes.raw_data(),
        None => return Err(Error::PreImageMissing),
    };

    // ----- 4. Hash the preimage -----
    let computed_hash = blake2b_256(preimage.as_ref());

    // ----- 5. Compare with args -----
    if computed_hash.as_slice() != args_slice {
        return Err(Error::HashMismatch);
    }

    debug!("Hash lock passed");
    Ok(())
}
