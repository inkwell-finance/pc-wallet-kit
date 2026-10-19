// Copyright (c) dWallet Labs, Ltd.
// Copyright (c) 2026 Inkwell Finance (epoch-2 hardening)
// SPDX-License-Identifier: BSD-3-Clause-Clear

#![allow(unexpected_cfgs)]

/// PC-Token (Confidential Performant Token) — P-Token rebuilt with
/// Encrypt FHE for on-chain confidentiality.
///
/// All balances and transfer amounts are encrypted. There is no
/// decrypt instruction on the TokenAccount — balances are never
/// revealed on-chain. The only plaintext values that ever appear
/// are wrap/unwrap amounts at the SPL boundary, and those live on
/// temporary WithdrawalReceipt accounts that get closed immediately.
///
/// ## Epoch-2 hardening (Inkwell fork)
///
/// Every program account is loaded through `load`/`load_mut`: owned by this
/// program and of the exact length of its type (the four layouts have
/// distinct sizes, so a Vault cannot pass as a TokenAccount). The Encrypt
/// program is a compile-time constant and `caller` must be this program, so
/// the CPI-authority signature is never handed to anything else. Wrap mints
/// a ciphertext the program creates from the SPL amount it just moved, and
/// the unwrap steps are bound together by the receipt (burned ciphertext,
/// vault, pc mint, decryption request).
///
/// ## Instructions (P-Token discriminators)
///
///  0. InitializeMint
///  1. InitializeAccount
///  3. Transfer (encrypted amount)
///  4. Approve (encrypted allowance)
///  5. Revoke
/// 10. FreezeAccount
/// 11. ThawAccount
/// 20. TransferFrom (delegate, composability)
/// 22. TransferWithReceipt
/// 23. InitializeVault (requires the pc mint authority)
/// 30. Wrap (SPL → pcToken)
/// 31. UnwrapBurn (burn pcTokens + create withdrawal receipt)
/// 32. UnwrapDecrypt (request decryption of burned amount)
/// 33. UnwrapComplete (verify + release SPL tokens + close receipt)
/// 40. ViewBalance (owner-authorized copy of the balance)
///
/// Standalone MintTo (7), Burn (8) and CloseAccount (9) are not implemented:
/// tokens only enter through Wrap and only leave through Unwrap.
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_pinocchio::accounts;
use encrypt_pinocchio::EncryptContext;
use encrypt_types::encrypted::{EUint64, Uint64};
use pinocchio::{
    cpi::{Seed, Signer},
    entrypoint,
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer as SplTransfer;

entrypoint!(process_instruction);

// ── Program ids ──

/// pc-token, devnet epoch 2: `3kjJEx6G1XdrtixFg9f8eGRAyzW5QmhsJQq6qCUZYhXZ`.
pub const ID: Address = Address::new_from_array([
    40, 235, 44, 158, 173, 253, 55, 205, 13, 122, 126, 12, 23, 135, 0, 47, 205, 91, 160, 69, 32,
    176, 41, 50, 186, 139, 166, 110, 92, 232, 79, 4,
]);

/// Encrypt program on devnet: `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`.
#[cfg(not(feature = "localnet"))]
pub const ENCRYPT_ID: Address = Address::new_from_array([
    54, 52, 193, 56, 216, 205, 66, 173, 150, 219, 76, 71, 2, 69, 247, 186, 158, 244, 102, 172,
    211, 224, 217, 69, 221, 212, 114, 161, 199, 34, 86, 139,
]);

/// Encrypt program as deployed by the `encrypt-solana-test` LiteSVM harness:
/// `Cq37zHSH1zB6xomYK2LjP6uXJvLR3uTehxA5W9wgHGvx`.
#[cfg(feature = "localnet")]
pub const ENCRYPT_ID: Address = Address::new_from_array([
    175, 190, 213, 40, 242, 81, 150, 134, 222, 39, 3, 15, 110, 91, 65, 64, 171, 126, 206, 36,
    245, 170, 97, 22, 255, 187, 65, 204, 51, 109, 125, 133,
]);

/// SPL Token program.
pub const SPL_TOKEN_ID: Address = pinocchio_token::ID;
/// System program.
pub const SYSTEM_ID: Address = Address::new_from_array([0u8; 32]);

/// Length of an SPL Token account (`spl_token::state::Account::LEN`).
const SPL_ACCOUNT_LEN: usize = 165;
/// Length of an SPL Token mint (`spl_token::state::Mint::LEN`).
const SPL_MINT_LEN: usize = 82;

// ── Errors ──

/// Custom error codes added by the epoch-2 hardening. Values are stable ABI.
pub mod err {
    use pinocchio::error::ProgramError;
    /// The Encrypt program account is not the pinned Encrypt program.
    pub const FOREIGN_ENCRYPT: ProgramError = ProgramError::Custom(0x100);
    /// `caller` is not this program.
    pub const WRONG_CALLER: ProgramError = ProgramError::Custom(0x101);
    /// The vault is not the canonical vault PDA of the token account's mint.
    pub const BAD_VAULT: ProgramError = ProgramError::Custom(0x102);
    /// The vault SPL account is not an SPL account of the vault's mint owned by the vault.
    pub const BAD_VAULT_ATA: ProgramError = ProgramError::Custom(0x103);
    /// The token program account is not SPL Token.
    pub const BAD_TOKEN_PROGRAM: ProgramError = ProgramError::Custom(0x104);
    /// An account that the program creates is not a fresh, empty, signing system account.
    pub const NOT_FRESH: ProgramError = ProgramError::Custom(0x105);
    /// The account does not match the one recorded in the withdrawal receipt.
    pub const RECEIPT_MISMATCH: ProgramError = ProgramError::Custom(0x106);
    /// Decryption was already requested for this receipt.
    pub const DECRYPT_ALREADY_REQUESTED: ProgramError = ProgramError::Custom(0x107);
    /// UnwrapComplete before UnwrapDecrypt.
    pub const DECRYPT_NOT_REQUESTED: ProgramError = ProgramError::Custom(0x108);
    /// Two slots that must differ name the same account.
    pub const ALIASED: ProgramError = ProgramError::Custom(0x109);
    /// A user-supplied bump is not the canonical bump of its PDA.
    pub const NON_CANONICAL_BUMP: ProgramError = ProgramError::Custom(0x10A);
    /// The decryption request is not owned by Encrypt.
    pub const BAD_REQUEST: ProgramError = ProgramError::Custom(0x10B);
    /// The signer is not the pc mint authority.
    pub const NOT_MINT_AUTHORITY: ProgramError = ProgramError::Custom(0x10C);
    /// A delegate is already set; Revoke first.
    pub const DELEGATE_SET: ProgramError = ProgramError::Custom(0x10D);
    /// The SPL mint account is not an SPL Token mint.
    pub const BAD_SPL_MINT: ProgramError = ProgramError::Custom(0x10E);
}

// ── AccountState ──

#[derive(Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum AccountState { Uninitialized = 0, Initialized = 1, Frozen = 2 }
impl From<u8> for AccountState { fn from(v: u8) -> Self { match v { 1 => Self::Initialized, 2 => Self::Frozen, _ => Self::Uninitialized } } }

const COPTION_NONE: [u8; 4] = [0, 0, 0, 0];
const COPTION_SOME: [u8; 4] = [1, 0, 0, 0];

// ── Account layouts ──

/// A fixed-size, byte-aligned account layout owned by this program.
///
/// # Safety
/// Implementors must be `#[repr(C)]` with alignment 1 and no padding, so any
/// `LEN`-byte buffer is a valid value.
pub unsafe trait Layout: Sized {
    const LEN: usize = core::mem::size_of::<Self>();
}

#[repr(C)]
pub struct Mint {
    pub mint_authority_flag: [u8; 4],
    pub mint_authority: [u8; 32],
    pub decimals: u8,
    pub is_initialized: u8,
    pub freeze_authority_flag: [u8; 4],
    pub freeze_authority: [u8; 32],
    pub bump: u8,
}
unsafe impl Layout for Mint {}
impl Mint {
    pub const LEN: usize = <Self as Layout>::LEN;
    pub fn is_initialized(&self) -> bool { self.is_initialized == 1 }
    pub fn has_mint_authority(&self) -> bool { self.mint_authority_flag == COPTION_SOME }
    pub fn has_freeze_authority(&self) -> bool { self.freeze_authority_flag == COPTION_SOME }
}

/// TokenAccount — NO plaintext fields. Balance is always encrypted.
#[repr(C)]
pub struct TokenAccount {
    pub mint: [u8; 32],
    pub owner: [u8; 32],
    pub balance: EUint64,
    pub delegate_flag: [u8; 4],
    pub delegate: [u8; 32],
    pub state: u8,
    pub allowance: EUint64,
    pub close_authority_flag: [u8; 4],
    pub close_authority: [u8; 32],
    pub bump: u8,
}
unsafe impl Layout for TokenAccount {}
impl TokenAccount {
    pub const LEN: usize = <Self as Layout>::LEN;
    pub fn is_frozen(&self) -> bool { self.state == AccountState::Frozen as u8 }
    pub fn is_initialized(&self) -> bool { self.state != AccountState::Uninitialized as u8 }
    pub fn has_delegate(&self) -> bool { self.delegate_flag == COPTION_SOME }
    pub fn has_close_authority(&self) -> bool { self.close_authority_flag == COPTION_SOME }
}

/// Vault — PDA `["pc_vault", pc_mint]`. Layout unchanged from upstream.
#[repr(C)]
pub struct Vault { pub spl_mint: [u8; 32], pub bump: u8 }
unsafe impl Layout for Vault {}
impl Vault { pub const LEN: usize = <Self as Layout>::LEN; }

/// Temporary receipt for unwrap. PDA: `["pc_receipt", burned_ct]`. Closed by
/// UnwrapComplete. Epoch 2 binds every later step to this receipt: the burned
/// ciphertext, the vault and pc mint it may pay out of, and the decryption
/// request it may be completed with.
#[repr(C)]
pub struct WithdrawalReceipt {
    pub owner: [u8; 32],
    pub amount: [u8; 8],           // requested plaintext amount
    pub pending_digest: [u8; 32],  // digest of burned_ct at decryption request
    pub bump: u8,
    pub burned_ct: [u8; 32],
    pub vault: [u8; 32],
    pub pc_mint: [u8; 32],
    pub request: [u8; 32],         // decryption request account, set by UnwrapDecrypt
    pub decrypt_requested: u8,
    /// Layout version (1). Also keeps the length distinct from TokenAccount's.
    pub version: u8,
}
unsafe impl Layout for WithdrawalReceipt {}
impl WithdrawalReceipt {
    pub const LEN: usize = <Self as Layout>::LEN;
    pub fn requested_amount(&self) -> u64 { u64::from_le_bytes(self.amount) }
}

// Distinct lengths are what make the length check a type check.
const _: () = {
    assert!(Mint::LEN == 75);
    assert!(TokenAccount::LEN == 202);
    assert!(Vault::LEN == 33);
    assert!(WithdrawalReceipt::LEN == 203);
    assert!(core::mem::align_of::<Mint>() == 1);
    assert!(core::mem::align_of::<TokenAccount>() == 1);
    assert!(core::mem::align_of::<Vault>() == 1);
    assert!(core::mem::align_of::<WithdrawalReceipt>() == 1);
};

// ── Validation helpers ──

/// Load a program account: owned by `program_id`, exact length of `T`.
pub fn load<'a, T: Layout>(acct: &'a AccountView, program_id: &Address) -> Result<&'a T, ProgramError> {
    if !acct.owned_by(program_id) { return Err(ProgramError::IncorrectProgramId); }
    let d = unsafe { acct.borrow_unchecked() };
    if d.len() != T::LEN { return Err(ProgramError::InvalidAccountData); }
    Ok(unsafe { &*(d.as_ptr() as *const T) })
}

/// Mutable variant of [`load`]; also requires the account to be writable.
pub fn load_mut<'a, T: Layout>(acct: &'a AccountView, program_id: &Address) -> Result<&'a mut T, ProgramError> {
    if !acct.is_writable() { return Err(ProgramError::InvalidArgument); }
    if !acct.owned_by(program_id) { return Err(ProgramError::IncorrectProgramId); }
    let d = unsafe { acct.borrow_unchecked_mut() };
    if d.len() != T::LEN { return Err(ProgramError::InvalidAccountData); }
    Ok(unsafe { &mut *(d.as_mut_ptr() as *mut T) })
}

/// Initialize a freshly created program account.
fn init_mut<'a, T: Layout>(acct: &'a AccountView) -> Result<&'a mut T, ProgramError> {
    let d = unsafe { acct.borrow_unchecked_mut() };
    if d.len() != T::LEN { return Err(ProgramError::InvalidAccountData); }
    Ok(unsafe { &mut *(d.as_mut_ptr() as *mut T) })
}

/// Every address in `accts` must be distinct.
pub fn distinct(accts: &[&AccountView]) -> ProgramResult {
    for (i, a) in accts.iter().enumerate() {
        for b in &accts[i + 1..] {
            if a.address() == b.address() { return Err(err::ALIASED); }
        }
    }
    Ok(())
}

/// An account the program (or Encrypt, on its behalf) is about to create:
/// signing, empty, system-owned.
pub fn require_fresh(acct: &AccountView) -> ProgramResult {
    if !acct.is_signer() || acct.data_len() != 0 || !acct.owned_by(&SYSTEM_ID) { return Err(err::NOT_FRESH); }
    Ok(())
}

/// `bump` must be the canonical bump of `seeds` under `program_id`, and the
/// derived address must be `expected`.
pub fn require_canonical(seeds: &[&[u8]], bump: u8, program_id: &Address, expected: &AccountView) -> ProgramResult {
    let (addr, canonical) = Address::find_program_address(seeds, program_id);
    if canonical != bump { return Err(err::NON_CANONICAL_BUMP); }
    if &addr != expected.address() { return Err(ProgramError::InvalidSeeds); }
    Ok(())
}

/// The vault must be the PDA `["pc_vault", pc_mint, vault.bump]`.
fn require_vault_of(vault_acct: &AccountView, vault: &Vault, pc_mint: &[u8; 32], program_id: &Address) -> ProgramResult {
    let derived = Address::create_program_address(&[b"pc_vault", pc_mint, &[vault.bump]], program_id)
        .map_err(|_| err::BAD_VAULT)?;
    if &derived != vault_acct.address() { return Err(err::BAD_VAULT); }
    Ok(())
}

/// The vault's SPL account: owned by SPL Token, an initialized token account
/// of the vault's SPL mint, whose token owner is the vault PDA.
fn require_vault_ata(vault_ata: &AccountView, vault_acct: &AccountView, vault: &Vault) -> ProgramResult {
    if !vault_ata.owned_by(&SPL_TOKEN_ID) { return Err(err::BAD_VAULT_ATA); }
    let d = unsafe { vault_ata.borrow_unchecked() };
    if d.len() != SPL_ACCOUNT_LEN { return Err(err::BAD_VAULT_ATA); }
    if d[0..32] != vault.spl_mint { return Err(err::BAD_VAULT_ATA); }
    if &d[32..64] != vault_acct.address().as_ref() { return Err(err::BAD_VAULT_ATA); }
    Ok(())
}

fn require_token_program(acct: &AccountView) -> ProgramResult {
    if acct.address() != &SPL_TOKEN_ID { return Err(err::BAD_TOKEN_PROGRAM); }
    Ok(())
}

/// Build the Encrypt CPI context after pinning the Encrypt program, the
/// caller (this program) and the system program.
#[allow(clippy::too_many_arguments)]
fn encrypt_ctx<'a>(
    program_id: &Address,
    ep: &'a AccountView, cfg: &'a AccountView, dep: &'a AccountView, cpi_auth: &'a AccountView,
    caller: &'a AccountView, nk: &'a AccountView, payer: &'a AccountView, evt: &'a AccountView,
    sys: &'a AccountView, cpi_bump: u8,
) -> Result<EncryptContext<'a>, ProgramError> {
    if ep.address() != &ENCRYPT_ID { return Err(err::FOREIGN_ENCRYPT); }
    if caller.address() != program_id { return Err(err::WRONG_CALLER); }
    if sys.address() != &SYSTEM_ID { return Err(ProgramError::IncorrectProgramId); }
    Ok(EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer, event_authority: evt, system_program: sys, cpi_authority_bump: cpi_bump })
}

fn minimum_balance(s: usize) -> u64 { (s as u64 + 128) * 6960 }
fn assert_not_frozen(ta: &TokenAccount) -> ProgramResult { if ta.is_frozen() { Err(ProgramError::Custom(0x11)) } else { Ok(()) } }

/// Load an initialized, unfrozen token account and check its balance slot.
fn load_live_account<'a>(ta_acct: &'a AccountView, bal_ct: &AccountView, program_id: &Address) -> Result<&'a TokenAccount, ProgramError> {
    let ta = load::<TokenAccount>(ta_acct, program_id)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if bal_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }
    Ok(ta)
}

// ── FHE Graphs ──

#[encrypt_fn] fn mint_to_graph(balance: EUint64, amount: EUint64) -> EUint64 { balance + amount }

#[encrypt_fn] fn transfer_graph(from_balance: EUint64, to_balance: EUint64, amount: EUint64) -> (EUint64, EUint64) {
    let s = from_balance >= amount;
    let nf = if s { from_balance - amount } else { from_balance };
    let nt = if s { to_balance + amount } else { to_balance };
    (nf, nt)
}

#[encrypt_fn] fn transfer_from_graph(from_balance: EUint64, to_balance: EUint64, allowance: EUint64, amount: EUint64) -> (EUint64, EUint64, EUint64) {
    let sb = from_balance >= amount; let sa = allowance >= amount; let v = sb & sa;
    let nf = if v { from_balance - amount } else { from_balance };
    let nt = if v { to_balance + amount } else { to_balance };
    let na = if v { allowance - amount } else { allowance };
    (nf, nt, na)
}

/// Unwrap burn: conditional burn that outputs the actual burned amount.
/// burned = amount if sufficient, 0 if not.
#[encrypt_fn] fn unwrap_burn_graph(balance: EUint64, amount: EUint64) -> (EUint64, EUint64) {
    let s = balance >= amount;
    let new_balance = if s { balance - amount } else { balance };
    let burned = if s { amount } else { amount - amount };
    (new_balance, burned)
}

/// Transfer + binary receipt. Same balance updates as `transfer_graph`, plus
/// a third output `actual` ∈ {amount, 0} — the receipt is the actually-
/// transferred value, never partial. Consumers (e.g., pc-swap) multiply
/// downstream state by the receipt to gate their own updates in lockstep.
#[encrypt_fn] fn transfer_receipt_graph(from_balance: EUint64, to_balance: EUint64, amount: EUint64) -> (EUint64, EUint64, EUint64) {
    let s = from_balance >= amount;
    let zero = amount - amount;
    let actual = if s { amount } else { zero };
    let nf = from_balance - actual;
    let nt = to_balance + actual;
    (nf, nt, actual)
}

// ── Dispatch ──

fn process_instruction(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    match data.split_first() {
        Some((&0, rest)) => initialize_mint(program_id, accounts, rest),
        Some((&1, rest)) => initialize_account(program_id, accounts, rest),
        Some((&3, rest)) => transfer(program_id, accounts, rest),
        Some((&4, rest)) => approve(program_id, accounts, rest),
        Some((&5, rest)) => revoke(program_id, accounts, rest),
        // No standalone MintTo — tokens can only enter through Wrap (vault-backed)
        // No standalone Burn — tokens can only exit through Unwrap (releases backing SPL)
        Some((&10, rest)) => freeze_account(program_id, accounts, rest),
        Some((&11, rest)) => thaw_account(program_id, accounts, rest),
        Some((&20, rest)) => transfer_from(program_id, accounts, rest),
        Some((&22, rest)) => transfer_with_receipt(program_id, accounts, rest),
        Some((&23, rest)) => initialize_vault(program_id, accounts, rest),
        Some((&30, rest)) => wrap(program_id, accounts, rest),
        Some((&31, rest)) => unwrap_burn(program_id, accounts, rest),
        Some((&32, rest)) => unwrap_decrypt(program_id, accounts, rest),
        Some((&33, _rest)) => unwrap_complete(program_id, accounts),
        // 40: ViewBalance — fork-only addition (Inkwell). Lets the account owner produce a
        // wallet-authorized copy of their encrypted balance so they can read it via gRPC.
        Some((&40, rest)) => view_balance(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── 0: InitializeMint ──
// Accounts: [mint (w), authority (s), payer (s, w), system]
// Data: [bump, decimals, mint_authority(32), has_freeze, freeze_authority(32)?]
//   The flag byte may be omitted (no freeze authority). With the flag set the
//   freeze authority is required (the upstream length check was off by one).

fn initialize_mint(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [mint_acct, authority, payer, sys, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !authority.is_signer() || !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if sys.address() != &SYSTEM_ID { return Err(ProgramError::IncorrectProgramId); }
    if data.len() < 34 { return Err(ProgramError::InvalidInstructionData); }
    let (bump, decimals) = (data[0], data[1]);
    let mint_authority: [u8; 32] = data[2..34].try_into().unwrap();
    let has_freeze = data.len() > 34 && data[34] != 0;
    let freeze_authority: [u8; 32] = if has_freeze {
        if data.len() < 67 { return Err(ProgramError::InvalidInstructionData); }
        data[35..67].try_into().unwrap()
    } else { [0u8; 32] };
    require_canonical(&[b"pc_mint", authority.address().as_ref()], bump, program_id, mint_acct)?;
    let bb = [bump];
    let seeds = [Seed::from(b"pc_mint" as &[u8]), Seed::from(authority.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: payer, to: mint_acct, lamports: minimum_balance(Mint::LEN), space: Mint::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;
    let m = init_mut::<Mint>(mint_acct)?;
    m.mint_authority_flag = COPTION_SOME; m.mint_authority.copy_from_slice(&mint_authority);
    m.decimals = decimals; m.is_initialized = 1;
    if has_freeze { m.freeze_authority_flag = COPTION_SOME; m.freeze_authority.copy_from_slice(&freeze_authority); }
    else { m.freeze_authority_flag = COPTION_NONE; m.freeze_authority = [0u8; 32]; }
    m.bump = bump; Ok(())
}

// ── 1: InitializeAccount ──
// Accounts: [ta (w), mint, owner, bal_ct (fresh signer), ep, cfg, dep, cpi_auth, caller, nk, payer (s), evt, sys]

fn initialize_account(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, owner, bal_ct, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 2 { return Err(ProgramError::InvalidInstructionData); }
    let (ab, cb) = (data[0], data[1]);
    if !load::<Mint>(mint_acct, program_id)?.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    require_fresh(bal_ct)?;
    require_canonical(&[b"pc_account", mint_acct.address().as_ref(), owner.address().as_ref()], ab, program_id, ta_acct)?;
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, cb)?;
    let bb = [ab];
    let seeds = [Seed::from(b"pc_account" as &[u8]), Seed::from(mint_acct.address().as_ref()), Seed::from(owner.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: payer, to: ta_acct, lamports: minimum_balance(TokenAccount::LEN), space: TokenAccount::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;
    ctx.create_plaintext_typed::<Uint64>(&0u64, bal_ct)?;
    let ta = init_mut::<TokenAccount>(ta_acct)?;
    ta.mint.copy_from_slice(mint_acct.address().as_ref());
    ta.owner.copy_from_slice(owner.address().as_ref());
    ta.balance = EUint64::from_le_bytes(*bal_ct.address().as_array());
    ta.delegate_flag = COPTION_NONE; ta.delegate = [0u8; 32];
    ta.state = AccountState::Initialized as u8;
    ta.allowance = EUint64::from_le_bytes([0u8; 32]);
    ta.close_authority_flag = COPTION_NONE; ta.close_authority = [0u8; 32];
    ta.bump = ab; Ok(())
}

// ── 3: Transfer ──
// Accounts: [from, to, from_ct (w), to_ct (w), amt_ct (w), ep, cfg, dep, cpi_auth, caller, nk, owner (s), evt, sys]

fn transfer(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [from_acct, to_acct, from_ct, to_ct, amt_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    // A self-transfer would write both graph outputs to one ciphertext and
    // keep the credit: reject every alias.
    distinct(&[from_acct, to_acct])?;
    distinct(&[from_ct, to_ct, amt_ct])?;
    let ft = load_live_account(from_acct, from_ct, program_id)?;
    if owner.address().as_array() != &ft.owner { return Err(ProgramError::InvalidArgument); }
    let tt = load_live_account(to_acct, to_ct, program_id)?;
    if ft.mint != tt.mint { return Err(ProgramError::InvalidArgument); }
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, data[0])?;
    ctx.transfer_graph(from_ct, to_ct, amt_ct, from_ct, to_ct)?; Ok(())
}

// ── 22: TransferWithReceipt ──
// Same balance updates as Transfer, plus emits a binary receipt ciphertext
// (= amount on success, 0 on insufficient balance) authorized to a caller-
// supplied target program. Owner-signer-only — no delegate path.
//
// SECURITY: receipt_ct's authorized field is the target program. Whoever
// holds compute access also holds decrypt access in encrypt's current ACL
// model — pc-token's contract with callers is that they will not call
// `request_decryption` on receipts. The user's signature on this tx is
// consent for that trust relationship. (The principled fix lives in the
// encrypt program: split authorized into compute_authorized /
// decrypt_authorized.)
//
// Accounts: [from, to, from_ct, to_ct, amt_ct, receipt_ct (fresh signer), target_program,
//            ep, cfg, dep, cpi_auth, caller, nk, owner (s), evt, sys]

fn transfer_with_receipt(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [from_acct, to_acct, from_ct, to_ct, amt_ct, receipt_ct, target_program, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    distinct(&[from_acct, to_acct])?;
    distinct(&[from_ct, to_ct, amt_ct, receipt_ct])?;
    require_fresh(receipt_ct)?;
    let ft = load_live_account(from_acct, from_ct, program_id)?;
    if owner.address().as_array() != &ft.owner { return Err(ProgramError::InvalidArgument); }
    let tt = load_live_account(to_acct, to_ct, program_id)?;
    if ft.mint != tt.mint { return Err(ProgramError::InvalidArgument); }
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, data[0])?;
    ctx.create_plaintext_typed::<Uint64>(&0u64, receipt_ct)?;
    ctx.transfer_receipt_graph(from_ct, to_ct, amt_ct, from_ct, to_ct, receipt_ct)?;
    ctx.transfer_ciphertext(receipt_ct, target_program)?;
    Ok(())
}

// ── 4: Approve ──
// Accounts: [ta (w), delegate, amt_ct, allow_ct (fresh signer), ep, cfg, dep, cpi_auth, caller, nk, owner (s), evt, sys]
// Refused while a delegate is set (Revoke first), so an old allowance
// ciphertext is never orphaned.

fn approve(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, delegate, amt_ct, allow_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    distinct(&[amt_ct, allow_ct])?;
    require_fresh(allow_ct)?;
    let ta = load_mut::<TokenAccount>(ta_acct, program_id)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if ta.has_delegate() { return Err(err::DELEGATE_SET); }
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, data[0])?;
    ctx.create_plaintext_typed::<Uint64>(&0u64, allow_ct)?;
    ctx.mint_to_graph(allow_ct, amt_ct, allow_ct)?;
    ta.delegate_flag = COPTION_SOME;
    ta.delegate.copy_from_slice(delegate.address().as_ref());
    ta.allowance = EUint64::from_le_bytes(*allow_ct.address().as_array());
    Ok(())
}

// ── 5: Revoke ──
// Accounts: [ta (w), allow_ct (w), owner (s), ep, cfg, dep, cpi_auth, caller, nk, payer (s), evt, sys]

fn revoke(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, allow_ct, owner, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let ta = load_mut::<TokenAccount>(ta_acct, program_id)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if !ta.has_delegate() { return Err(ProgramError::InvalidArgument); }
    if allow_ct.address().as_array() != ta.allowance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, data[0])?;
    ctx.close_ciphertext(allow_ct, payer)?;
    ta.delegate_flag = COPTION_NONE; ta.delegate = [0u8; 32]; ta.allowance = EUint64::from_le_bytes([0u8; 32]); Ok(())
}

// ── 10: FreezeAccount ──

fn freeze_account(program_id: &Address, accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, freeze_auth, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !freeze_auth.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    let m = load::<Mint>(mint_acct, program_id)?;
    if !m.has_freeze_authority() || freeze_auth.address().as_array() != &m.freeze_authority { return Err(ProgramError::InvalidArgument); }
    let ta = load_mut::<TokenAccount>(ta_acct, program_id)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    if &ta.mint != mint_acct.address().as_array() { return Err(ProgramError::InvalidArgument); }
    ta.state = AccountState::Frozen as u8; Ok(())
}

// ── 11: ThawAccount ──

fn thaw_account(program_id: &Address, accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, freeze_auth, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !freeze_auth.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    let m = load::<Mint>(mint_acct, program_id)?;
    if !m.has_freeze_authority() || freeze_auth.address().as_array() != &m.freeze_authority { return Err(ProgramError::InvalidArgument); }
    let ta = load_mut::<TokenAccount>(ta_acct, program_id)?;
    if !ta.is_frozen() { return Err(ProgramError::InvalidArgument); }
    if &ta.mint != mint_acct.address().as_array() { return Err(ProgramError::InvalidArgument); }
    ta.state = AccountState::Initialized as u8; Ok(())
}

// ── 20: TransferFrom ──
// Accounts: [from, to, from_ct, to_ct, allow_ct, amt_ct, delegate (s), ep, cfg, dep, cpi_auth, caller, nk, payer (s), evt, sys]

fn transfer_from(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [from_acct, to_acct, from_ct, to_ct, allow_ct, amt_ct, delegate, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !delegate.is_signer() || !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    distinct(&[from_acct, to_acct])?;
    distinct(&[from_ct, to_ct, allow_ct, amt_ct])?;
    let ft = load_live_account(from_acct, from_ct, program_id)?;
    if !ft.has_delegate() || delegate.address().as_array() != &ft.delegate { return Err(ProgramError::InvalidArgument); }
    if allow_ct.address().as_array() != ft.allowance.id() { return Err(ProgramError::InvalidArgument); }
    let tt = load_live_account(to_acct, to_ct, program_id)?;
    if ft.mint != tt.mint { return Err(ProgramError::InvalidArgument); }
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, data[0])?;
    ctx.transfer_from_graph(from_ct, to_ct, allow_ct, amt_ct, from_ct, to_ct, allow_ct)?; Ok(())
}

// ── 23: InitializeVault ──
// Accounts: [vault (w), pc_mint, spl_mint, payer (s), system, mint_authority (s)]
// Data: [vault_bump]
// Epoch 2: only the pc mint's authority may bind a vault (and so the backing
// SPL mint) to a pc mint, and the bump must be canonical.

fn initialize_vault(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [vault_acct, pc_mint, spl_mint, payer, sys, mint_authority, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !payer.is_signer() || !mint_authority.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if sys.address() != &SYSTEM_ID { return Err(ProgramError::IncorrectProgramId); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let vb = data[0];
    let m = load::<Mint>(pc_mint, program_id)?;
    if !m.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    if !m.has_mint_authority() || mint_authority.address().as_array() != &m.mint_authority { return Err(err::NOT_MINT_AUTHORITY); }
    if !spl_mint.owned_by(&SPL_TOKEN_ID) || spl_mint.data_len() != SPL_MINT_LEN { return Err(err::BAD_SPL_MINT); }
    require_canonical(&[b"pc_vault", pc_mint.address().as_ref()], vb, program_id, vault_acct)?;
    let bb = [vb];
    let seeds = [Seed::from(b"pc_vault" as &[u8]), Seed::from(pc_mint.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: payer, to: vault_acct, lamports: minimum_balance(Vault::LEN), space: Vault::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;
    let v = init_mut::<Vault>(vault_acct)?;
    v.spl_mint.copy_from_slice(spl_mint.address().as_ref()); v.bump = vb; Ok(())
}

// ── 30: Wrap ──
// Accounts: [vault, ta, user_ata (w), vault_ata (w), bal_ct (w), amt_ct (fresh signer, w),
//            ep, cfg, dep, cpi_auth, caller, nk, owner (s, w), evt, sys, spl_token]
// Data: [cpi_bump, amount u64 LE]
//
// Epoch 2: `amt_ct` is no longer a client-created input. The program creates
// it from the SPL `amount` it just moved into the vault, so the credited
// ciphertext always equals the deposit.

fn wrap(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [vault_acct, ta_acct, user_ata, vault_ata, bal_ct, amt_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, spl, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 9 { return Err(ProgramError::InvalidInstructionData); }
    let (cb, amount) = (data[0], u64::from_le_bytes(data[1..9].try_into().unwrap()));
    if amount == 0 { return Err(ProgramError::InvalidArgument); }
    distinct(&[user_ata, vault_ata])?;
    distinct(&[bal_ct, amt_ct])?;
    require_fresh(amt_ct)?;
    require_token_program(spl)?;
    let ta = load_live_account(ta_acct, bal_ct, program_id)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    let vault = load::<Vault>(vault_acct, program_id)?;
    require_vault_of(vault_acct, vault, &ta.mint, program_id)?;
    require_vault_ata(vault_ata, vault_acct, vault)?;
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, cb)?;
    SplTransfer { from: user_ata, to: vault_ata, authority: owner, amount }.invoke()?;
    ctx.create_plaintext_typed::<Uint64>(&amount, amt_ct)?;
    ctx.mint_to_graph(bal_ct, amt_ct, bal_ct)?; Ok(())
}

// ── 31: UnwrapBurn ──
// Burns pcTokens and creates a temporary WithdrawalReceipt.
// Accounts: [vault, ta, receipt (w), bal_ct (w), amt_ct (w), burned_ct (fresh signer, w),
//            ep, cfg, dep, cpi_auth, caller, nk, owner (s, w), evt, sys]
// Data: [receipt_bump, cpi_bump, amount u64 LE]
//
// Epoch 2: `burned_ct` must be a fresh keypair; the program creates it (value
// 0) before the graph writes the burned amount into it, so no existing
// ciphertext can be named as the burn output. The receipt records the burned
// ciphertext, the vault and the pc mint.

fn unwrap_burn(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [vault_acct, ta_acct, receipt_acct, bal_ct, amt_ct, burned_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 10 { return Err(ProgramError::InvalidInstructionData); }
    let (rb, cb) = (data[0], data[1]);
    let amount = u64::from_le_bytes(data[2..10].try_into().unwrap());
    if amount == 0 { return Err(ProgramError::InvalidArgument); }
    distinct(&[bal_ct, amt_ct, burned_ct])?;
    require_fresh(burned_ct)?;
    let ta = load_live_account(ta_acct, bal_ct, program_id)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    let vault = load::<Vault>(vault_acct, program_id)?;
    require_vault_of(vault_acct, vault, &ta.mint, program_id)?;
    require_canonical(&[b"pc_receipt", burned_ct.address().as_ref()], rb, program_id, receipt_acct)?;
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, cb)?;

    let bb = [rb];
    let seeds = [Seed::from(b"pc_receipt" as &[u8]), Seed::from(burned_ct.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: owner, to: receipt_acct, lamports: minimum_balance(WithdrawalReceipt::LEN),
        space: WithdrawalReceipt::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;

    ctx.create_plaintext_typed::<Uint64>(&0u64, burned_ct)?;
    ctx.unwrap_burn_graph(bal_ct, amt_ct, bal_ct, burned_ct)?;

    let pc_mint = ta.mint;
    let r = init_mut::<WithdrawalReceipt>(receipt_acct)?;
    r.owner.copy_from_slice(owner.address().as_ref());
    r.amount = amount.to_le_bytes();
    r.pending_digest = [0u8; 32];
    r.bump = rb;
    r.burned_ct.copy_from_slice(burned_ct.address().as_ref());
    r.vault.copy_from_slice(vault_acct.address().as_ref());
    r.pc_mint = pc_mint;
    r.request = [0u8; 32];
    r.decrypt_requested = 0;
    r.version = 1;
    Ok(())
}

// ── 32: UnwrapDecrypt ──
// Accounts: [receipt (w), req (fresh signer, w), burned_ct, ep, cfg, dep, cpi_auth, caller, nk, owner (s, w), evt, sys]
// Data: [cpi_bump]
// Epoch 2: `burned_ct` must be the receipt's; decryption is requested once.

fn unwrap_decrypt(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [receipt_acct, req_acct, burned_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    require_fresh(req_acct)?;
    let r = load_mut::<WithdrawalReceipt>(receipt_acct, program_id)?;
    if owner.address().as_array() != &r.owner { return Err(ProgramError::InvalidArgument); }
    if burned_ct.address().as_array() != &r.burned_ct { return Err(err::RECEIPT_MISMATCH); }
    if r.decrypt_requested != 0 { return Err(err::DECRYPT_ALREADY_REQUESTED); }
    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, data[0])?;
    let digest = ctx.request_decryption(req_acct, burned_ct)?;
    r.pending_digest = digest;
    r.request.copy_from_slice(req_acct.address().as_ref());
    r.decrypt_requested = 1;
    Ok(())
}

// ── 33: UnwrapComplete ──
// Accounts: [receipt (w), vault, pc_mint, req, vault_ata (w), user_ata (w), owner (s), destination (w), spl_token]
// Epoch 2: every account is checked against the receipt before it is closed.

fn unwrap_complete(program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [receipt_acct, vault_acct, pc_mint, req_acct, vault_ata, user_ata, owner, destination, spl, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    distinct(&[receipt_acct, destination])?;
    distinct(&[vault_ata, user_ata])?;
    require_token_program(spl)?;
    let r = load_mut::<WithdrawalReceipt>(receipt_acct, program_id)?;
    if owner.address().as_array() != &r.owner { return Err(ProgramError::InvalidArgument); }
    if r.decrypt_requested == 0 { return Err(err::DECRYPT_NOT_REQUESTED); }
    if vault_acct.address().as_array() != &r.vault { return Err(err::RECEIPT_MISMATCH); }
    if pc_mint.address().as_array() != &r.pc_mint { return Err(err::RECEIPT_MISMATCH); }
    if req_acct.address().as_array() != &r.request { return Err(err::RECEIPT_MISMATCH); }
    if !req_acct.owned_by(&ENCRYPT_ID) { return Err(err::BAD_REQUEST); }
    let vault = load::<Vault>(vault_acct, program_id)?;
    require_vault_of(vault_acct, vault, &r.pc_mint, program_id)?;
    require_vault_ata(vault_ata, vault_acct, vault)?;

    let requested = r.requested_amount();
    let req_data = unsafe { req_acct.borrow_unchecked() };
    if accounts::decryption_ciphertext(req_data)? != &r.burned_ct { return Err(err::RECEIPT_MISMATCH); }
    let burned: u64 = *accounts::read_decrypted_verified::<Uint64>(req_data, &r.pending_digest)?;

    // Close receipt (all checks passed).
    let rl = receipt_acct.lamports(); receipt_acct.set_lamports(0);
    destination.set_lamports(destination.lamports() + rl);
    let rd2 = unsafe { receipt_acct.borrow_unchecked_mut() };
    for b in rd2.iter_mut() { *b = 0; }

    if burned != requested { return Ok(()); } // insufficient balance — no-op, receipt closed

    let vbb = [vault.bump];
    let vs = [Seed::from(b"pc_vault" as &[u8]), Seed::from(pc_mint.address().as_ref()), Seed::from(&vbb)];
    SplTransfer { from: vault_ata, to: user_ata, authority: vault_acct, amount: requested }.invoke_signed(&[Signer::from(&vs)])?;
    Ok(())
}

// ── 40: ViewBalance ──
//
// Inkwell fork addition. Lets the account owner produce a wallet-authorized COPY of their
// encrypted balance ciphertext so they can read it via gRPC `readCiphertext`. The original
// balance_ct stays under PC-Token's program authority so wraps/transfers/unwraps continue
// to work; the copy is rent-exempt and persists, but is only readable by the owner.
//
// Accounts: [ta, balance_ct, view_ct (fresh signer, w), new_authorized, ep, cfg, dep, cpi_auth, caller, nk, owner (s, w), evt, sys]
// Cost: ~0.0023 SOL rent per view (the new ciphertext metadata account).
fn view_balance(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, balance_ct, view_ct, new_authorized, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let cb = data[0];
    require_fresh(view_ct)?;

    let ta = load::<TokenAccount>(ta_acct, program_id)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if balance_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }

    let ctx = encrypt_ctx(program_id, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, cb)?;
    // Privacy invariant: `new_authorized` must be a key only the user controls. Client supplies
    // an ephemeral ed25519 pubkey — that pubkey becomes the sole reader, and only the matching
    // private key (held in the user's session) can sign a `readCiphertext` request.
    // NEVER `make_public` this CT; doing so leaks the balance to any chain observer.
    ctx.copy_ciphertext(balance_ct, view_ct, new_authorized)?;
    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use encrypt_types::graph::{get_node, parse_graph, GraphNodeKind};
    use encrypt_types::identifier::*;
    use encrypt_types::types::FheType;
    use super::{mint_to_graph, transfer_from_graph, transfer_graph, transfer_receipt_graph, unwrap_burn_graph};

    fn run_mock(graph_fn: fn() -> Vec<u8>, inputs: &[u128], fhe_types: &[FheType]) -> Vec<u128> {
        let data = graph_fn(); let pg = parse_graph(&data).unwrap();
        let num = pg.header().num_nodes() as usize;
        let mut digests: Vec<[u8; 32]> = Vec::with_capacity(num); let mut inp = 0usize;
        for i in 0..num {
            let n = get_node(pg.node_bytes(), i as u16).unwrap();
            let ft = FheType::from_u8(n.fhe_type()).unwrap_or(FheType::EUint64);
            let d = match n.kind() {
                k if k == GraphNodeKind::Input as u8 => { let v = inputs[inp]; let t = fhe_types[inp]; inp += 1; encode_mock_digest(t, v) }
                k if k == GraphNodeKind::Constant as u8 => { let bw = ft.byte_width().min(16); let off = n.const_offset() as usize;
                    let mut buf = [0u8; 16]; buf[..bw].copy_from_slice(&pg.constants()[off..off + bw]); encode_mock_digest(ft, u128::from_le_bytes(buf)) }
                k if k == GraphNodeKind::Op as u8 => { let (a, b, c) = (n.input_a() as usize, n.input_b() as usize, n.input_c() as usize);
                    if n.op_type() == 60 { mock_select(&digests[a], &digests[b], &digests[c]) }
                    else if b == 0xFFFF { mock_unary_compute(unsafe { core::mem::transmute(n.op_type()) }, &digests[a], ft) }
                    else { mock_binary_compute(unsafe { core::mem::transmute(n.op_type()) }, &digests[a], &digests[b], ft) } }
                k if k == GraphNodeKind::Output as u8 => digests[n.input_a() as usize],
                _ => panic!("bad node"),
            }; digests.push(d);
        }
        (0..num).filter(|&i| get_node(pg.node_bytes(), i as u16).unwrap().kind() == GraphNodeKind::Output as u8)
            .map(|i| decode_mock_identifier(&digests[i])).collect()
    }

    const T: FheType = FheType::EUint64;

    #[test] fn mint_to() { let r = run_mock(mint_to_graph, &[500, 300], &[T, T]); assert_eq!(r[0], 800); }
    #[test] fn transfer_ok() { let r = run_mock(transfer_graph, &[1000, 500, 300], &[T, T, T]); assert_eq!(r[0], 700); assert_eq!(r[1], 800); }
    #[test] fn transfer_insufficient() { let r = run_mock(transfer_graph, &[100, 500, 300], &[T, T, T]); assert_eq!(r[0], 100); assert_eq!(r[1], 500); }
    #[test] fn transfer_from_ok() { let r = run_mock(transfer_from_graph, &[1000, 500, 400, 300], &[T, T, T, T]); assert_eq!(r[0], 700); assert_eq!(r[1], 800); assert_eq!(r[2], 100); }
    #[test] fn transfer_from_insufficient() { let r = run_mock(transfer_from_graph, &[100, 500, 400, 300], &[T, T, T, T]); assert_eq!(r[0], 100); assert_eq!(r[1], 500); assert_eq!(r[2], 400); }
    #[test] fn transfer_receipt_ok() { let r = run_mock(transfer_receipt_graph, &[1000, 500, 300], &[T, T, T]); assert_eq!(r, vec![700, 800, 300]); }
    #[test] fn transfer_receipt_insufficient() { let r = run_mock(transfer_receipt_graph, &[100, 500, 300], &[T, T, T]); assert_eq!(r, vec![100, 500, 0]); }

    #[test] fn unwrap_burn_sufficient() { let r = run_mock(unwrap_burn_graph, &[1000, 300], &[T, T]); assert_eq!(r[0], 700); assert_eq!(r[1], 300); }
    #[test] fn unwrap_burn_insufficient() { let r = run_mock(unwrap_burn_graph, &[100, 300], &[T, T]); assert_eq!(r[0], 100); assert_eq!(r[1], 0); }

    #[test] fn graph_shapes() {
        swap_shapes(mint_to_graph, 2, 1); swap_shapes(transfer_graph, 3, 2);
        swap_shapes(transfer_from_graph, 4, 3); swap_shapes(unwrap_burn_graph, 2, 2);
        swap_shapes(transfer_receipt_graph, 3, 3);
    }
    fn swap_shapes(f: fn() -> Vec<u8>, ni: u8, no: u8) { let g = f(); let pg = parse_graph(&g).unwrap();
        assert_eq!(pg.header().num_inputs(), ni); assert_eq!(pg.header().num_outputs(), no); }
}
