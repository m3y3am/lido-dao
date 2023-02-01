const { artifacts, ethers } = require('hardhat')
const withdrawals = require('./withdrawals')

const { newDao, newApp, AragonDAO } = require('./dao')

const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const LidoMock = artifacts.require('LidoMock')
const Lido = artifacts.require('Lido')
const WstETHMock = artifacts.require('WstETHMock')
const WstETH = artifacts.require('WstETH')
const LidoOracleMock = artifacts.require('LidoOracleMock')
const LidoOracle = artifacts.require('LidoOracle')
const StakingRouter = artifacts.require('StakingRouter.sol')
const StakingRouterMock = artifacts.require('StakingRouterMock.sol')
const LidoELRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault.sol')
const WithdrawalVault = artifacts.require('WithdrawalVault')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const EIP712StETH = artifacts.require('EIP712StETH')

const MAX_DEPOSITS_PER_BLOCK = 100
const MIN_DEPOSIT_BLOCK_DISTANCE = 20
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10
const GUARDIAN1 = '0x5Fc0E75BF6502009943590492B02A1d08EAc9C43'
const GUARDIAN2 = '0x8516Cbb5ABe73D775bfc0d21Af226e229F7181A3'
const GUARDIAN3 = '0xdaEAd0E0194abd565d28c1013399801d79627c14'
const GUARDIAN_PRIVATE_KEYS = {
  [GUARDIAN1]: '0x3578665169e03e05a26bd5c565ffd12c81a1e0df7d0679f8aee4153110a83c8c',
  [GUARDIAN2]: '0x88868f0fb667cfe50261bb385be8987e0ce62faee934af33c3026cf65f25f09e',
  [GUARDIAN3]: '0x75e6f508b637327debc90962cd38943ddb9cfc1fc4a8572fc5e3d0984e1261de'
}
const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

const defaultConfig = (voting) => {
  return {
    lido: 'new',
    lidoPermissions: {
      PAUSE_ROLE: voting,
      RESUME_ROLE: voting,
      BURN_ROLE: voting,
      STAKING_PAUSE_ROLE: voting,
      STAKING_CONTROL_ROLE: voting,
      SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE: voting,
      MANAGE_PROTOCOL_CONTRACTS_ROLE: voting
    },
    wsteth: 'new',
    oracle: 'new',
    withdrawalCredentials: '0x'.padEnd(66, '1234'),
    stakingRouter: 'new',
    depositSecurityModule: 'new',
    stakingModules: ['default'],
    defaultCuratedPermissions: {
      MANAGE_SIGNING_KEYS: voting,
      ADD_NODE_OPERATOR_ROLE: voting,
      ACTIVATE_NODE_OPERATOR_ROLE: voting,
      DEACTIVATE_NODE_OPERATOR_ROLE: voting,
      SET_NODE_OPERATOR_NAME_ROLE: voting,
      SET_NODE_OPERATOR_ADDRESS_ROLE: voting,
      SET_NODE_OPERATOR_LIMIT_ROLE: voting,
      STAKING_ROUTER_ROLE: voting,
      REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE: voting,
      INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE: voting
    }
  }
}

async function deployProtocol(appManager, voting, customConfig) {
  const config = { ...defaultConfig(voting), ...customConfig }

  const [treasury] = await ethers.getSigners()

  await treasury.sendTransaction({ to: appManager, value: await web3.eth.getBalance(treasury.address) })

  const { dao, acl } = await newDao(appManager)
  const aragonDao = await AragonDAO.create(appManager)

  let poolBase
  if (config.lido === 'new') {
    poolBase = await Lido.new()
  } else {
    poolBase = await LidoMock.new()
  } 

  const poolProxy = await aragonDao.newAppInstance({
    name: 'lido',
    base: poolBase,
    permissions: config.lidoPermissions
  })

  const [token, pool] = await Promise.all([Lido.at(poolProxy.address), Lido.at(poolProxy.address)])

  let wsteth, oracle, stakingRouter, depositSecurityModule

  if (config.wsteth === 'new') {
    wsteth = await WstETH.new(pool.address)
  } else {
    wsteth = await WstETHMock.new(pool.address)
  }

  if (config.oracle === 'new') {
    const impl = await LidoOracle.new()
    const proxy = await OssifiableProxy.new(impl.address, appManager, '0x')
    oracle = await LidoOracle.at(proxy.address)
  } else if (config.oracle === 'mock') {
    oracle = await LidoOracleMock.new()
  } else {
    oracle = await LidoOracle.at(config.oracle)
  }

  const depositContract = await DepositContractMock.new()

  if (config.stakingRouter === 'new') {
    const base = await StakingRouter.new(depositContract.address)

    const proxyAddress = await newApp(dao, 'lido-oracle', base.address, appManager)

    stakingRouter = await StakingRouter.at(proxyAddress)
  } else if (config.stakingRouter === 'mock') {
    stakingRouter = await StakingRouterMock.new(depositContract.address)
  } else {
    stakingRouter = await StakingRouter.at(config.oracle)
  }

  await stakingRouter.initialize(appManager, pool.address, config.withdrawalCredentials, { from: appManager })

  await grantStakingRouterRoles(stakingRouter, pool, voting, appManager)

  const stakingModules = await addStakingModules(
    config.stakingModules,
    stakingRouter,
    dao,
    acl,
    voting,
    token,
    appManager
  )

  if (config.depositSecurityModule === 'new') {
    depositSecurityModule = await DepositSecurityModule.new(
      pool.address,
      depositContract.address,
      stakingRouter.address,
      MAX_DEPOSITS_PER_BLOCK,
      MIN_DEPOSIT_BLOCK_DISTANCE,
      PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
      { from: appManager }
    )
    await depositSecurityModule.addGuardians([GUARDIAN3, GUARDIAN1, GUARDIAN2], 2, { from: appManager })
  } else {
    depositSecurityModule = await DepositSecurityModule.at(config.depositSecurityModule)
  }

  const elRewardsVault = await LidoELRewardsVault.new(pool.address, treasury.address)

  const withdrawalQueue = (await withdrawals.deploy(appManager, wsteth.address)).queue
  const withdrawalVault = await WithdrawalVault.new(pool.address, treasury.address)
  const eip712StETH = await EIP712StETH.new({ from: appManager })

  await pool.initialize(
    oracle.address,
    treasury.address,
    stakingRouter.address,
    depositSecurityModule.address,
    elRewardsVault.address,
    // withdrawalVault.address,
    withdrawalQueue.address,
    eip712StETH.address
  )

  // await oracle.setPool(pool.address)
  await depositContract.reset()
  await depositContract.set_deposit_root(DEPOSIT_ROOT)
  // await pool.resumeProtocolAndStaking()

  return {
    dao,
    acl,
    treasury,
    oracle,
    depositContract,
    stakingRouter,
    stakingModules,
    depositSecurityModule,
    elRewardsVault,
    withdrawalQueue,
    withdrawalVault,
    eip712StETH,
    token,
    wsteth,
    pool,
    guardians: {
      privateKeys: GUARDIAN_PRIVATE_KEYS,
      addresses: [GUARDIAN1, GUARDIAN2, GUARDIAN3]
    }
  }
}

async function setupNodeOperatorsRegistry(dao, token, stakingRouterAddress, config) {
  const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
  const name = 'node-operators-registry-' + Math.random().toString(36).slice(2, 6)
  const nodeOperatorsRegistryProxyAddress = await dao.newAppInstance({
    name,
    base: nodeOperatorsRegistryBase.address,
    permissions: {
      ...config.defaultCuratedPermissions,
      STAKING_ROUTER_ROLE: stakingRouterAddress
    }
  })

  const nodeOperatorsRegistry = await NodeOperatorsRegistry.at(nodeOperatorsRegistryProxyAddress)

  await nodeOperatorsRegistry.initialize(token.address, '0x01')

  return nodeOperatorsRegistry
}

async function grantStakingRouterRoles(stakingRouter, pool, voting, appManager) {
  const [
    MANAGE_WITHDRAWAL_CREDENTIALS_ROLE,
    STAKING_MODULE_PAUSE_ROLE,
    STAKING_MODULE_MANAGE_ROLE,
    REPORT_REWARDS_MINTED_ROLE
  ] = await Promise.all([
    stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
    stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
    stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
    stakingRouter.REPORT_REWARDS_MINTED_ROLE()
  ])
  await stakingRouter.grantRole(REPORT_REWARDS_MINTED_ROLE, pool.address, { from: appManager })

  await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting, { from: appManager })
  await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, voting, { from: appManager })
  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, voting, { from: appManager })
}

async function addStakingModules(config, stakingRouter, dao, acl, voting, token, appManager) {
  const stakingModules = []

  for (const m in config) {
    let stakingModule
    if (m === 'default') {
      stakingModule = await setupNodeOperatorsRegistry(dao, acl, voting, token, appManager, stakingRouter.address)
      await stakingRouter.addStakingModule('module', stakingModule.address, 10000, 500, 500, { from: voting })
    } else if (m.address) {
      await stakingRouter.addStakingModule('module', m.address, m.targetShares, m.moduleFee, m.treasuryFee, {
        from: voting
      })
      if (m.type === 'curated') {
        stakingModule = await NodeOperatorsRegistry.at(m.address)
      }
      for (let i = 0; i < m.validators; i++) {

      }
    } else if (m.type === 'curated') {
      stakingModule = await setupNodeOperatorsRegistry(dao, acl, voting, token, appManager, stakingRouter.address)
      await stakingRouter.addStakingModule(
        'module',
        stakingModule.address,
        m.targetShares,
        m.moduleFee,
        m.treasuryFee,
        { from: voting }
      )
    }
    stakingModules.push(stakingModule)
  }

  return stakingModules
}

module.exports = {
  deployProtocol,
  setupNodeOperatorsRegistry
}
