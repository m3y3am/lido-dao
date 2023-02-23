const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { deployWithoutProxy, deployBehindOssifiableProxy, updateProxyImplementation } = require('../helpers/deploy-shapella')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { APP_NAMES } = require('../constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  `app:${APP_NAMES.LIDO}`,
  `app:${APP_NAMES.ORACLE}`,
  "app:aragon-agent",
  "app:aragon-voting",
  "daoInitialSettings",
  "oracleReportSanityChecker",
  "burner",
  "hashConsensusForAccounting",
  "hashConsensusForExitBus",
  "withdrawalRequestNFT",
]

async function deployNewContracts({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()
  logWideSplitter()
  log(`Network ID:`, yl(netId))
  let state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state["app:lido"].proxyAddress
  const legacyOracleAddress = state["app:oracle"].proxyAddress
  const agentAddress = state["app:aragon-agent"].proxyAddress
  const votingAddress = state["app:aragon-voting"].proxyAddress
  const treasuryAddress = agentAddress
  const beaconSpec = state["daoInitialSettings"]["beaconSpec"]
  const depositSecurityModuleParams = state["depositSecurityModule"].parameters
  const burnerParams = state["burner"].parameters
  const hashConsensusForAccountingParams = state["hashConsensusForAccounting"].parameters
  const hashConsensusForExitBusParams = state["hashConsensusForExitBus"].parameters
  const withdrawalRequestNFTParams = state["withdrawalRequestNFT"].parameters

  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }

  // TODO
  // const proxyContractsOwner = votingAddress
  const proxyContractsOwner = DEPLOYER
  const admin = DEPLOYER
  const deployer = DEPLOYER

  const sanityChecks = state["oracleReportSanityChecker"].parameters
  logWideSplitter()

  if (!state.depositContractAddress && !state.daoInitialSettings.beaconSpec.depositContractAddress && isPublicNet) {
    throw new Error(`please specify deposit contract address in state file ${networkStateFile}`)
  }
  const depositContract = state.depositContractAddress || state.daoInitialSettings.beaconSpec.depositContractAddress

  // TODO: set proxyContractsOwner from state file? or from env?


  //
  // === OracleDaemonConfig ===
  //
  const oracleDaemonConfigArgs = [
    admin,
    [admin],
  ]
  await deployWithoutProxy('oracleDaemonConfig', 'OracleDaemonConfig', deployer, oracleDaemonConfigArgs)
  logWideSplitter()

  //
  // === LidoLocator: dummy invalid implementation ===
  //
  const locatorAddress = await deployBehindOssifiableProxy('lidoLocator', 'DummyEmptyContract', proxyContractsOwner, deployer)
  logWideSplitter()

  //
  // === OracleReportSanityChecker ===
  //
  const oracleReportSanityCheckerArgs = [
    locatorAddress,
    admin,
    [
      sanityChecks.churnValidatorsPerDayLimit,
      sanityChecks.oneOffCLBalanceDecreaseBPLimit,
      sanityChecks.annualBalanceIncreaseBPLimit,
      sanityChecks.shareRateDeviationBPLimit,
      sanityChecks.requestTimestampMargin,
      sanityChecks.maxPositiveTokenRebase,
      sanityChecks.maxValidatorExitRequestsPerReport,
      sanityChecks.maxAccountingExtraDataListItemsCount,
    ],
    [
      [admin],
      [], [], [], [], [], [], [], []
    ]
  ]
  const oracleReportSanityCheckerAddress = await deployWithoutProxy(
    "oracleReportSanityChecker", "OracleReportSanityChecker", deployer, oracleReportSanityCheckerArgs)
  logWideSplitter()

  //
  // === EIP712StETH ===
  //
  await deployWithoutProxy("eip712StETH", "EIP712StETH", deployer)
  logWideSplitter()

  //
  // === WstETH ===
  //
  const wstETHAddress = await deployWithoutProxy("wstETH", "WstETH", deployer, [lidoAddress])
  logWideSplitter()

  //
  // === WithdrawalRequestNFT ===
  //
  const withdrawalRequestNFTArgs = [
    wstETHAddress,
    withdrawalRequestNFTParams.name,
    withdrawalRequestNFTParams.symbol,
  ]
  const withdrawalRequestNFTAddress = await deployBehindOssifiableProxy(
    "withdrawalRequestNFT", "WithdrawalRequestNFT", proxyContractsOwner, deployer, withdrawalRequestNFTArgs)
  logWideSplitter()


  //
  // === WithdrawalVault ===
  //
  const withdrawalVaultAddress = await deployWithoutProxy("withdrawalVault", "WithdrawalVault", deployer, [lidoAddress, treasuryAddress])
  logWideSplitter()

  //
  // === LidoExecutionLayerRewardsVault ===
  //
  const elRewardsVaultAddress = await deployWithoutProxy(
    "executionLayerRewardsVault", "LidoExecutionLayerRewardsVault", deployer, [lidoAddress, treasuryAddress]
  )
  logWideSplitter()

  //
  // === BeaconChainDepositor ===
  //
  await deployWithoutProxy("beaconChainDepositor", "BeaconChainDepositor", deployer, [depositContract])
  logWideSplitter()

  //
  // === StakingRouter ===
  //
  const stakingRouterAddress =
    await deployBehindOssifiableProxy("stakingRouter", "StakingRouter", proxyContractsOwner, deployer, [depositContract])

  //
  // === DepositSecurityModule ===
  //
  const {maxDepositsPerBlock, minDepositBlockDistance, pauseIntentValidityPeriodBlocks} = depositSecurityModuleParams
  const depositSecurityModuleArgs = [
    lidoAddress,
    depositContract,
    stakingRouterAddress,
    maxDepositsPerBlock,
    minDepositBlockDistance,
    pauseIntentValidityPeriodBlocks,
  ]
  const depositSecurityModuleAddress = await deployWithoutProxy(
    "depositSecurityModule", "DepositSecurityModule", deployer, depositSecurityModuleArgs)
  logWideSplitter()

  //
  // === AccountingOracle ===
  //
  const accountingOracleArgs = [
    locatorAddress,
    lidoAddress,
    legacyOracleAddress,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
  ]
  const accountingOracleAddress = await deployBehindOssifiableProxy(
    "accountingOracle", "AccountingOracle", proxyContractsOwner, deployer, accountingOracleArgs)
  logWideSplitter()

  //
  // === HashConsensus for AccountingOracle ===
  //
  const hashConsensusForAccountingArgs = [
    beaconSpec.slotsPerEpoch,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    hashConsensusForAccountingParams.epochsPerFrame,
    0 + hashConsensusForAccountingParams.epochsPerFrame, // initialEpoch: must be legacyOracle last processed epoch + epochsPerFrame to pass AccountingOracle._checkOracleMigration
    hashConsensusForAccountingParams.fastLaneLengthSlots,
    admin, // admin
    accountingOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForAccounting", "HashConsensus", deployer, hashConsensusForAccountingArgs)
  logWideSplitter()

  //
  // === ValidatorsExitBusOracle ===
  //
  const validatorsExitBusOracleArgs = [
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    locatorAddress,
  ]
  const validatorsExitBusOracleAddress = await deployBehindOssifiableProxy(
    "validatorsExitBusOracle", "ValidatorsExitBusOracle", proxyContractsOwner, deployer, validatorsExitBusOracleArgs)
  logWideSplitter()

  //
  // === HashConsensus for ValidatorsExitBusOracle ===
  //
  const hashConsensusForExitBusArgs = [
    beaconSpec.slotsPerEpoch,
    beaconSpec.secondsPerSlot,
    beaconSpec.genesisTime,
    hashConsensusForExitBusParams.epochsPerFrame,
    0 + hashConsensusForExitBusParams.epochsPerFrame, // initialEpoch: must be legacyOracle last processed epoch + epochsPerFrame to pass AccountingOracle._checkOracleMigration
    hashConsensusForExitBusParams.fastLaneLengthSlots,
    admin, // admin
    validatorsExitBusOracleAddress,  // reportProcessor
  ]
  await deployWithoutProxy("hashConsensusForValidatorsExitBus", "HashConsensus", deployer, hashConsensusForExitBusArgs)
  logWideSplitter()


  //
  // === Burner ===
  //
  const burnerArgs = [
    admin,
    treasuryAddress,
    lidoAddress,
    burnerParams.totalCoverSharesBurnt,
    burnerParams.totalNonCoverSharesBurnt,
  ]
  const burnerAddress = await deployWithoutProxy("burner", "Burner", deployer, burnerArgs)
  logWideSplitter()

  //
  // === LidoLocator: update to valid implementation ===
  //
  const postTokenRebaseReceiver = legacyOracleAddress
  const locatorConfig = [
    accountingOracleAddress,
    depositSecurityModuleAddress,
    elRewardsVaultAddress,
    legacyOracleAddress,
    lidoAddress,
    oracleReportSanityCheckerAddress,
    postTokenRebaseReceiver,
    burnerAddress,
    stakingRouterAddress,
    treasuryAddress,
    validatorsExitBusOracleAddress,
    withdrawalRequestNFTAddress,
    withdrawalVaultAddress,
  ]
  await updateProxyImplementation(locatorAddress, "LidoLocator", proxyContractsOwner, [locatorConfig])
}

module.exports = runOrWrapScript(deployNewContracts, module)
