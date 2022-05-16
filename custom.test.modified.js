// [assignment] please copy the entire modified custom.test.js here
const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys
    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.1')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })
    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })
    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)
    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])
    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.08')
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    })

    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: false,
    })

    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(aliceWithdrawAmount)
    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(0)
    const tornadoPoolBalance = await token.balanceOf(tornadoPool.address)
    expect(tornadoPoolBalance).to.be.equal(aliceDepositAmount.sub(aliceWithdrawAmount))
  })

  it('[assignment] iii. see assignment doc for details', async () => {
    // [assignment] complete code here
    const accounts = await ethers.getSigners() // we get ethers accounts
    // const alice = accounts[0] // first account would be alice not
    const bob = accounts[1] // second account will be bob

    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys
    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.13') // 0.13 ether in L1
    const aliceDepositUtxo = new Utxo({
      amount: aliceDepositAmount,
      keypair: aliceKeypair,
    })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })
    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })
    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)
    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])
    // sends 0.06 ETH to Bob
    const transferToBobAmount = utils.parseEther('0.06') // 0.06 ether in L2
    const aliceTransferToBobUtxo = new Utxo({
      amount: aliceDepositAmount.sub(transferToBobAmount),
      keypair: aliceKeypair,
    })
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceTransferToBobUtxo],
      recipient: bob.address,
      isL1Withdrawal: false,
    })
    // withdraws rest of his funds from the shielded pool
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceChangeUtxo = new Utxo({
      amount: 0,
      keypair: aliceKeypair,
    })
    await transaction({
      tornadoPool,
      inputs: [aliceTransferToBobUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: true,
    })
    // assert relevant balances
    // recipient to assert
    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(0)
    // assert bob balance
    const bobBalance = await token.balanceOf(bob.address)
    expect(bobBalance).to.be.equal(transferToBobAmount)
    // assert onmi bridge balance
    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(aliceDepositAmount.sub(transferToBobAmount))
    // assert tornado pool balance
    const tornadoPoolBalance = await token.balanceOf(tornadoPool.address)
    expect(tornadoPoolBalance).to.be.equal(0)
  })
})

