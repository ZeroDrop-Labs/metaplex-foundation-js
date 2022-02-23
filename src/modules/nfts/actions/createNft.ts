import { Keypair, PublicKey, Signer, SystemProgram } from "@solana/web3.js";
import { bignum } from "@metaplex-foundation/beet";
import { MetadataAccount, MasterEditionAccount } from "@/modules/shared";
import { Metaplex } from "@/Metaplex";
import { MINT_SIZE, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createInitializeMintInstruction, getMinimumBalanceForRentExemptMint, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createMintToInstruction, createSetAuthorityInstruction, AuthorityType } from "@solana/spl-token";
import { TransactionBuilder } from "@/utils";
import { createCreateMasterEditionV3Instruction, createCreateMetadataAccountV2Instruction, DataV2 } from "../generated";

export interface CreateNftParams {
  data: DataV2,
  isMutable?: boolean,
  maxSupply?: bignum,
  decimals?: number;
  allowHolderOffCurve?: boolean;
  mint?: Signer;
  payer: Signer;
  holder: PublicKey;
  mintAuthority: PublicKey;
  freezeAuthority?: PublicKey;
  updateAuthority?: PublicKey;
  tokenProgram?: PublicKey;
  associatedTokenProgram?: PublicKey;
}

export const createNft = async (metaplex: Metaplex, params: CreateNftParams): Promise<string> => {
  const tx = await createNftBuilder(metaplex, params);
  const txId = await metaplex.sendTransaction(tx);

  // TODO: Return Nft object or should this live in the client?
  return txId;
}

export const createNftBuilder = async (metaplex: Metaplex, params: CreateNftParams): Promise<TransactionBuilder> => {
  const {
    // Data.
    data,
    isMutable = false,
    maxSupply = null,
    decimals = 0,
    allowHolderOffCurve = false,

    // Signers.
    mint = Keypair.generate(),
    payer,

    // PublicKeys.
    holder,
    mintAuthority,
    freezeAuthority = null,
    updateAuthority = mintAuthority,

    // Programs.
    tokenProgram = TOKEN_PROGRAM_ID,
    associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID,
  } = params;

  const tx = new TransactionBuilder();
  const lamports = await getMinimumBalanceForRentExemptMint(metaplex.connection);
  const holderToken = await getAssociatedTokenAddress(
    mint.publicKey,
    holder,
    allowHolderOffCurve,
    tokenProgram,
    associatedTokenProgram,
  );
  const holderTokenExists = !! await metaplex.getAccountInfo(holderToken);
  const metadata = await MetadataAccount.pda(mint.publicKey);
  const masterEdition = await MasterEditionAccount.pda(mint.publicKey);

  // Allocate space on the blockchain for the mint account.
  tx.add(SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    space: MINT_SIZE,
    lamports,
    programId: tokenProgram,
  }), [payer, mint], 'createAccount');

  // Initialize the mint account.
  tx.add(createInitializeMintInstruction(
    mint.publicKey,
    decimals,
    mintAuthority,
    freezeAuthority,
    tokenProgram,
  ), [mint], 'initializeMint');

  // Create the holder associated account if it does not exists.
  if (!holderTokenExists) {
    tx.add(createAssociatedTokenAccountInstruction(
      payer.publicKey,
      holderToken,
      holder,
      mint.publicKey,
      tokenProgram,
      associatedTokenProgram,
    ), [payer], 'createAssociatedTokenAccount');
  }

  // Mint 1 token to the token holder.
  tx.add(createMintToInstruction(
    mint.publicKey, 
    holderToken,
    mintAuthority,
    1,
    [],
    tokenProgram,
  ), [payer], 'initializeMint');

  // Create metadata account.
  tx.add(createCreateMetadataAccountV2Instruction({
    metadata,
    mint: mint.publicKey,
    mintAuthority,
    payer: payer.publicKey,
    updateAuthority,
  }, {
    createMetadataAccountArgsV2: { data, isMutable }
  }), [payer], 'createMetadata');

  // Create master edition account.
  tx.add(createCreateMasterEditionV3Instruction({
    edition: masterEdition,
    mint: mint.publicKey,
    updateAuthority,
    mintAuthority,
    payer: payer.publicKey,
    metadata,
  }, {
    createMasterEditionArgs: { maxSupply }
  }), [payer], 'createMasterEdition');

  // Prevent further minting.
  tx.add(createSetAuthorityInstruction(
    mint.publicKey,
    mintAuthority,
    AuthorityType.MintTokens,
    null,
    [],
    tokenProgram,
  ), [payer], 'initializeMint');

  return tx;
}